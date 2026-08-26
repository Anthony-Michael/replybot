import test from 'node:test';
import assert from 'node:assert/strict';
import { splitDay, applyWeeklyOt, summarise, roundMs } from '../src/core/hours.js';
import { HOUR, MINUTE } from '../src/core/time.js';

const h = (n) => n * HOUR;
const asHours = (ms) => Math.round((ms / HOUR) * 100) / 100;

/** A one-shift day, which is all the pay maths needs to know about. */
function day(date, workedHours) {
  return { date, start: new Date(`${date}T07:00:00`).getTime(), workedMs: h(workedHours), breakMs: 0, confidence: 'high' };
}

test('a short day is all regular time', () => {
  const s = splitDay(h(6), {});
  assert.equal(asHours(s.regularMs), 6);
  assert.equal(s.otMs, 0);
});

test('past eight hours the rest is overtime', () => {
  const s = splitDay(h(10.5), {});
  assert.equal(asHours(s.regularMs), 8);
  assert.equal(asHours(s.otMs), 2.5);
});

test('double time applies past its own threshold and stops the overtime', () => {
  const s = splitDay(h(14), { doubleTimeAfterHours: 12 });
  assert.equal(asHours(s.regularMs), 8);
  assert.equal(asHours(s.otMs), 4);
  assert.equal(asHours(s.doubleMs), 2);
});

test('daily overtime can be switched off for a flat-rate job', () => {
  const s = splitDay(h(11), { dailyOtAfterHours: null });
  assert.equal(asHours(s.regularMs), 11);
  assert.equal(s.otMs, 0);
});

test('weekly overtime starts once forty regular hours are behind you', () => {
  const days = [8, 8, 8, 8, 8, 6].map((n, i) => splitDay(h(n), {}));
  const adjusted = applyWeeklyOt(days, {});
  assert.equal(asHours(adjusted.slice(0, 5).reduce((s, d) => s + d.regularMs, 0)), 40);
  assert.equal(asHours(adjusted[5].regularMs), 0, 'the sixth day is all overtime');
  assert.equal(asHours(adjusted[5].otMs), 6);
});

test('an hour already paid as daily overtime is not counted again by the week', () => {
  // Five ten-hour days: 40 regular, 10 daily overtime. The week threshold is
  // exactly met by the regular hours, so nothing extra should move.
  const days = Array.from({ length: 5 }, () => splitDay(h(10), {}));
  const adjusted = applyWeeklyOt(days, {});

  assert.equal(asHours(adjusted.reduce((s, d) => s + d.regularMs, 0)), 40);
  assert.equal(asHours(adjusted.reduce((s, d) => s + d.otMs, 0)), 10);
  assert.equal(adjusted.every((d) => d.weeklyOtMs === 0), true, 'no double counting');
});

test('rounding to tenths of an hour matches what payroll keys in', () => {
  assert.equal(roundMs(7 * HOUR + 47 * MINUTE, 6), 7 * HOUR + 48 * MINUTE);
  assert.equal(roundMs(7 * HOUR + 47 * MINUTE, 1), 7 * HOUR + 47 * MINUTE);
  const s = splitDay(h(8) + 47 * MINUTE, { roundToMinutes: 15 });
  assert.equal(asHours(s.otMs), 0.75);
});

test('summarise groups days into pay weeks and totals them', () => {
  const shifts = [
    day('2026-08-24', 10), // Mon
    day('2026-08-25', 10),
    day('2026-08-26', 10),
    day('2026-08-27', 10),
    day('2026-08-28', 10), // Fri — 50 hours, 10 of it daily overtime
    day('2026-08-29', 8), // Sat — all of it past forty
  ];
  const summary = summarise(shifts, { weekStartsOn: 0 });

  assert.equal(summary.weeks.length, 1);
  assert.equal(summary.weeks[0].weekStart, '2026-08-23');
  assert.equal(asHours(summary.workedMs), 58);
  assert.equal(asHours(summary.regularMs), 40);
  assert.equal(asHours(summary.otMs), 18);
});

test('a pay week that starts on Monday splits the weekend differently', () => {
  const shifts = [day('2026-08-23', 8), day('2026-08-24', 8)]; // Sunday, Monday
  assert.equal(summarise(shifts, { weekStartsOn: 0 }).weeks.length, 1);
  assert.equal(summarise(shifts, { weekStartsOn: 1 }).weeks.length, 2);
});

test('two shifts in one day are taxed for overtime as a single day', () => {
  const shifts = [
    { ...day('2026-08-24', 5), id: 'a' },
    { ...day('2026-08-24', 5), id: 'b' },
  ];
  const summary = summarise(shifts, {});
  assert.equal(summary.days.length, 1);
  assert.equal(asHours(summary.regularMs), 8);
  assert.equal(asHours(summary.otMs), 2, 'not two five-hour days with no overtime');
});
