import test from 'node:test';
import assert from 'node:assert/strict';
import { learnPlaces, workSites, dayCount, nearestPlace } from '../src/core/places.js';
import { distance } from '../src/core/geo.js';
import { HOUR } from '../src/core/time.js';
import { SITE, HOME, trace, hours } from './helpers.js';

/** A normal week: home overnight, one job site through the day. */
function week() {
  const days = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'];
  const samples = [];
  for (const date of days) {
    samples.push(...trace(date, HOME, '00:00', '05:40', 20));
    samples.push(...trace(date, SITE, '06:30', '16:00', 15));
    samples.push(...trace(date, HOME, '17:00', '23:50', 20));
  }
  return { days, samples };
}

test('a recurring job site is learned without being told about it', () => {
  const { samples } = week();
  const places = learnPlaces(samples);
  const sites = workSites(places);

  assert.equal(sites.length, 1, `expected one job site, got ${sites.length}`);
  assert.ok(distance(sites[0].center, SITE) < 60, 'site centre should sit on the road');
  assert.equal(dayCount(sites[0]), 5);
});

test('home is identified by where you sleep and is never a job site', () => {
  const { samples } = week();
  const places = learnPlaces(samples);
  const home = places.find((p) => p.kind === 'home');

  assert.ok(home, 'home should be identified');
  assert.ok(distance(home.center, HOME) < 60);
  assert.ok(home.overnightMs >= 8 * HOUR, `overnight dwell was ${hours(home.overnightMs)}h`);
  assert.equal(workSites(places).some((p) => p.id === home.id), false);
});

test('a place you visit once is not promoted to a job site', () => {
  const { samples } = week();
  const oneOff = trace('2026-08-29', { lat: 41.9, lon: -72.9 }, '09:00', '18:00', 15);
  const places = learnPlaces([...samples, ...oneOff]);

  const stranger = places.find((p) => distance(p.center, { lat: 41.9, lon: -72.9 }) < 200);
  assert.ok(stranger, 'the place should still be remembered');
  assert.equal(stranger.kind, 'other', 'one long day is not yet a job');
});

test('learning is incremental — ids and names survive a second pass', () => {
  const { samples } = week();
  const first = learnPlaces(samples);
  const named = first.map((p) => (p.kind === 'work' ? { ...p, name: 'Route 9' } : p));

  const nextDay = trace('2026-08-31', SITE, '06:30', '16:00', 15);
  const second = learnPlaces(nextDay, { existing: named });

  const site = workSites(second)[0];
  assert.equal(site.name, 'Route 9', 'a name the user gave must stick');
  assert.equal(site.id, workSites(named)[0].id, 'ids must be stable');
  assert.equal(dayCount(site), 6, 'the new day should be folded in');
});

test('a place the user pinned is left exactly as they set it', () => {
  const { samples } = week();
  const places = learnPlaces(samples);
  const home = places.find((p) => p.kind === 'home');

  // "I work out of my yard" — pin home as a job site and re-learn.
  const pinned = places.map((p) => (p.id === home.id ? { ...p, kind: 'work', pinned: true } : p));
  const after = learnPlaces(trace('2026-08-31', SITE, '06:30', '16:00', 15), { existing: pinned });

  assert.equal(after.find((p) => p.id === home.id).kind, 'work');
});

test('vague fixes never drag a site centre off the road', () => {
  const { samples } = week();
  const junk = trace('2026-08-26', { lat: 41.60, lon: -72.50 }, '10:00', '11:00', 10, 900);
  const places = learnPlaces([...samples, ...junk]);

  assert.equal(workSites(places).length, 1);
  assert.ok(distance(workSites(places)[0].center, SITE) < 60);
});

test('a site grows to cover a work zone but stops before the next town', () => {
  // A quarter-mile of highway worked end to end.
  const spread = [];
  for (let i = 0; i < 5; i += 1) {
    spread.push(...trace('2026-08-24', { lat: SITE.lat + i * 0.0008, lon: SITE.lon }, `0${6 + i}:00`, `0${6 + i}:50`, 10));
    spread.push(...trace('2026-08-25', { lat: SITE.lat + i * 0.0008, lon: SITE.lon }, `0${6 + i}:00`, `0${6 + i}:50`, 10));
  }
  const places = learnPlaces(spread);
  assert.equal(places.length, 1, 'one work zone, not five places');
  assert.ok(places[0].radiusM <= 400, `radius ran away to ${places[0].radiusM}`);
});

test('nearestPlace picks the closer of two adjacent sites', () => {
  const places = [
    { id: 'a', center: SITE, radiusM: 150 },
    { id: 'b', center: { lat: SITE.lat + 0.002, lon: SITE.lon }, radiusM: 150 },
  ];
  assert.equal(nearestPlace(places, { ...SITE, ts: 1 }, 150).id, 'a');
  assert.equal(nearestPlace(places, { lat: SITE.lat + 0.0019, lon: SITE.lon, ts: 1 }, 150).id, 'b');
  assert.equal(nearestPlace(places, { lat: 40, lon: -71, ts: 1 }, 150), null);
});
