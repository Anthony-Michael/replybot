import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, SAMPLE_RETENTION_DAYS, coveredDays } from '../src/core/store.js';
import { DAY, HOUR } from '../src/core/time.js';

/** A stand-in for localStorage. */
function backend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    map,
  };
}

const NOW = new Date('2026-08-26T12:00:00').getTime();
const at = (msAgo) => ({ ts: NOW - msAgo, lat: 41.7658, lon: -72.6734, accuracy: 12 });

test('state survives a round trip through storage', () => {
  const b = backend();
  const first = createStore(b, { now: () => NOW });
  first.addSample(at(HOUR));
  first.patch({ places: [{ id: 'p1', name: 'Route 9' }] });

  const second = createStore(b, { now: () => NOW });
  assert.equal(second.state.samples.length, 1);
  assert.equal(second.state.places[0].name, 'Route 9');
  assert.equal(second.state.samples[0].lat, 41.7658);
});

test('fixes older than the retention window are dropped', () => {
  const store = createStore(backend(), { now: () => NOW });
  store.addSample(at((SAMPLE_RETENTION_DAYS + 2) * DAY));
  store.addSample(at(HOUR));
  assert.equal(store.state.samples.length, 1);
});

test('a corrupt blob yields an empty app, not a crash', () => {
  const store = createStore(backend({ 'shiftsense.v1': '{not json' }));
  assert.deepEqual(store.state.records, []);
  assert.equal(store.state.settings.dailyOtAfterHours, 8);
});

test('hitting the storage quota sheds fixes and keeps the timesheet', () => {
  let full = true;
  const inner = backend();
  const flaky = {
    getItem: inner.getItem,
    setItem: (k, v) => {
      // Fail the first write of every call, as a full quota would.
      if (full) {
        full = false;
        throw new Error('QuotaExceededError');
      }
      full = true;
      inner.setItem(k, v);
    },
  };
  const store = createStore(flaky, { now: () => NOW });
  store.patch({ records: [{ date: '2026-08-24', shifts: [], status: 'confirmed' }] });

  assert.equal(store.state.records.length, 1, 'the timesheet is never what gets dropped');
});

test('only fixes newer than the last learning pass are re-learned', () => {
  const store = createStore(backend(), { now: () => NOW });
  store.addSample(at(3 * HOUR));
  store.addSample(at(HOUR));
  store.patch({ lastLearnedTs: NOW - 2 * HOUR });

  assert.equal(store.unlearnedSamples().length, 1);
});

test('a backup round-trips', () => {
  const store = createStore(backend(), { now: () => NOW });
  store.addSample(at(HOUR));
  store.patch({ records: [{ date: '2026-08-24', shifts: [], status: 'confirmed', note: 'rain' }] });
  const json = store.exportJson();

  const restored = createStore(backend(), { now: () => NOW });
  restored.importJson(json);
  assert.equal(restored.state.records[0].note, 'rain');
  assert.equal(restored.state.samples.length, 1);
});

test('importing something that is not a backup is refused', () => {
  const store = createStore(backend(), { now: () => NOW });
  assert.throws(() => store.importJson('{"hello":"world"}'), /Not a ShiftSense backup/);
});

test('location history can be forgotten without losing the hours', () => {
  const store = createStore(backend(), { now: () => NOW });
  store.addSample(at(HOUR));
  store.patch({ places: [{ id: 'p1' }], records: [{ date: '2026-08-24', shifts: [], status: 'confirmed' }] });
  store.forgetLocationHistory();

  assert.deepEqual(store.state.samples, []);
  assert.deepEqual(store.state.places, []);
  assert.equal(store.state.records.length, 1);
});

test('coveredDays reports which days can still be re-inferred', () => {
  assert.deepEqual(coveredDays([at(0), at(DAY), at(DAY + HOUR)]), ['2026-08-25', '2026-08-26']);
});

test('a second copy of the app does not erase the first one\'s fixes', () => {
  const shared = backend();
  const phone = createStore(shared, { now: () => NOW });
  const tab = createStore(shared, { now: () => NOW });

  phone.addSample(at(HOUR));
  // The other copy has been holding stale state all along; without a reload its
  // next write would drop the fix the first one just recorded.
  tab.reload();
  tab.addSample(at(30 * 60_000));

  assert.equal(createStore(shared, { now: () => NOW }).state.samples.length, 2);
});
