/**
 * Persistence.
 *
 * Everything lives on the device. There is no account and no server, which is
 * the only honest way to build something that knows where its user has been.
 *
 * Raw fixes are kept only as long as they are useful — inference re-runs over a
 * rolling window, and once a day has been turned into a record the fixes behind
 * it are just weight. Places keep their learned totals, so history is not lost
 * when the fixes behind it are pruned; day records are permanent.
 */

import { DAY, dayKey } from './time.js';
import { DEFAULTS } from './settings.js';

const KEY = 'shiftsense.v1';
/** How much raw location history to hold. Long enough to re-infer a fortnight
 *  of timesheets, short enough to stay well inside a browser storage quota. */
export const SAMPLE_RETENTION_DAYS = 14;

/** Fixes are stored as flat arrays; the key names cost more than the data. */
const packSample = (s) => [s.ts, round(s.lat, 6), round(s.lon, 6), Math.round(s.accuracy ?? 0)];
const unpackSample = ([ts, lat, lon, accuracy]) => ({ ts, lat, lon, accuracy });
const round = (n, dp) => Number(n.toFixed(dp));

export function emptyState() {
  return {
    samples: [],
    places: [],
    records: [],
    settings: { ...DEFAULTS },
    live: null, // the shift in progress, if any
    lastLearnedTs: null,
  };
}

/**
 * A store over any synchronous key/value backend — `localStorage` in the
 * browser, a plain object in tests.
 */
export function createStore(backend, { now = () => Date.now() } = {}) {
  let state = read();

  function read() {
    try {
      const raw = backend.getItem(KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      return {
        ...emptyState(),
        ...parsed,
        samples: (parsed.samples ?? []).map(unpackSample),
        settings: { ...DEFAULTS, ...(parsed.settings ?? {}) },
      };
    } catch {
      // A corrupt blob must not brick the app. Better an empty log than no app.
      return emptyState();
    }
  }

  function flush() {
    const payload = JSON.stringify({
      ...state,
      samples: state.samples.map(packSample),
    });
    try {
      backend.setItem(KEY, payload);
    } catch {
      // Quota. Drop the oldest half of the raw fixes and try once more — the
      // day records, which are what matter, are far smaller and survive.
      state.samples = state.samples.slice(Math.floor(state.samples.length / 2));
      backend.setItem(KEY, JSON.stringify({ ...state, samples: state.samples.map(packSample) }));
    }
    return state;
  }

  return {
    get state() {
      return state;
    },

    /** Record a fix, keeping the log inside its retention window. */
    addSample(sample) {
      const cutoff = now() - SAMPLE_RETENTION_DAYS * DAY;
      state.samples = [...state.samples, sample]
        .filter((s) => s.ts >= cutoff)
        .sort((a, b) => a.ts - b.ts);
      return flush();
    },

    /** Fixes not yet folded into the learned places. */
    unlearnedSamples() {
      const from = state.lastLearnedTs ?? 0;
      return state.samples.filter((s) => s.ts > from);
    },

    /**
     * Re-read from the backing store, discarding what is held in memory.
     *
     * Two copies of the app open at once — a browser tab and the installed
     * home-screen one — each hold their own state and each write the whole blob
     * on save, so the second writer would otherwise erase the first's fixes.
     * The caller listens for the storage event and calls this.
     */
    reload() {
      state = read();
      return state;
    },

    patch(changes) {
      state = { ...state, ...changes };
      return flush();
    },

    /** Everything, as a file the user can keep. */
    exportJson() {
      return JSON.stringify(
        { version: 1, exportedAt: new Date(now()).toISOString(), ...state },
        null,
        2,
      );
    },

    importJson(text) {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.records)) throw new Error('Not a ShiftSense backup');
      state = {
        ...emptyState(),
        ...parsed,
        samples: (parsed.samples ?? []).map((s) => (Array.isArray(s) ? unpackSample(s) : s)),
        settings: { ...DEFAULTS, ...(parsed.settings ?? {}) },
      };
      return flush();
    },

    reset() {
      state = emptyState();
      return flush();
    },

    /** Wipe location history but keep the timesheet. */
    forgetLocationHistory() {
      state = { ...state, samples: [], places: [], lastLearnedTs: null };
      return flush();
    },
  };
}

/** Day keys covered by the raw fixes still on hand. */
export function coveredDays(samples) {
  return [...new Set(samples.map((s) => dayKey(s.ts)))].sort();
}
