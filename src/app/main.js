/**
 * Wiring: state in the store, events by delegation, one re-render at the end.
 */

import { createStore } from '../core/store.js';
import { refresh, needsReview } from '../core/engine.js';
import { classifyPlaces } from '../core/places.js';
import {
  confirm as confirmRecord, editShift, manualShift, addShift, removeShift,
  acceptSuggestion, dismissSuggestion, emptyRecord, toCsv,
} from '../core/records.js';
import { dayKeyToTs, DAY } from '../core/time.js';
import { createTracker } from './tracker.js';
import { renderStatus, renderToday, renderWeek, renderSites, renderSettings, renderEditor } from './ui.js';

const store = createStore(window.localStorage);
const tracker = createTracker(store, { onUpdate: render });

const el = {
  statusbar: document.getElementById('statusbar'),
  panel: document.getElementById('panel'),
  tabs: document.getElementById('tabs'),
  editor: document.getElementById('editor'),
};

let tab = 'today';
let weekAnchor = Date.now();

/* ---- Rendering ----------------------------------------------------------- */

function render() {
  const state = store.state;
  const now = Date.now();

  el.statusbar.innerHTML = renderStatus(state, tracker, now);
  el.statusbar.classList.toggle('on-clock', el.statusbar.querySelector('.status-line')?.textContent === 'On the clock');

  el.panel.innerHTML =
    tab === 'today' ? renderToday(state, now)
    : tab === 'week' ? renderWeek(state, weekAnchor)
    : tab === 'sites' ? renderSites(state)
    : renderSettings(state, tracker);

  const outstanding = needsReview(state);
  for (const button of el.tabs.querySelectorAll('.tab')) {
    const selected = button.dataset.tab === tab;
    button.setAttribute('aria-selected', String(selected));
    const label = button.dataset.tab[0].toUpperCase() + button.dataset.tab.slice(1);
    button.innerHTML =
      button.dataset.tab === 'week' && outstanding > 0
        ? `${label}<span class="badge">${outstanding}</span>`
        : label;
  }
}

/** Update one day record in place. */
function updateRecord(date, fn) {
  const existing = store.state.records.find((r) => r.date === date) ?? emptyRecord(date);
  const records = [
    ...store.state.records.filter((r) => r.date !== date),
    fn(existing),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  store.patch({ records });
  render();
}

/* ---- Events -------------------------------------------------------------- */

el.tabs.addEventListener('click', (event) => {
  const button = event.target.closest('.tab');
  if (!button) return;
  tab = button.dataset.tab;
  if (tab === 'week') weekAnchor = Date.now();
  render();
});

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target || target.tagName === 'INPUT' || target.tagName === 'SELECT') return;
  const { action, date, shift: shiftId, place, kind } = target.dataset;

  const actions = {
    'request-permission': () => tracker.requestPermission().then(render),
    'sample-now': () => tracker.sampleOnce().then(render),

    confirm: () => updateRecord(date, confirmRecord),
    'accept-suggestion': () => updateRecord(date, acceptSuggestion),
    'dismiss-suggestion': () => updateRecord(date, dismissSuggestion),
    'delete-shift': () => {
      if (window.confirm('Remove this shift?')) updateRecord(date, (r) => removeShift(r, shiftId));
    },
    'edit-shift': () => openEditor(date, shiftId),
    'add-shift': () => openEditor(date, null),
    'open-day': () => {
      tab = 'today';
      openDay(date);
    },

    week: () => {
      weekAnchor += Number(target.dataset.shift) * 7 * DAY;
      render();
    },
    'export-csv': () => exportCsv(target.dataset.week),

    'set-kind': () => setPlaceKind(place, kind),

    'export-json': () => downloadFile('shiftsense-backup.json', store.exportJson(), 'application/json'),
    'import-json': () => importBackup(),
    'forget-location': () => {
      if (window.confirm('Forget all location history? Your logged hours are kept.')) {
        store.forgetLocationHistory();
        render();
      }
    },
    reset: () => {
      if (window.confirm('Erase every hour and every place on this device? This cannot be undone.')) {
        store.reset();
        render();
      }
    },
  };

  actions[action]?.();
});

/** Text and number inputs commit on change rather than every keystroke. */
document.addEventListener('change', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, date, key, place } = target.dataset;

  if (action === 'note') {
    updateRecord(date, (record) => ({ ...record, note: target.value }));
  } else if (action === 'setting') {
    store.patch({ settings: { ...store.state.settings, ...readSetting(key, target) } });
    refresh(store);
    tracker.syncWakeLock();
    render();
  } else if (action === 'rename') {
    const places = store.state.places.map((p) =>
      p.id === place ? { ...p, name: target.value.trim() || null } : p);
    store.patch({ places });
    render();
  }
});

function readSetting(key, input) {
  if (input.type === 'checkbox') return { [key]: input.checked };
  if (input.type === 'number') {
    return { [key]: input.value === '' ? null : Number(input.value) };
  }
  return { [key]: Number.isNaN(Number(input.value)) ? input.value : Number(input.value) };
}

function setPlaceKind(placeId, kind) {
  const places = store.state.places.map((p) =>
    p.id === placeId ? { ...p, kind, pinned: true } : p);
  // Pinning one place can change what the others are, so let the rules re-run.
  store.patch({ places: classifyPlaces(places, store.state.settings) });
  refresh(store);
  render();
}

/* ---- Shift editor -------------------------------------------------------- */

function openEditor(date, shiftId) {
  const record = store.state.records.find((r) => r.date === date);
  const shift = record?.shifts.find((s) => s.id === shiftId) ?? null;
  el.editor.innerHTML = renderEditor({ date, shift });
  el.editor.showModal();
}

el.editor.addEventListener('close', () => {
  const submitter = el.editor.returnValue;
  if (submitter !== 'save') return;

  const form = el.editor.querySelector('form');
  const date = el.editor.querySelector('[value="save"]').dataset.date;
  const shiftId = el.editor.querySelector('[value="save"]').dataset.shift;
  const values = {
    startHHMM: form.start.value,
    endHHMM: form.end.value,
    breakMinutes: Number(form.break.value) || 0,
  };

  updateRecord(date, (record) =>
    shiftId
      ? editShift(record, shiftId, values)
      : addShift(record, manualShift(date, { ...values, siteIds: defaultSiteIds() })));
});

const defaultSiteIds = () => {
  const site = store.state.places.find((p) => p.kind === 'work');
  return site ? [site.id] : [];
};

function openDay(date) {
  render();
  // The Today tab shows today; for any other day, go straight to its editor.
  if (date !== new Date().toISOString().slice(0, 10)) openEditor(date, null);
}

/* ---- Files --------------------------------------------------------------- */

function exportCsv(weekStart) {
  const from = dayKeyToTs(weekStart);
  const to = from + 7 * DAY;
  const records = store.state.records.filter((r) => {
    const ts = dayKeyToTs(r.date);
    return ts >= from && ts < to;
  });
  if (records.length === 0) {
    window.alert('Nothing logged for this week yet.');
    return;
  }
  downloadFile(`hours-${weekStart}.csv`, toCsv(records, store.state.places, store.state.settings), 'text/csv');
}

function downloadFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importBackup() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      store.importJson(await file.text());
      render();
      window.alert('Restored.');
    } catch (error) {
      window.alert(`That file could not be restored: ${error.message}`);
    }
  });
  input.click();
}

/* ---- Start --------------------------------------------------------------- */

document.addEventListener('visibilitychange', () => {
  tracker.handleVisibility();
  render();
});

// Another copy of the app — a tab alongside the installed one — has written.
// Take its version rather than letting the next save here overwrite it.
window.addEventListener('storage', (event) => {
  if (event.key !== null && !event.key.startsWith('shiftsense')) return;
  store.reload();
  render();
});

// A shift that is open across a tick of the clock should keep counting up.
setInterval(render, 30_000);

refresh(store);
render();
tracker.readPermission().then(render);
tracker.start();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // Offline support is a bonus; the app works without it.
  });
}

// Keep the timesheet current even if the page sits open across midnight.
setInterval(() => {
  refresh(store);
  render();
}, 5 * 60_000);

export { store, tracker };
