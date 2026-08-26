import test from 'node:test';
import assert from 'node:assert/strict';
import { distance, centroid, extendCentroid, isUsable } from '../src/core/geo.js';

test('distance matches a known separation', () => {
  // One degree of latitude is ~111.2 km anywhere on earth.
  const d = distance({ lat: 41, lon: -72 }, { lat: 42, lon: -72 });
  assert.ok(Math.abs(d - 111_195) < 500, `got ${d}`);
});

test('distance is symmetric and zero for a point against itself', () => {
  const a = { lat: 41.7658, lon: -72.6734 };
  const b = { lat: 41.7702, lon: -72.6688 };
  assert.equal(distance(a, a), 0);
  assert.ok(Math.abs(distance(a, b) - distance(b, a)) < 1e-6);
});

test('centroid averages a cluster', () => {
  const c = centroid([
    { lat: 10, lon: 20 },
    { lat: 12, lon: 22 },
  ]);
  assert.ok(Math.abs(c.lat - 11) < 1e-9);
  assert.ok(Math.abs(c.lon - 21) < 1e-6);
});

test('centroid survives the antimeridian', () => {
  const c = centroid([
    { lat: 0, lon: 179.9 },
    { lat: 0, lon: -179.9 },
  ]);
  assert.ok(Math.abs(Math.abs(c.lon) - 180) < 0.01, `got ${c.lon}`);
});

test('extendCentroid matches a full recompute', () => {
  const points = [
    { lat: 41.7, lon: -72.6 },
    { lat: 41.8, lon: -72.7 },
    { lat: 41.75, lon: -72.65 },
  ];
  let running = null;
  points.forEach((p, i) => {
    running = extendCentroid(running, i, p);
  });
  const full = centroid(points);
  assert.ok(distance(running, full) < 1, 'incremental centroid drifted');
});

test('vague fixes are rejected', () => {
  const base = { lat: 41, lon: -72, ts: Date.now() };
  assert.equal(isUsable({ ...base, accuracy: 30 }), true);
  assert.equal(isUsable({ ...base, accuracy: 800 }), false);
  assert.equal(isUsable({ lat: 41, lon: -72 }), false, 'needs a timestamp');
});
