import test from 'node:test';
import assert from 'node:assert/strict';
import { learnPlaces } from '../src/core/places.js';
import { buildVisits, buildShifts } from '../src/core/sessions.js';
import { dayKey, clock, HOUR, MINUTE } from '../src/core/time.js';
import { SITE, HOME, DINER, trace, fix, hours } from './helpers.js';

/** Places learned from an ordinary week, so the day under test has context. */
function knownPlaces(extra = []) {
  const samples = [];
  for (const date of ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21']) {
    samples.push(...trace(date, HOME, '00:00', '05:40', 20));
    samples.push(...trace(date, SITE, '06:30', '16:00', 15));
    samples.push(...trace(date, HOME, '17:00', '23:50', 20));
  }
  return learnPlaces([...samples, ...extra]);
}

const shiftsFor = (samples, places) => buildShifts(buildVisits(samples, places), places);

test('an ordinary day becomes one shift with the right hours', () => {
  const places = knownPlaces();
  const day = trace('2026-08-24', SITE, '06:30', '16:00', 15);
  const shifts = shiftsFor(day, places);

  assert.equal(shifts.length, 1);
  assert.equal(shifts[0].date, '2026-08-24');
  assert.equal(clock(shifts[0].start), '06:30');
  assert.equal(clock(shifts[0].end), '16:00');
  assert.equal(hours(shifts[0].workedMs), 9.5);
});

test('lunch off site is deducted as an unpaid break', () => {
  const places = knownPlaces();
  const day = [
    ...trace('2026-08-24', SITE, '06:30', '11:30', 15),
    ...trace('2026-08-24', DINER, '11:45', '12:35', 10),
    ...trace('2026-08-24', SITE, '12:50', '16:00', 15),
  ];
  const shifts = shiftsFor(day, places);

  assert.equal(shifts.length, 1, 'lunch does not end the shift');
  assert.equal(shifts[0].breaks.length, 1);
  const worked = hours(shifts[0].workedMs);
  assert.ok(worked > 8.1 && worked < 8.5, `expected about 8h15m, got ${worked}h`);
});

test('a short trip off site stays on the clock', () => {
  const places = knownPlaces();
  const day = [
    ...trace('2026-08-24', SITE, '06:30', '11:30', 15),
    ...trace('2026-08-24', DINER, '11:40', '11:50', 5),
    ...trace('2026-08-24', SITE, '12:00', '16:00', 15),
  ];
  const shifts = shiftsFor(day, places);

  assert.equal(shifts.length, 1);
  assert.equal(shifts[0].breaks.length, 0, 'a coffee run is not an unpaid break');
  assert.equal(hours(shifts[0].workedMs), 9.5);
});

test('overtime shows up as hours, not as a special case', () => {
  const places = knownPlaces();
  const shifts = shiftsFor(trace('2026-08-24', SITE, '06:00', '18:30', 15), places);
  assert.equal(hours(shifts[0].workedMs), 12.5);
});

test('a night shift stays on the day it started', () => {
  const places = knownPlaces();
  const night = [
    ...trace('2026-08-24', SITE, '21:00', '23:45', 15),
    ...trace('2026-08-25', SITE, '00:00', '05:30', 15),
  ];
  const shifts = shiftsFor(night, places);

  assert.equal(shifts.length, 1, 'midnight does not end a shift');
  assert.equal(shifts[0].date, '2026-08-24');
  assert.equal(dayKey(shifts[0].end), '2026-08-25');
  assert.equal(hours(shifts[0].workedMs), 8.5);
});

test('going home and coming back is two shifts, not one long one', () => {
  const places = knownPlaces();
  const day = [
    ...trace('2026-08-24', SITE, '06:00', '10:00', 15),
    ...trace('2026-08-24', HOME, '10:45', '18:00', 20),
    ...trace('2026-08-24', SITE, '19:00', '23:00', 15),
  ];
  const shifts = shiftsFor(day, places);

  assert.equal(shifts.length, 2);
  // Each stint is credited a quarter hour past its last fix, because you were
  // still on site somewhere in the gap before the phone turned up at home.
  assert.equal(hours(shifts[0].workedMs), 4.25);
  assert.equal(hours(shifts[1].workedMs), 4.25);
});

test('driving past the site does not open a shift', () => {
  const places = knownPlaces();
  const day = [
    ...trace('2026-08-24', HOME, '08:00', '08:50', 5),
    ...trace('2026-08-24', SITE, '09:00', '09:05', 2),
    ...trace('2026-08-24', HOME, '09:15', '10:00', 5),
  ];
  assert.equal(shiftsFor(day, places).length, 0);
});

test('a day with three fixes still produces the right day', () => {
  const places = knownPlaces();
  // The phone was in a pocket and the app only woke up three times.
  const day = [
    fix('2026-08-24', SITE, '06:45'),
    fix('2026-08-24', SITE, '11:30'),
    fix('2026-08-24', SITE, '17:20'),
  ];
  const shifts = shiftsFor(day, places);

  assert.equal(shifts.length, 1, 'sparse fixes must not shatter the day');
  assert.equal(hours(shifts[0].workedMs), 10.58);
  assert.equal(shifts[0].confidence, 'low', 'and it must be flagged for review');
});

test('two fixes eight hours apart are read as a day on the job, and flagged', () => {
  const places = knownPlaces();
  const day = [fix('2026-08-24', SITE, '07:00'), fix('2026-08-24', SITE, '15:00')];
  const shifts = shiftsFor(day, places);

  assert.equal(shifts.length, 1);
  assert.equal(hours(shifts[0].workedMs), 8);
  assert.equal(shifts[0].confidence, 'low');
  assert.equal(shifts[0].blindGaps.length, 1, 'the hole in the record is recorded');
  assert.ok(shifts[0].blindGaps[0].ms > 7 * HOUR);
});

test('silence between two different sites is not bridged', () => {
  const other = { lat: 41.7000, lon: -72.6000 };
  // A second job, worked on its own days so the trace stays physically possible.
  const places = learnPlaces([
    ...['2026-08-17', '2026-08-18'].flatMap((d) => [
      ...trace(d, HOME, '00:00', '05:40', 20),
      ...trace(d, other, '07:00', '16:00', 15),
      ...trace(d, HOME, '17:00', '23:50', 20),
    ]),
    ...['2026-08-19', '2026-08-20', '2026-08-21'].flatMap((d) => [
      ...trace(d, HOME, '00:00', '05:40', 20),
      ...trace(d, SITE, '06:30', '16:00', 15),
      ...trace(d, HOME, '17:00', '23:50', 20),
    ]),
  ]);
  assert.equal(places.filter((p) => p.kind === 'work').length, 2, 'both jobs learned');

  const day = [
    ...trace('2026-08-24', SITE, '06:00', '07:00', 15),
    ...trace('2026-08-24', other, '15:00', '16:00', 15),
  ];
  const shifts = shiftsFor(day, places);

  assert.equal(shifts.length, 2, 'two sites with a hole between them are two shifts');
});

test('a dense day is reported with high confidence', () => {
  const places = knownPlaces();
  // What continuous sampling actually looks like: the app is open, so the
  // arrival and the departure are each caught within one sampling interval.
  const day = [
    fix('2026-08-24', HOME, '06:25'),
    ...trace('2026-08-24', SITE, '06:30', '16:00', 5),
    fix('2026-08-24', HOME, '16:05'),
  ];
  const shifts = shiftsFor(day, places);
  assert.equal(shifts[0].confidence, 'high');
});

test('no fixes means no shift, not a zero-hour one', () => {
  assert.deepEqual(shiftsFor([], knownPlaces()), []);
});
