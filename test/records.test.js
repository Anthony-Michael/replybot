import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcile, emptyRecord, confirm, editShift, manualShift, addShift, removeShift,
  acceptSuggestion, dismissSuggestion, toCsv, totalWorkedMs,
} from '../src/core/records.js';
import { HOUR, MINUTE, combine } from '../src/core/time.js';

const PLACES = [{ id: 'site1', name: 'Route 9 / Miller Rd', center: { lat: 41.76, lon: -72.67 } }];

function inferred(date, startHHMM, endHHMM, extra = {}) {
  const start = combine(date, startHHMM);
  const end = combine(date, endHHMM);
  return {
    id: `s_${start}`,
    date,
    start,
    end,
    siteIds: ['site1'],
    segments: [{ placeId: 'site1', start, end }],
    breaks: [],
    breakMs: 0,
    blindGaps: [],
    workedMs: end - start,
    uncertaintyMs: 0,
    confidence: 'high',
    source: 'auto',
    ...extra,
  };
}

test('a new day is written straight in', () => {
  const records = reconcile([], [inferred('2026-08-24', '06:30', '16:00')]);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'auto');
  assert.equal(totalWorkedMs(records[0].shifts) / HOUR, 9.5);
});

test('an unconfirmed day is replaced when better data arrives', () => {
  const first = reconcile([], [inferred('2026-08-24', '06:30', '12:00')]);
  const second = reconcile(first, [inferred('2026-08-24', '06:30', '16:00')]);

  assert.equal(totalWorkedMs(second[0].shifts) / HOUR, 9.5, 'the afternoon should be picked up');
  assert.equal(second[0].suggestion, null);
});

test('a day you confirmed is never rewritten behind your back', () => {
  const records = reconcile([], [inferred('2026-08-24', '06:30', '16:00')]);
  const confirmed = [confirm(records[0])];
  const after = reconcile(confirmed, [inferred('2026-08-24', '06:30', '18:00')]);

  assert.equal(totalWorkedMs(after[0].shifts) / HOUR, 9.5, 'your hours stand');
  assert.equal(after[0].status, 'confirmed');
  assert.ok(after[0].suggestion, 'but the disagreement is surfaced');
  assert.equal(after[0].suggestion.workedMs / HOUR, 11.5);
});

test('a disagreement of a few minutes is not worth raising', () => {
  const records = [confirm(reconcile([], [inferred('2026-08-24', '06:30', '16:00')])[0])];
  const after = reconcile(records, [inferred('2026-08-24', '06:30', '16:05')]);
  assert.equal(after[0].suggestion, null);
});

test('accepting a suggestion takes the location version', () => {
  const records = [confirm(reconcile([], [inferred('2026-08-24', '06:30', '16:00')])[0])];
  const after = reconcile(records, [inferred('2026-08-24', '06:30', '18:00')]);
  const accepted = acceptSuggestion(after[0]);

  assert.equal(totalWorkedMs(accepted.shifts) / HOUR, 11.5);
  assert.equal(accepted.status, 'confirmed');
  assert.equal(accepted.suggestion, null);
});

test('dismissing a suggestion leaves your hours alone and stops the nagging', () => {
  const records = [confirm(reconcile([], [inferred('2026-08-24', '06:30', '16:00')])[0])];
  const after = dismissSuggestion(reconcile(records, [inferred('2026-08-24', '06:30', '18:00')])[0]);

  assert.equal(totalWorkedMs(after.shifts) / HOUR, 9.5);
  assert.equal(after.suggestion, null);
});

test('editing a shift by hand marks the day as yours', () => {
  const records = reconcile([], [inferred('2026-08-24', '06:30', '16:00')]);
  const edited = editShift(records[0], records[0].shifts[0].id, { startHHMM: '06:00', endHHMM: '17:30', breakMinutes: 30 });

  assert.equal(edited.status, 'edited');
  assert.equal(totalWorkedMs(edited.shifts) / HOUR, 11);

  const after = reconcile([edited], [inferred('2026-08-24', '06:30', '16:00')]);
  assert.equal(totalWorkedMs(after[0].shifts) / HOUR, 11, 'the edit survives re-inference');
});

test('an edit that ends before it starts is read as a night shift', () => {
  const records = reconcile([], [inferred('2026-08-24', '21:00', '23:00')]);
  const edited = editShift(records[0], records[0].shifts[0].id, { startHHMM: '21:00', endHHMM: '05:30' });
  assert.equal(totalWorkedMs(edited.shifts) / HOUR, 8.5);
});

test('a day typed in from scratch survives inference finding nothing', () => {
  let record = addShift(emptyRecord('2026-08-24'), manualShift('2026-08-24', {
    startHHMM: '07:00', endHHMM: '15:30', breakMinutes: 30,
  }));
  assert.equal(totalWorkedMs(record.shifts) / HOUR, 8);

  const after = reconcile([record], []);
  assert.equal(after.length, 1, 'a day you entered is not deleted by the app');
  assert.equal(totalWorkedMs(after[0].shifts) / HOUR, 8);
});

test('an auto day the app no longer believes in disappears', () => {
  const records = reconcile([], [inferred('2026-08-24', '06:30', '16:00')]);
  assert.equal(reconcile(records, []).length, 0);
});

test('a shift can be removed from a day', () => {
  const records = reconcile([], [
    inferred('2026-08-24', '06:00', '10:00'),
    inferred('2026-08-24', '19:00', '23:00'),
  ]);
  const after = removeShift(records[0], records[0].shifts[1].id);
  assert.equal(after.shifts.length, 1);
  assert.equal(after.status, 'edited');
});

test('the CSV carries the numbers payroll needs', () => {
  const records = reconcile([], [inferred('2026-08-24', '06:30', '17:15', { breakMs: 30 * MINUTE, workedMs: 10.25 * HOUR })]);
  const csv = toCsv(records, PLACES, {});
  const [header, row] = csv.split('\n');

  assert.match(header, /^Date,Day,Site,In,Out/);
  const cells = row.split(',');
  assert.equal(cells[0], '2026-08-24');
  assert.equal(cells[1], 'Mon');
  assert.equal(cells[3], '06:30');
  assert.equal(cells[4], '17:15');
  assert.equal(cells[6], '10.25', 'total');
  assert.equal(cells[7], '8', 'regular');
  assert.equal(cells[8], '2.25', 'overtime');
});

test('a site name with a comma does not break the CSV', () => {
  const records = reconcile([], [inferred('2026-08-24', '06:30', '16:00')]);
  const csv = toCsv(records, [{ ...PLACES[0], name: 'Route 9, Miller Rd' }], {});
  assert.match(csv, /"Route 9, Miller Rd"/);
  assert.equal(csv.split('\n')[1].split(',').length, 14, 'quoted comma is not a column break');
});

test('days older than the location history are not deleted for lack of evidence', () => {
  const old = reconcile([], [inferred('2026-07-01', '06:30', '16:00')]);
  assert.equal(old[0].status, 'auto');

  // A fortnight later the fixes behind that day are long pruned, and inference
  // only speaks to the last two weeks.
  const after = reconcile(old, [inferred('2026-08-24', '06:30', '16:00')], {
    window: { from: '2026-08-12', to: '2026-08-26' },
  });

  assert.equal(after.length, 2, 'July must still be there');
  assert.equal(totalWorkedMs(after[0].shifts) / HOUR, 9.5);
});

test('inside the window, an auto day with no evidence still goes away', () => {
  const records = reconcile([], [inferred('2026-08-24', '06:30', '16:00')]);
  const after = reconcile(records, [], { window: { from: '2026-08-12', to: '2026-08-26' } });
  assert.equal(after.length, 0);
});
