/**
 * Rendering. Every view is a pure function from state to an HTML string; all
 * the wiring lives in main.js and works through `data-action` attributes.
 */

import { clock12, duration, decimalHours, weekdayName, dayKeyToTs, MINUTE } from '../core/time.js';
import { placeLabel, dayCount } from '../core/places.js';
import { currentStatus, weekView } from '../core/engine.js';
import { PERMISSION } from './tracker.js';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const hoursText = (ms) => (ms > 0 ? duration(ms) : '—');

/* ---- Status bar ---------------------------------------------------------- */

export function renderStatus(state, tracker, now = Date.now()) {
  const status = currentStatus(state, now);
  const problem = trackingProblem(state, tracker, status);

  if (problem) {
    return `<div class="status-line">ShiftSense</div>
      <div class="status-main">${esc(problem.title)}</div>
      <div class="status-sub">${esc(problem.detail)}</div>
      ${problem.action ? `<div class="btn-row"><button class="btn wide" data-action="${problem.action}">${esc(problem.actionLabel)}</button></div>` : ''}`;
  }

  if (status.onSite) {
    return `<div class="status-line">On the clock</div>
      <div class="status-main">${esc(duration(status.elapsedMs))}</div>
      <div class="status-sub">${esc(placeLabel(status.site))} · since ${clock12(status.since)}</div>
      <div class="status-note">${tracker.holdingWakeLock ? 'Screen held awake so the shift keeps recording.' : 'Keep this open to keep recording.'}</div>`;
  }

  return `<div class="status-line">Off the clock</div>
    <div class="status-main">Not on a job</div>
    <div class="status-sub">${status.knownSites
      ? `${status.knownSites} job site${status.knownSites === 1 ? '' : 's'} known`
      : 'Still learning where you work'}</div>
    <div class="status-note">Last fix ${status.lastFixAt ? clock12(status.lastFixAt) : 'never'}.</div>`;
}

/** The one thing standing between the user and a working app, if there is one. */
function trackingProblem(state, tracker, status) {
  if (!tracker.supported) {
    return { title: 'No location', detail: 'This browser will not share location. Hours can still be typed in by hand.' };
  }
  if (tracker.permission === PERMISSION.DENIED) {
    return {
      title: 'Location is off',
      detail: 'ShiftSense cannot log anything until location is allowed for this site.',
      action: 'request-permission',
      actionLabel: 'Turn location on',
    };
  }
  if (tracker.permission === PERMISSION.UNKNOWN) {
    return {
      title: 'Ready when you are',
      detail: 'Allow location and ShiftSense starts learning where you work.',
      action: 'request-permission',
      actionLabel: 'Allow location',
    };
  }
  if (status.lastFixStale && status.lastFixAt) {
    return { title: 'Waiting for a fix', detail: `Last one was ${clock12(status.lastFixAt)}.` };
  }
  return null;
}

/* ---- Today --------------------------------------------------------------- */

export function renderToday(state, now = Date.now()) {
  const key = todayKey(now);
  const record = state.records.find((r) => r.date === key);

  if (!record || record.shifts.length === 0) {
    return `${sitesLearningNotice(state)}
      <div class="empty">
        <strong>Nothing logged yet today</strong>
        Once you have been at a job site for ${state.settings.minVisitMinutes} minutes, it shows up here.
      </div>
      <button class="btn wide" data-action="add-shift" data-date="${key}">Add hours by hand</button>`;
  }

  return `${sitesLearningNotice(state)}
    ${unnamedSiteNotice(record, state)}
    ${record.shifts.map((shift) => shiftCard(shift, state, { showDate: false })).join('')}
    ${suggestionCard(record)}
    <div class="btn-row">
      ${record.status === 'auto'
        ? `<button class="btn primary" data-action="confirm" data-date="${key}">Looks right</button>`
        : `<span class="tag ok">${record.status === 'confirmed' ? 'Confirmed' : 'Edited by you'}</span>`}
      <button class="btn" data-action="add-shift" data-date="${key}">Add a shift</button>
    </div>
    ${noteCard(record)}`;
}

const todayKey = (now) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function sitesLearningNotice(state) {
  const sites = state.places.filter((p) => p.kind === 'work');
  if (sites.length > 0) return '';
  return `<div class="card">
    <div class="row"><div class="stack">
      <strong>Learning where you work</strong>
      <span class="muted">A place becomes a job site after ${state.settings.minWorkDwellHours} hours across ${state.settings.minWorkDays} days. You can also mark one yourself on the Sites tab.</span>
    </div></div>
  </div>`;
}

/** A site called "41.7658, -72.6734" on a timesheet helps nobody. */
function unnamedSiteNotice(record, state) {
  const site = [...new Set(record.shifts.flatMap((s) => s.siteIds))]
    .map((id) => state.places.find((p) => p.id === id))
    .find((p) => p && !p.name);
  if (!site) return '';

  return `<div class="card">
    <label class="stack" for="name-${esc(site.id)}">
      <strong>Name this job site</strong>
      <span class="muted">It goes on the timesheet, so give it something payroll will recognise.</span>
      <input id="name-${esc(site.id)}" data-action="rename" data-place="${esc(site.id)}"
        style="text-align:left;max-width:100%;width:100%;margin-top:8px"
        placeholder="Route 9 / Miller Rd" value="">
    </label>
  </div>`;
}

function shiftCard(shift, state, { showDate = true } = {}) {
  const names = shift.siteIds
    .map((id) => state.places.find((p) => p.id === id))
    .filter(Boolean)
    .map(placeLabel);

  return `<div class="card ${shift.confidence === 'low' ? 'flagged' : ''}">
    <div class="row">
      <div class="stack">
        ${showDate ? `<span class="muted">${weekdayName(shift.start)} ${esc(shift.date)}</span>` : ''}
        <span class="range mono">${clock12(shift.start)} – ${clock12(shift.end)}</span>
        <span class="muted truncate">${esc(names.join(' + ') || 'Unnamed site')}</span>
      </div>
      <div class="stack" style="text-align:right">
        <span class="big mono">${esc(decimalHours(shift.workedMs))}</span>
        <span class="muted">hours</span>
      </div>
    </div>
    <div class="row">
      <span class="muted">${shift.breakMs ? `${duration(shift.breakMs)} break deducted` : 'No break deducted'}</span>
      ${confidenceTag(shift)}
    </div>
    ${blindGapNote(shift)}
    <div class="btn-row">
      <button class="btn small" data-action="edit-shift" data-date="${esc(shift.date)}" data-shift="${esc(shift.id)}">Edit times</button>
      <button class="btn small danger" data-action="delete-shift" data-date="${esc(shift.date)}" data-shift="${esc(shift.id)}">Remove</button>
    </div>
  </div>`;
}

/**
 * Only a genuinely unreliable day gets the loud treatment. A quarter hour of
 * slack at each end is normal and saying so on every single day would train
 * people to ignore the one day it matters.
 */
function confidenceTag(shift) {
  if (shift.source === 'manual') return '<span class="tag plain">Typed in</span>';
  const slack = shift.uncertaintyMs + (shift.blindMs ?? 0);
  if (shift.confidence === 'high') return '<span class="tag ok">Confident</span>';
  if (shift.confidence === 'medium') return `<span class="tag plain">±${duration(slack)}</span>`;
  return `<span class="tag check">Check this — could be off by ${duration(slack)}</span>`;
}

function blindGapNote(shift) {
  if (!shift.blindGaps?.length) return '';
  const worst = [...shift.blindGaps].sort((a, b) => b.ms - a.ms)[0];
  return `<div class="row"><span class="muted">No location between ${clock12(worst.start)} and ${clock12(worst.end)} — counted as on the job.</span></div>`;
}

function suggestionCard(record) {
  if (!record.suggestion) return '';
  return `<div class="card flagged">
    <div class="stack">
      <strong>Location says ${esc(decimalHours(record.suggestion.workedMs))} hours</strong>
      <span class="muted">You have ${esc(decimalHours(record.shifts.reduce((s, x) => s + x.workedMs, 0)))}. Your version is what gets exported unless you take this one.</span>
    </div>
    <div class="btn-row">
      <button class="btn primary" data-action="accept-suggestion" data-date="${esc(record.date)}">Use ${esc(decimalHours(record.suggestion.workedMs))}</button>
      <button class="btn" data-action="dismiss-suggestion" data-date="${esc(record.date)}">Keep mine</button>
    </div>
  </div>`;
}

function noteCard(record) {
  return `<div class="card">
    <label class="stack" for="note-${esc(record.date)}">
      <span class="muted">Note for this day</span>
      <input id="note-${esc(record.date)}" data-action="note" data-date="${esc(record.date)}"
        style="text-align:left;max-width:100%;width:100%"
        placeholder="Rain delay, crew, job number…" value="${esc(record.note)}">
    </label>
  </div>`;
}

/* ---- Week ---------------------------------------------------------------- */

export function renderWeek(state, anchorTs) {
  const { week } = weekView(state, anchorTs);
  const rules = state.settings;

  const rows = week.days.length
    ? week.days.map((day) => dayRow(day, state)).join('')
    : `<div class="empty"><strong>No hours this week</strong>Days show up here as they are logged.</div>`;

  return `<div class="weeknav">
      <button class="btn small" data-action="week" data-shift="-1">‹ Earlier</button>
      <strong class="mono">${esc(shortDate(week.weekStart))} – ${esc(shortDate(week.weekEnd))}</strong>
      <button class="btn small" data-action="week" data-shift="1">Later ›</button>
    </div>
    <div class="card">
      <div class="totals">
        <div><div class="n mono">${esc(decimalHours(week.regularMs))}</div><div class="l">Regular</div></div>
        <div><div class="n mono">${esc(decimalHours(week.otMs))}</div><div class="l">Overtime</div></div>
        <div><div class="n mono">${esc(decimalHours(week.workedMs))}</div><div class="l">Total</div></div>
      </div>
      ${week.doubleMs > 0 ? `<div class="row" style="margin-top:10px"><span class="muted">Double time</span><strong class="mono">${esc(decimalHours(week.doubleMs))}</strong></div>` : ''}
      <div class="row" style="margin-top:10px">
        <span class="muted">Overtime past ${rules.dailyOtAfterHours ?? '—'}h a day, ${rules.weeklyOtAfterHours ?? '—'}h a week</span>
      </div>
    </div>
    ${rows}
    <div class="btn-row">
      <button class="btn wide primary" data-action="export-csv" data-week="${esc(week.weekStart)}">Export this week as CSV</button>
    </div>`;
}

function dayRow(day, state) {
  const record = state.records.find((r) => r.date === day.date);
  const sites = [...new Set(day.shifts.flatMap((s) => s.siteIds))]
    .map((id) => state.places.find((p) => p.id === id))
    .filter(Boolean)
    .map(placeLabel);
  const first = day.shifts[0];
  const last = day.shifts[day.shifts.length - 1];

  return `<div class="card ${day.confidence === 'low' ? 'flagged' : ''}" data-action="open-day" data-date="${esc(day.date)}">
    <div class="row">
      <div class="stack">
        <strong>${weekdayName(dayKeyToTs(day.date))} ${esc(shortDate(day.date))}</strong>
        <span class="muted mono">${clock12(first.start)} – ${clock12(last.end)}${day.shifts.length > 1 ? ` · ${day.shifts.length} stints` : ''}</span>
        <span class="muted truncate">${esc(sites.join(' + ') || 'Unnamed site')}</span>
      </div>
      <div class="stack" style="text-align:right">
        <span class="big mono">${esc(decimalHours(day.workedMs))}</span>
        ${day.otMs > 0 ? `<span class="tag ot">${esc(decimalHours(day.otMs))} OT</span>` : '<span class="muted">hours</span>'}
      </div>
    </div>
    <div class="row">
      ${record?.status === 'auto' ? '<span class="muted">Not confirmed</span>' : `<span class="tag ok">${record?.status === 'edited' ? 'Edited' : 'Confirmed'}</span>`}
      ${record?.suggestion ? '<span class="tag check">Location disagrees</span>' : ''}
      ${day.confidence === 'low' && record?.status === 'auto' ? '<span class="tag check">Check</span>' : ''}
    </div>
  </div>`;
}

const shortDate = (key) => {
  const [, m, d] = key.split('-');
  return `${Number(m)}/${Number(d)}`;
};

/* ---- Sites --------------------------------------------------------------- */

export function renderSites(state) {
  if (state.places.length === 0) {
    return `<div class="empty">
      <strong>Nothing learned yet</strong>
      Keep the app installed and open when you get to work. After a couple of days it will know the place.
    </div>`;
  }

  const order = { work: 0, home: 1, other: 2, unknown: 3 };
  const places = [...state.places].sort(
    (a, b) => (order[a.kind] - order[b.kind]) || b.dwellMs - a.dwellMs,
  );

  return `<h2>Places the app has learned</h2>
    ${places.map(placeCard).join('')}
    <div class="card">
      <span class="muted">Marking a place yourself pins it — the app will not reclassify it later.
      Home is never counted as work, which is what stops a long morning in the driveway becoming a shift.</span>
    </div>`;
}

function placeCard(place) {
  const kinds = [['work', 'Job site'], ['home', 'Home'], ['other', 'Not work']];
  return `<div class="card">
    <div class="row">
      <input data-action="rename" data-place="${esc(place.id)}" value="${esc(place.name ?? '')}"
        placeholder="${esc(placeLabel(place))}" style="text-align:left;max-width:100%;width:100%;font-weight:700">
    </div>
    <div class="row">
      <span class="muted mono">${esc(place.center.lat.toFixed(4))}, ${esc(place.center.lon.toFixed(4))} · ${Math.round(place.radiusM)}m</span>
      ${place.pinned ? '<span class="tag plain">Pinned by you</span>' : ''}
    </div>
    <div class="row">
      <span class="muted">${hoursText(place.dwellMs)} across ${dayCount(place)} day${dayCount(place) === 1 ? '' : 's'}</span>
    </div>
    <div class="btn-row">
      ${kinds.map(([kind, label]) => `<button class="btn small ${place.kind === kind ? 'primary' : ''}"
        data-action="set-kind" data-place="${esc(place.id)}" data-kind="${kind}">${label}</button>`).join('')}
    </div>
  </div>`;
}

/* ---- Settings ------------------------------------------------------------ */

export function renderSettings(state, tracker) {
  const s = state.settings;
  const num = (key, label, hint, { min = 0, max = 24, step = 0.5 } = {}) => `
    <div class="field">
      <label for="set-${key}">${esc(label)}<span class="hint">${esc(hint)}</span></label>
      <input id="set-${key}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}"
        data-action="setting" data-key="${key}" value="${s[key] ?? ''}">
    </div>`;

  return `<h2>Pay rules</h2>
    <div class="card">
      <div class="field">
        <label for="set-weekStartsOn">Pay week starts<span class="hint">Drives the weekly overtime line</span></label>
        <select id="set-weekStartsOn" data-action="setting" data-key="weekStartsOn">
          ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
            .map((d, i) => `<option value="${i}" ${s.weekStartsOn === i ? 'selected' : ''}>${d}</option>`).join('')}
        </select>
      </div>
      ${num('dailyOtAfterHours', 'Overtime after', 'Hours in a day. Blank for none.')}
      ${num('weeklyOtAfterHours', 'Weekly overtime after', 'Hours in a week. Blank for none.', { max: 100, step: 1 })}
      ${num('doubleTimeAfterHours', 'Double time after', 'Hours in a day. Blank for none.')}
      <div class="field">
        <label for="set-roundToMinutes">Round shifts to<span class="hint">6 minutes is tenths of an hour</span></label>
        <select id="set-roundToMinutes" data-action="setting" data-key="roundToMinutes">
          ${[[1, 'Exact'], [6, '6 min'], [15, '15 min'], [30, '30 min']]
            .map(([v, l]) => `<option value="${v}" ${s.roundToMinutes === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>

    <h2>How it decides</h2>
    <div class="card">
      ${num('minVisitMinutes', 'Shortest stop that counts', 'Below this it was a drive-by', { max: 240, step: 5 })}
      ${num('unpaidBreakMinutes', 'Break deducted after', 'Minutes off site before it stops being paid', { max: 240, step: 5 })}
      ${num('splitShiftGapMinutes', 'Separate shift after', 'Minutes away before it is a second shift', { max: 720, step: 15 })}
      ${num('minWorkDwellHours', 'Learn a job site after', 'Hours at a place', { max: 100, step: 1 })}
      ${num('minWorkDays', 'and at least', 'Days at that place', { max: 30, step: 1 })}
    </div>

    <h2>Tracking</h2>
    <div class="card">
      <div class="field">
        <label for="set-keepAwake">Hold the screen awake on a shift
          <span class="hint">The only way a web app keeps recording from your pocket. Costs battery.</span></label>
        <input id="set-keepAwake" type="checkbox" data-action="setting" data-key="keepAwakeOnShift"
          ${s.keepAwakeOnShift !== false ? 'checked' : ''}>
      </div>
      <div class="row" style="margin-top:12px">
        <span class="muted">Location permission</span>
        <strong>${esc(tracker.permission)}</strong>
      </div>
      ${tracker.lastError ? `<div class="row"><span class="muted">Last error: ${esc(tracker.lastError.message)}</span></div>` : ''}
      <div class="btn-row"><button class="btn wide" data-action="sample-now">Take a fix now</button></div>
    </div>

    <h2>What this can and cannot do</h2>
    <div class="card">
      <span class="muted">
        A web app only reads location while it is open on screen — no browser will let one track you in the
        background, and no amount of code changes that. So ShiftSense takes a fix every time you open it,
        keeps sampling while it is on screen, and can hold the screen awake through a shift.
        When there is a hole in the record it says so on the day rather than quietly filling it in.
        For hands-off tracking all day with the phone locked, you need a native app.
      </span>
    </div>

    <h2>Your data</h2>
    <div class="card">
      <span class="muted">Everything stays on this phone. Nothing is uploaded, and there is no account.
      Raw location is kept ${esc(state.settings.retentionDays ?? 14)} days and then dropped; your hours are kept until you delete them.</span>
      <div class="btn-row">
        <button class="btn" data-action="export-json">Back up</button>
        <button class="btn" data-action="import-json">Restore</button>
      </div>
      <div class="btn-row">
        <button class="btn danger" data-action="forget-location">Forget location history</button>
        <button class="btn danger" data-action="reset">Erase everything</button>
      </div>
    </div>`;
}

/* ---- Shift editor -------------------------------------------------------- */

export function renderEditor({ date, shift }) {
  const hhmm = (ts) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return `<form method="dialog">
    <h3>${shift ? 'Edit' : 'Add'} hours</h3>
    <p class="muted">${weekdayName(dayKeyToTs(date))} ${esc(date)}</p>
    <div class="field">
      <label for="ed-start">Start</label>
      <input id="ed-start" name="start" type="time" required value="${shift ? hhmm(shift.start) : '07:00'}">
    </div>
    <div class="field">
      <label for="ed-end">End<span class="hint">Earlier than the start means past midnight</span></label>
      <input id="ed-end" name="end" type="time" required value="${shift ? hhmm(shift.end) : '15:30'}">
    </div>
    <div class="field">
      <label for="ed-break">Unpaid break<span class="hint">Minutes</span></label>
      <input id="ed-break" name="break" type="number" inputmode="numeric" min="0" max="480" step="5"
        value="${shift ? Math.round((shift.breakMs ?? 0) / MINUTE) : 0}">
    </div>
    <div class="btn-row">
      <button class="btn" value="cancel">Cancel</button>
      <button class="btn primary" value="save" data-date="${esc(date)}" data-shift="${esc(shift?.id ?? '')}">Save</button>
    </div>
  </form>`;
}

export { esc };
