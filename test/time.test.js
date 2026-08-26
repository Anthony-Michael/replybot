import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dayKey, dayKeyToTs, startOfWeek, combine, duration, decimalHours, clock12, HOUR, MINUTE,
} from '../src/core/time.js';

test('dayKey round-trips through dayKeyToTs', () => {
  const ts = dayKeyToTs('2026-03-09');
  assert.equal(dayKey(ts), '2026-03-09');
});

test('a shift that ends after midnight still keys to the day it began', () => {
  const start = combine('2026-03-09', '22:00');
  const end = start + 8 * HOUR;
  assert.equal(dayKey(start), '2026-03-09');
  assert.equal(dayKey(end), '2026-03-10');
});

test('startOfWeek honours the configured first day', () => {
  const wed = dayKeyToTs('2026-08-26'); // a Wednesday
  assert.equal(dayKey(startOfWeek(wed, 0)), '2026-08-23', 'Sunday week');
  assert.equal(dayKey(startOfWeek(wed, 1)), '2026-08-24', 'Monday week');
});

test('startOfWeek is stable for a day that is itself the week start', () => {
  const sun = dayKeyToTs('2026-08-23');
  assert.equal(dayKey(startOfWeek(sun, 0)), '2026-08-23');
});

test('durations format the way a timesheet reads', () => {
  assert.equal(duration(7 * HOUR + 45 * MINUTE), '7h 45m');
  assert.equal(duration(8 * HOUR), '8h');
  assert.equal(duration(20 * MINUTE), '20m');
  assert.equal(decimalHours(7 * HOUR + 45 * MINUTE), 7.75);
});

test('clock12 handles noon and midnight without a zero hour', () => {
  assert.equal(clock12(combine('2026-08-26', '00:05')), '12:05 AM');
  assert.equal(clock12(combine('2026-08-26', '12:30')), '12:30 PM');
  assert.equal(clock12(combine('2026-08-26', '17:15')), '5:15 PM');
});
