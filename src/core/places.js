/**
 * Learning where you spend your time.
 *
 * The app never asks you to draw a geofence. It watches where the phone
 * actually sits still, groups those fixes into places, works out which one is
 * home, and offers the rest as job sites once they have earned it.
 */

import { distance, centroid, extendCentroid, isUsable } from './geo.js';
import { dayKey, minutesIntoDay, MINUTE, HOUR } from './time.js';
import { withDefaults } from './settings.js';

let idCounter = 0;
/** Ids only need to be unique within one device's history. */
function newPlaceId(sample) {
  idCounter += 1;
  return `p_${Math.round(sample.lat * 1e4)}_${Math.round(sample.lon * 1e4)}_${idCounter}`;
}

function inOvernightWindow(ts, [from, to]) {
  const m = minutesIntoDay(ts);
  // The window wraps midnight, so it is two ranges, not one.
  return from > to ? m >= from || m < to : m >= from && m < to;
}

/**
 * Fold a batch of fixes into a set of places.
 *
 * Pass the places you already have as `existing` so ids, names and anything
 * the user corrected by hand survive re-learning. Only `samples` you have not
 * folded in before should be passed; each place carries `throughTs` so the
 * caller can tell what has already been counted.
 *
 * Returns new place objects — the inputs are not mutated.
 */
export function learnPlaces(samples, { existing = [], settings } = {}) {
  const cfg = withDefaults(settings);
  const places = existing.map((p) => ({
    ...p,
    days: new Set(p.days ?? []),
  }));

  const usable = samples
    .filter((s) => isUsable(s, cfg.maxAccuracyM))
    .sort((a, b) => a.ts - b.ts);

  const maxBridgeMs = cfg.maxBridgeMinutes * MINUTE;
  let prev = null;
  let prevPlace = null;

  for (const sample of usable) {
    let place = nearestPlace(places, sample, cfg.clusterRadiusM);

    if (!place) {
      place = {
        id: newPlaceId(sample),
        name: null,
        center: { lat: sample.lat, lon: sample.lon },
        radiusM: cfg.clusterRadiusM,
        sampleCount: 0,
        dwellMs: 0,
        overnightMs: 0,
        days: new Set(),
        firstTs: sample.ts,
        lastTs: sample.ts,
        kind: 'unknown', // 'work' | 'home' | 'other'
        pinned: false, // true once the user sets the kind by hand
      };
      places.push(place);
    }

    if (!place.pinnedLocation) {
      place.center = extendCentroid(place.center, place.sampleCount, sample);
      // Let a place grow to cover the fixes it actually owns — a work zone that
      // stretches a quarter mile down a highway is one place, not four.
      const spread = distance(place.center, sample);
      place.radiusM = Math.min(
        cfg.maxPlaceRadiusM,
        Math.max(place.radiusM, spread + (sample.accuracy ?? 0) / 2),
      );
    }
    place.sampleCount += 1;
    place.days.add(dayKey(sample.ts));
    place.firstTs = Math.min(place.firstTs, sample.ts);
    place.lastTs = Math.max(place.lastTs, sample.ts);

    // Credit the time since the previous fix only when that fix was at the same
    // place and close enough in time to be sure you never left.
    if (prev && prevPlace && prevPlace.id === place.id) {
      const gap = sample.ts - prev.ts;
      if (gap > 0 && gap <= maxBridgeMs) {
        place.dwellMs += gap;
        if (inOvernightWindow(prev.ts, cfg.overnightWindow)) {
          place.overnightMs += gap;
        }
      }
    }

    prev = sample;
    prevPlace = place;
  }

  const throughTs = usable.length ? usable[usable.length - 1].ts : null;
  return classifyPlaces(mergePlaces(places, cfg), cfg).map((p) => ({
    ...p,
    days: [...p.days].sort(),
    throughTs: throughTs ?? p.throughTs ?? null,
  }));
}

/**
 * Fuse places that turned out to be one place.
 *
 * Clustering assigns each fix to the nearest centre it already knows, which
 * splits anything longer than one radius into fragments — a highway work zone
 * that runs a quarter mile becomes three or four "places" that are plainly the
 * same job. This walks the fragments back together, so long as the result still
 * fits inside `maxPlaceRadiusM`; past that we are no longer describing a site.
 *
 * Two places the user has named are never fused: those names are a statement
 * that they are different jobs, and the app does not get to overrule it.
 */
export function mergePlaces(places, settings) {
  const cfg = withDefaults(settings);
  const result = [...places];

  for (;;) {
    const pair = findMergeable(result, cfg);
    if (!pair) return result;
    const [i, j, fused] = pair;
    result.splice(j, 1);
    result.splice(i, 1, fused);
  }
}

function findMergeable(places, cfg) {
  for (let i = 0; i < places.length; i += 1) {
    for (let j = i + 1; j < places.length; j += 1) {
      const a = places[i];
      const b = places[j];
      if (a.name && b.name) continue;
      if (a.pinned && b.pinned && a.kind !== b.kind) continue;

      // Fuse when one centre already sits inside the other's footprint. Two
      // tight clusters a couple of hundred metres apart stay separate — those
      // are two intersections. Two sprawling ones that overlap that far are a
      // single zone the clusterer happened to cut in half.
      const reach = Math.max(cfg.clusterRadiusM, a.radiusM, b.radiusM);
      if (distance(a.center, b.center) > reach) continue;

      const fused = fuse(a, b);
      if (fused.radiusM > cfg.maxPlaceRadiusM) continue;
      return [i, j, fused];
    }
  }
  return null;
}

function fuse(a, b) {
  const total = a.sampleCount + b.sampleCount || 1;
  const center = centroid([
    ...Array(Math.max(1, a.sampleCount)).fill(a.center),
    ...Array(Math.max(1, b.sampleCount)).fill(b.center),
  ]);
  // Keep whichever we met first, so its id — and anything the user attached to
  // it — carries forward.
  const [older, newer] = a.firstTs <= b.firstTs ? [a, b] : [b, a];
  return {
    ...older,
    center,
    radiusM: Math.max(
      distance(center, a.center) + a.radiusM,
      distance(center, b.center) + b.radiusM,
    ),
    sampleCount: total,
    dwellMs: a.dwellMs + b.dwellMs,
    overnightMs: a.overnightMs + b.overnightMs,
    days: new Set([...asDays(a), ...asDays(b)]),
    firstTs: Math.min(a.firstTs, b.firstTs),
    lastTs: Math.max(a.lastTs, b.lastTs),
    name: older.name ?? newer.name,
    pinned: a.pinned || b.pinned,
    kind: a.pinned ? a.kind : b.pinned ? b.kind : older.kind,
  };
}

function asDays(place) {
  return place.days instanceof Set ? [...place.days] : (place.days ?? []);
}

/** Nearest place whose own radius (or the default) contains the sample. */
export function nearestPlace(places, sample, defaultRadiusM) {
  let best = null;
  let bestD = Infinity;
  for (const p of places) {
    const d = distance(p.center, sample);
    const radius = Math.max(p.radiusM ?? defaultRadiusM, defaultRadiusM);
    if (d <= radius && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/**
 * Decide what each place is.
 *
 * Home is whichever place you sleep at most — that one matters because without
 * it, a driveway you sit in for an hour every morning would look like a job.
 * A place becomes a job site once it has real hours across more than one day.
 * Anything the user has pinned is left exactly as they set it.
 */
export function classifyPlaces(places, settings) {
  const cfg = withDefaults(settings);
  const minHomeMs = cfg.minHomeOvernightHours * HOUR;
  const minWorkMs = cfg.minWorkDwellHours * HOUR;

  let home = null;
  for (const p of places) {
    if (p.pinned && p.kind === 'home') {
      home = p;
      break;
    }
    if (p.overnightMs >= minHomeMs && (!home || p.overnightMs > home.overnightMs)) {
      home = p;
    }
  }

  return places.map((p) => {
    if (p.pinned) return p;
    if (home && p.id === home.id) return { ...p, kind: 'home' };
    const qualifies = p.dwellMs >= minWorkMs && dayCount(p) >= cfg.minWorkDays;
    return { ...p, kind: qualifies ? 'work' : 'other' };
  });
}

/** The places shifts are built from: learned job sites plus anything pinned as work. */
export function workSites(places) {
  return places.filter((p) => p.kind === 'work');
}

/** Human label for a place that has not been named yet. */
export function placeLabel(place) {
  if (place.name) return place.name;
  const lat = place.center.lat.toFixed(4);
  const lon = place.center.lon.toFixed(4);
  return `${lat}, ${lon}`;
}

/** Distinct days seen, whether `days` is still a Set or has been through JSON. */
export function dayCount(place) {
  const d = place.days;
  if (!d) return 0;
  return d instanceof Set ? d.size : d.length;
}
