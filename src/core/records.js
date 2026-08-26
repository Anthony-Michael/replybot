/**
 * The day log — what actually goes on the timesheet.
 *
 * Inference runs again every time new fixes arrive, and it must never quietly
 * rewrite a day you already checked. So each day carries a status: `auto` days
 * are the app's best guess and are replaced freely, while `confirmed` and
 * `edited` days are yours. When location later disagrees with a day you own,
 * the app does not touch it — it hangs a suggestion off the record and lets you
 * decide.
 */

import { MINUTE, dayKey, combine, decimalHours, clock, weekdayName } from './time.js';
import { summarise } from './hours.js';

/** Below this, a disagreement between you and the phone is not worth raising. */
const SUGGEST_TOLERANCE_MS = 10 * MINUTE;

export function emptyRecord(date) {
  return {
    date,
    shifts: [],
    status: 'auto',
    note: '',
    suggestion: null,
    updatedAt: Date.now(),
  };
}

/**
 * Fold freshly inferred shifts into the stored day records.
 *
 * `window` bounds the days inference actually had data for. It matters because
 * raw fixes are pruned after a couple of weeks: without it, re-running would
 * conclude that every older day had no shifts and quietly delete a month of
 * unconfirmed timesheets. Days outside the window are left untouched.
 *
 * Returns a new array; nothing passed in is mutated.
 */
export function reconcile(records, inferredShifts, { now = Date.now(), window = null } = {}) {
  const byDate = new Map(records.map((r) => [r.date, { ...r }]));
  const inferredByDate = new Map();
  for (const shift of inferredShifts) {
    const date = shift.date ?? dayKey(shift.start);
    if (!inferredByDate.has(date)) inferredByDate.set(date, []);
    inferredByDate.get(date).push(shift);
  }

  for (const [date, shifts] of inferredByDate) {
    const existing = byDate.get(date);

    if (!existing || existing.status === 'auto') {
      byDate.set(date, {
        ...(existing ?? emptyRecord(date)),
        date,
        shifts,
        status: 'auto',
        suggestion: null,
        updatedAt: now,
      });
      continue;
    }

    // The day belongs to the user. Offer, do not overwrite.
    const mine = totalWorkedMs(existing.shifts);
    const theirs = totalWorkedMs(shifts);
    byDate.set(date, {
      ...existing,
      suggestion:
        Math.abs(mine - theirs) > SUGGEST_TOLERANCE_MS
          ? { shifts, workedMs: theirs, raisedAt: now }
          : null,
    });
  }

  // An auto day the inference no longer supports — a site you un-pinned, say —
  // should disappear. A day you entered or confirmed stays regardless, and so
  // does any day the fixes no longer reach back far enough to speak to.
  for (const [date, record] of byDate) {
    if (record.status !== 'auto') continue;
    if (inferredByDate.has(date)) continue;
    if (window && (date < window.from || date > window.to)) continue;
    byDate.delete(date);
  }

  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function totalWorkedMs(shifts = []) {
  return shifts.reduce((sum, s) => sum + (s.workedMs ?? 0), 0);
}

/** Accept what location inferred for a day you had previously edited. */
export function acceptSuggestion(record, now = Date.now()) {
  if (!record.suggestion) return record;
  return {
    ...record,
    shifts: record.suggestion.shifts,
    status: 'confirmed',
    suggestion: null,
    updatedAt: now,
  };
}

export function dismissSuggestion(record, now = Date.now()) {
  return { ...record, suggestion: null, updatedAt: now };
}

/** One tap: this day is right, stop guessing at it. */
export function confirm(record, now = Date.now()) {
  return { ...record, status: 'confirmed', suggestion: null, updatedAt: now };
}

/**
 * Replace a shift's clock times by hand. Times are 'HH:MM' on the record's own
 * date; an end earlier than the start is read as running past midnight, which
 * is what a night shift looks like when you type it in.
 */
export function editShift(record, shiftId, { startHHMM, endHHMM, breakMinutes, note }, now = Date.now()) {
  const shifts = record.shifts.map((shift) => {
    if (shift.id !== shiftId) return shift;
    const start = combine(record.date, startHHMM);
    let end = combine(record.date, endHHMM);
    if (end <= start) end += 24 * 60 * MINUTE;
    const breakMs = Math.max(0, (breakMinutes ?? 0) * MINUTE);
    return {
      ...shift,
      start,
      end,
      breakMs,
      breaks: breakMs > 0 ? [{ start, end: start + breakMs, ms: breakMs, manual: true }] : [],
      workedMs: Math.max(0, end - start - breakMs),
      confidence: 'high',
      source: 'manual',
    };
  });

  return {
    ...record,
    shifts,
    status: 'edited',
    suggestion: null,
    note: note ?? record.note,
    updatedAt: now,
  };
}

/** A shift typed in from scratch, for the day the phone was in the truck. */
export function manualShift(date, { startHHMM, endHHMM, breakMinutes = 0, siteIds = [] }) {
  const start = combine(date, startHHMM);
  let end = combine(date, endHHMM);
  if (end <= start) end += 24 * 60 * MINUTE;
  const breakMs = Math.max(0, breakMinutes * MINUTE);
  return {
    id: `m_${start}`,
    date,
    start,
    end,
    siteIds,
    segments: [{ placeId: siteIds[0] ?? null, start, end }],
    breaks: breakMs > 0 ? [{ start, end: start + breakMs, ms: breakMs, manual: true }] : [],
    breakMs,
    blindGaps: [],
    workedMs: Math.max(0, end - start - breakMs),
    uncertaintyMs: 0,
    confidence: 'high',
    source: 'manual',
  };
}

export function addShift(record, shift, now = Date.now()) {
  return {
    ...record,
    shifts: [...record.shifts, shift].sort((a, b) => a.start - b.start),
    status: 'edited',
    suggestion: null,
    updatedAt: now,
  };
}

export function removeShift(record, shiftId, now = Date.now()) {
  return {
    ...record,
    shifts: record.shifts.filter((s) => s.id !== shiftId),
    status: 'edited',
    suggestion: null,
    updatedAt: now,
  };
}

/**
 * Timesheet CSV.
 *
 * One row per day, because that is the shape of a timesheet and because
 * overtime is a property of the day and the week, not of an individual shift.
 * A day worked in two stints shows the first clock-in, the last clock-out and
 * the combined break, with the stints spelled out in the Detail column.
 */
export function toCsv(records, places, settings) {
  const nameOf = new Map(
    places.map((p) => [p.id, p.name || `${p.center.lat.toFixed(4)}, ${p.center.lon.toFixed(4)}`]),
  );
  const withShifts = records.filter((r) => r.shifts.length > 0);
  const summary = summarise(withShifts.flatMap((r) => r.shifts), settings);
  const byDate = new Map(summary.days.map((d) => [d.date, d]));

  const rows = [
    ['Date', 'Day', 'Site', 'In', 'Out', 'Break (min)', 'Total', 'Regular', 'Overtime', 'Double', 'Status', 'Detail', 'Note'],
  ];

  for (const record of withShifts) {
    const day = byDate.get(record.date);
    if (!day) continue;
    const shifts = [...record.shifts].sort((a, b) => a.start - b.start);
    const sites = [...new Set(shifts.flatMap((s) => s.siteIds))]
      .map((id) => nameOf.get(id) ?? 'Unknown')
      .join(' + ');

    rows.push([
      record.date,
      weekdayName(shifts[0].start),
      sites,
      clock(shifts[0].start),
      clock(shifts[shifts.length - 1].end),
      Math.round(day.breakMs / MINUTE),
      decimalHours(day.workedMs),
      decimalHours(day.regularMs),
      decimalHours(day.otMs),
      decimalHours(day.doubleMs),
      record.status,
      shifts.length > 1
        ? shifts.map((s) => `${clock(s.start)}-${clock(s.end)}`).join('; ')
        : '',
      record.note ?? '',
    ]);
  }

  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
