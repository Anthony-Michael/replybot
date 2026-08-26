/**
 * The loop that ties it together: fixes in, timesheet out.
 *
 * Kept free of anything browser-shaped so the whole pipeline can be exercised
 * in a test with a fabricated week.
 */

import { learnPlaces, workSites } from './places.js';
import { buildVisits, buildShifts } from './sessions.js';
import { reconcile } from './records.js';
import { summarise } from './hours.js';
import { coveredDays } from './store.js';
import { dayKey, startOfWeek, MINUTE } from './time.js';

/**
 * Re-derive everything from the fixes on hand and write it back to the store.
 *
 * Place learning is incremental — only fixes newer than the last pass are
 * folded in, so the learned totals keep accumulating after the fixes behind
 * them are pruned. Shift inference is not: it re-runs over the whole retained
 * window, because a fix arriving now can change where this morning's shift
 * started.
 */
export function refresh(store, now = Date.now()) {
  const { samples, settings } = store.state;

  const places = learnPlaces(store.unlearnedSamples(), {
    existing: store.state.places,
    settings,
  });

  const visits = buildVisits(samples, places, settings);
  const shifts = buildShifts(visits, places, settings);
  // With no fixes on hand there is nothing to reconcile against, and pruning
  // on that basis would erase the timesheet the moment the retention window
  // rolled past the last day worked.
  const days = coveredDays(samples);
  const records = days.length
    ? reconcile(store.state.records, shifts, {
        now,
        window: { from: days[0], to: days[days.length - 1] },
      })
    : store.state.records;

  return store.patch({
    places,
    records,
    lastLearnedTs: samples.length ? samples[samples.length - 1].ts : store.state.lastLearnedTs,
  });
}

/**
 * What the app should be saying right now: are you on a job, since when, and
 * how long has it been.
 */
export function currentStatus(state, now = Date.now()) {
  const { samples, places, settings, records } = state;
  const last = samples[samples.length - 1];
  const sites = workSites(places);

  const today = dayKey(now);
  const todayRecord = records.find((r) => r.date === today);
  const openShift = todayRecord?.shifts?.find((s) => s.end >= now - staleAfter(settings));

  const site = openShift ? sites.find((p) => openShift.siteIds.includes(p.id)) : null;

  return {
    onSite: Boolean(openShift),
    site,
    since: openShift?.start ?? null,
    elapsedMs: openShift ? now - openShift.start - (openShift.breakMs ?? 0) : 0,
    lastFixAt: last?.ts ?? null,
    lastFixStale: last ? now - last.ts > staleAfter(settings) : true,
    knownSites: sites.length,
  };
}

/** A fix older than a couple of sampling intervals no longer proves anything. */
function staleAfter(settings) {
  return Math.max(3 * (settings.sampleIntervalMs ?? 2 * MINUTE), 15 * MINUTE);
}

/** Day records for the pay week containing `ts`, with the pay maths applied. */
export function weekView(state, ts = Date.now()) {
  const { records, settings } = state;
  const weekStart = dayKey(startOfWeek(ts, settings.weekStartsOn));
  const summary = summarise(records.flatMap((r) => r.shifts), settings);
  const week = summary.weeks.find((w) => w.weekStart === weekStart);

  return {
    weekStart,
    week: week ?? { weekStart, weekEnd: weekStart, days: [], workedMs: 0, regularMs: 0, otMs: 0, doubleMs: 0 },
    recordFor: (date) => records.find((r) => r.date === date),
  };
}

/** Days that want a look before the timesheet goes in. */
export function needsReview(state) {
  return state.records.filter(
    (r) => r.status === 'auto' && r.shifts.some((s) => s.confidence !== 'high'),
  ).length + state.records.filter((r) => r.suggestion).length;
}
