/**
 * Pay maths. Kept separate from the location work on purpose: whatever the
 * phone saw, these rules are what turns it into a number you hand in, and they
 * differ by employer, state and contract.
 *
 * Daily and weekly overtime are deliberately not additive — an hour that
 * already counted as daily overtime is not counted again when the week passes
 * forty, which is the rule almost everywhere and the mistake almost every
 * hand-rolled timesheet makes.
 */

import { HOUR, MINUTE, DAY, dayKey, startOfWeek } from './time.js';
import { withDefaults } from './settings.js';

/** Round a duration to the nearest `minutes`, as payroll systems do. */
export function roundMs(ms, minutes) {
  if (!minutes || minutes <= 1) return ms;
  const step = minutes * MINUTE;
  return Math.round(ms / step) * step;
}

/**
 * Split one day's worked time into regular, overtime and double time.
 * Returns milliseconds so nothing is lost to rounding until display.
 */
export function splitDay(workedMs, settings) {
  const cfg = withDefaults(settings);
  const worked = Math.max(0, roundMs(workedMs, cfg.roundToMinutes));

  const dtAfter = cfg.doubleTimeAfterHours != null ? cfg.doubleTimeAfterHours * HOUR : Infinity;
  const otAfter = cfg.dailyOtAfterHours != null ? cfg.dailyOtAfterHours * HOUR : Infinity;

  const doubleMs = Math.max(0, worked - dtAfter);
  const beforeDouble = worked - doubleMs;
  const otMs = Math.max(0, Math.min(beforeDouble, dtAfter) - otAfter);
  const regularMs = beforeDouble - otMs;

  return { workedMs: worked, regularMs, otMs, doubleMs };
}

/**
 * Apply weekly overtime across a week's days.
 *
 * Hours are walked in date order and, once the running total of *regular*
 * hours passes the weekly threshold, everything after it moves to overtime.
 * Hours already paid as daily overtime never enter that running total, so they
 * cannot push you over the line twice.
 */
export function applyWeeklyOt(days, settings) {
  const cfg = withDefaults(settings);
  if (cfg.weeklyOtAfterHours == null) return days;
  const threshold = cfg.weeklyOtAfterHours * HOUR;

  let runningRegular = 0;
  return days.map((day) => {
    const room = Math.max(0, threshold - runningRegular);
    const stayRegular = Math.min(day.regularMs, room);
    const movedToOt = day.regularMs - stayRegular;
    runningRegular += stayRegular;
    return {
      ...day,
      regularMs: stayRegular,
      otMs: day.otMs + movedToOt,
      weeklyOtMs: movedToOt,
    };
  });
}

/**
 * Full summary for a set of shifts: a row per day, grouped into pay weeks.
 * `shifts` may span any range; days with no shifts simply do not appear.
 */
export function summarise(shifts, settings) {
  const cfg = withDefaults(settings);

  const byDay = new Map();
  for (const shift of shifts) {
    const key = shift.date ?? dayKey(shift.start);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(shift);
  }

  const days = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, dayShifts]) => {
      const workedMs = dayShifts.reduce((sum, s) => sum + s.workedMs, 0);
      const split = splitDay(workedMs, cfg);
      return {
        date,
        shifts: dayShifts,
        breakMs: dayShifts.reduce((sum, s) => sum + (s.breakMs ?? 0), 0),
        confidence: lowestConfidence(dayShifts),
        weeklyOtMs: 0,
        ...split,
      };
    });

  const weeks = new Map();
  for (const day of days) {
    const noon = new Date(`${day.date}T12:00:00`).getTime();
    const key = dayKey(startOfWeek(noon, cfg.weekStartsOn));
    if (!weeks.has(key)) weeks.set(key, []);
    weeks.get(key).push(day);
  }

  const adjustedWeeks = [...weeks.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekStartKey, weekDays]) => {
      const adjusted = applyWeeklyOt(weekDays, cfg);
      return {
        weekStart: weekStartKey,
        weekEnd: dayKey(new Date(`${weekStartKey}T12:00:00`).getTime() + 6 * DAY),
        days: adjusted,
        ...totals(adjusted),
      };
    });

  return {
    days: adjustedWeeks.flatMap((w) => w.days),
    weeks: adjustedWeeks,
    ...totals(adjustedWeeks),
  };
}

function totals(rows) {
  return {
    workedMs: rows.reduce((s, r) => s + r.workedMs, 0),
    regularMs: rows.reduce((s, r) => s + r.regularMs, 0),
    otMs: rows.reduce((s, r) => s + r.otMs, 0),
    doubleMs: rows.reduce((s, r) => s + r.doubleMs, 0),
  };
}

const RANK = { high: 0, medium: 1, low: 2 };
function lowestConfidence(shifts) {
  return shifts.reduce(
    (worst, s) => (RANK[s.confidence ?? 'high'] > RANK[worst] ? s.confidence : worst),
    'high',
  );
}
