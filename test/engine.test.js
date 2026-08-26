import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/core/store.js';
import { refresh, currentStatus, weekView, needsReview } from '../src/core/engine.js';
import { confirm } from '../src/core/records.js';
import { workSites } from '../src/core/places.js';
import { HOUR, dayKeyToTs } from '../src/core/time.js';
import { SITE, HOME, trace } from './helpers.js';

function backend() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
}

/** Mon-Fri, home overnight, one job site. */
const WEEK = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'];
function weekSamples(endHHMM = '16:00') {
  return WEEK.flatMap((date) => [
    ...trace(date, HOME, '00:00', '05:40', 20),
    ...trace(date, SITE, '06:30', endHHMM, 15),
    ...trace(date, HOME, '18:30', '23:50', 20),
  ]);
}

/** Feed a store a batch of fixes the way the tracker would. */
function feed(store, samples) {
  for (const s of samples) store.addSample(s);
  return store;
}

const NOW = dayKeyToTs('2026-08-21') + 20 * HOUR;
const newStore = () => createStore(backend(), { now: () => NOW });

test('a week of fixes becomes a week of timesheet entries, unprompted', () => {
  const store = feed(newStore(), weekSamples());
  refresh(store, NOW);

  assert.equal(workSites(store.state.places).length, 1, 'the job site is learned');
  assert.equal(store.state.records.length, 5, 'five working days');
  for (const record of store.state.records) {
    assert.equal(record.shifts.length, 1);
    // 9h30m of fixes, credited as 10h: the quarter hour of padding at each end
    // covers leaving home before the first fix and the site after the last.
    assert.equal(Math.round(record.shifts[0].workedMs / HOUR * 100) / 100, 10);
  }
});

test('overtime on one day shows up in the week total', () => {
  const store = feed(newStore(), [
    ...WEEK.slice(0, 4).flatMap((date) => [
      ...trace(date, HOME, '00:00', '05:40', 20),
      ...trace(date, SITE, '06:30', '15:00', 15),
      ...trace(date, HOME, '17:00', '23:50', 20),
    ]),
    // Friday runs late.
    ...trace('2026-08-21', HOME, '00:00', '05:40', 20),
    ...trace('2026-08-21', SITE, '06:30', '19:30', 15),
  ]);
  refresh(store, NOW);

  const { week } = weekView(store.state, NOW);
  assert.equal(week.days.length, 5);
  const friday = week.days.find((d) => d.date === '2026-08-21');
  assert.equal(Math.round(friday.workedMs / HOUR * 100) / 100, 13.25);
  assert.equal(friday.otMs / HOUR, 5.25, 'everything past the eight-hour day');
  assert.ok(week.otMs / HOUR >= 5);
});

test('re-running inference does not disturb a day you already signed off', () => {
  const store = feed(newStore(), weekSamples());
  refresh(store, NOW);

  const target = store.state.records[0];
  store.patch({ records: store.state.records.map((r) => (r.date === target.date ? confirm(r) : r)) });

  // More fixes arrive for that same morning.
  feed(store, trace(target.date, SITE, '16:15', '18:00', 15));
  refresh(store, NOW);

  const after = store.state.records.find((r) => r.date === target.date);
  assert.equal(after.status, 'confirmed');
  assert.equal(after.shifts[0].workedMs, target.shifts[0].workedMs, 'your hours are untouched');
  assert.ok(after.suggestion, 'but the app says it saw something different');
});

test('being on site right now reads as being on the clock', () => {
  const store = feed(newStore(), [
    ...weekSamples(),
    ...trace('2026-08-21', SITE, '06:30', '14:00', 10),
  ]);
  const at2pm = dayKeyToTs('2026-08-21') + 14 * HOUR;
  refresh(store, at2pm);

  const status = currentStatus(store.state, at2pm);
  assert.equal(status.onSite, true);
  assert.ok(status.site, 'and it knows which job');
  assert.ok(status.elapsedMs / HOUR > 7 && status.elapsedMs / HOUR < 8);
});

test('sitting at home does not read as being on the clock', () => {
  const store = feed(newStore(), weekSamples());
  refresh(store, NOW);
  assert.equal(currentStatus(store.state, NOW).onSite, false);
});

test('the days worth checking are counted for the review badge', () => {
  const store = feed(newStore(), [
    ...weekSamples(),
    // A Saturday the phone barely woke up for.
    { ts: dayKeyToTs('2026-08-22') + 7 * HOUR, ...SITE, accuracy: 15 },
    { ts: dayKeyToTs('2026-08-22') + 15 * HOUR, ...SITE, accuracy: 15 },
  ]);
  refresh(store, NOW);

  const saturday = store.state.records.find((r) => r.date === '2026-08-22');
  assert.ok(saturday, 'the sparse day is still logged');
  assert.equal(saturday.shifts[0].confidence, 'low');
  assert.ok(needsReview(store.state) >= 1);
});

test('learning survives the pruning of the fixes behind it', () => {
  const store = feed(newStore(), weekSamples());
  refresh(store, NOW);
  const learned = workSites(store.state.places)[0];

  // Simulate the retention window rolling past this week.
  store.patch({ samples: [] });
  refresh(store, NOW);

  const after = workSites(store.state.places)[0];
  assert.equal(after.id, learned.id);
  assert.equal(after.dwellMs, learned.dwellMs, 'the learned totals persist');
  assert.equal(store.state.records.length, 5, 'and so does the timesheet');
});
