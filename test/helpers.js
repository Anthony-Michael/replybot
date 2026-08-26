/** Fixture helpers: build fake GPS traces that read like a real day. */

import { dayKeyToTs, MINUTE, HOUR } from '../src/core/time.js';

export const SITE = { lat: 41.7658, lon: -72.6734 }; // a stretch of road
export const HOME = { lat: 41.8102, lon: -72.7311 }; // ~6km away
export const DINER = { lat: 41.7801, lon: -72.6900 };

/** Nudge a point a few metres, the way a real fix jitters. */
export function jitter(point, metres = 25, seed = 1) {
  const dLat = (metres / 111_320) * Math.sin(seed);
  const dLon = (metres / (111_320 * Math.cos((point.lat * Math.PI) / 180))) * Math.cos(seed);
  return { lat: point.lat + dLat, lon: point.lon + dLon };
}

/** Fixes at `point` every `everyMin` from `fromHHMM` to `toHHMM` on `date`. */
export function trace(date, point, fromHHMM, toHHMM, everyMin = 10, accuracy = 20) {
  const base = dayKeyToTs(date);
  const at = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return base + h * HOUR + m * MINUTE;
  };
  const out = [];
  let seed = 0;
  for (let ts = at(fromHHMM); ts <= at(toHHMM); ts += everyMin * MINUTE) {
    seed += 1.7;
    out.push({ ts, ...jitter(point, 20, seed), accuracy });
  }
  return out;
}

/** A single fix, for sparse traces. */
export function fix(date, point, hhmm, accuracy = 20) {
  const base = dayKeyToTs(date);
  const [h, m] = hhmm.split(':').map(Number);
  return { ts: base + h * HOUR + m * MINUTE, ...jitter(point, 15, h + m), accuracy };
}

export const hours = (ms) => Math.round((ms / HOUR) * 100) / 100;
