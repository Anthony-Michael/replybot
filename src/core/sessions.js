/**
 * Turning a scatter of GPS fixes into shifts you would recognise as your day.
 *
 * Two steps. First `buildVisits` collapses the fixes into runs of "you were
 * here from about this time to about this time", including the runs where you
 * were somewhere we do not have a name for — those matter as evidence that you
 * had actually left. Then `buildShifts` keeps the runs at job sites and stitches
 * each day's runs into shifts, deciding for every hole in the record whether it
 * was a break, a trip home, or simply a stretch where the phone told us nothing.
 */

import { isUsable } from './geo.js';
import { nearestPlace } from './places.js';
import { dayKey, MINUTE } from './time.js';
import { withDefaults } from './settings.js';

/**
 * Collapse ordered fixes into visits. Every fix lands in exactly one visit;
 * `placeId: null` means "somewhere off the map we know".
 */
export function buildVisits(samples, places, settings) {
  const cfg = withDefaults(settings);
  const maxBridgeMs = cfg.maxBridgeMinutes * MINUTE;
  const padMs = cfg.edgePaddingMinutes * MINUTE;

  const usable = samples
    .filter((s) => isUsable(s, cfg.maxAccuracyM))
    .sort((a, b) => a.ts - b.ts)
    .map((s) => ({
      ...s,
      placeId: nearestPlace(places, s, cfg.clusterRadiusM)?.id ?? null,
    }));

  // A gap longer than this inside a run is silence worth reporting, not just
  // the normal spacing between fixes.
  const silenceMs = cfg.unpaidBreakMinutes * MINUTE;

  const runs = [];
  for (const s of usable) {
    const open = runs[runs.length - 1];
    const continues =
      open && open.placeId === s.placeId && s.ts - open.lastTs <= maxBridgeMs;
    if (continues) {
      if (s.ts - open.lastTs > silenceMs) {
        open.blindGaps.push({ start: open.lastTs, end: s.ts, ms: s.ts - open.lastTs });
      }
      open.lastTs = s.ts;
      open.sampleCount += 1;
    } else {
      runs.push({
        placeId: s.placeId,
        firstTs: s.ts,
        lastTs: s.ts,
        sampleCount: 1,
        blindGaps: [],
      });
    }
  }

  // Push each edge out toward the neighbouring fix, but only so far. A midpoint
  // guess is fair when the phone checked in ten minutes ago; across a four-hour
  // hole it would invent two hours of pay, so the padding caps it.
  return runs.map((run, i) => {
    const before = runs[i - 1];
    const after = runs[i + 1];
    const startEdge = edge(before ? run.firstTs - before.lastTs : null, padMs);
    const endEdge = edge(after ? after.firstTs - run.lastTs : null, padMs);
    return {
      placeId: run.placeId,
      start: run.firstTs - startEdge.applied,
      end: run.lastTs + endEdge.applied,
      firstTs: run.firstTs,
      lastTs: run.lastTs,
      sampleCount: run.sampleCount,
      blindGaps: run.blindGaps,
      uncertaintyMs: startEdge.uncertainty + endEdge.uncertainty,
    };
  });
}

function edge(gapMs, padMs) {
  if (gapMs == null) return { applied: 0, uncertainty: padMs };
  const applied = Math.min(gapMs / 2, padMs);
  return { applied, uncertainty: gapMs - applied };
}

/**
 * Stitch visits into shifts, one group per calendar day of the shift's start.
 * A shift that runs past midnight stays on the day it began, which is how
 * payroll reads a night shift.
 */
export function buildShifts(visits, places, settings) {
  const cfg = withDefaults(settings);
  const siteIds = new Set(places.filter((p) => p.kind === 'work').map((p) => p.id));
  const minVisitMs = cfg.minVisitMinutes * MINUTE;
  const splitGapMs = cfg.splitShiftGapMinutes * MINUTE;
  const breakGapMs = cfg.unpaidBreakMinutes * MINUTE;
  const blindMergeMs = cfg.maxBlindMergeMinutes * MINUTE;

  const ordered = [...visits].sort((a, b) => a.start - b.start);
  const shifts = [];
  let current = null;
  let lastIdx = -1;

  for (let i = 0; i < ordered.length; i += 1) {
    const visit = ordered[i];
    if (!siteIds.has(visit.placeId)) continue;
    if (isDriveBy(visit, minVisitMs)) continue;

    if (!current) {
      current = openShift(visit);
      lastIdx = i;
      continue;
    }

    const gapMs = visit.start - current.end;
    // Did anything at all get recorded while you were away from the site?
    // A fix somewhere else is proof you left; silence is only ever a guess.
    const sawElsewhere = ordered
      .slice(lastIdx + 1, i)
      .some((v) => v.placeId !== visit.placeId);
    lastIdx = i;

    // A blind gap can only be bridged when the same site sits on both sides.
    // Site A in the morning and site B in the evening with silence between is
    // two jobs, not one twelve-hour shift.
    const sameSite = visit.placeId === current.lastPlaceId;
    const shouldSplit = sawElsewhere
      ? gapMs > splitGapMs
      : !sameSite || gapMs > blindMergeMs;

    if (shouldSplit) {
      shifts.push(closeShift(current));
      current = openShift(visit);
      continue;
    }


    if (sawElsewhere && gapMs >= breakGapMs) {
      current.breaks.push({ start: current.end, end: visit.start, ms: gapMs });
    } else if (!sawElsewhere && gapMs > breakGapMs) {
      // Paid, because we have no evidence you left — but flagged, because we
      // have no evidence you stayed either.
      current.blindGaps.push({ start: current.end, end: visit.start, ms: gapMs });
    }

    current.segments.push({ placeId: visit.placeId, start: visit.start, end: visit.end });
    current.blindGaps.push(...visit.blindGaps);
    current.end = visit.end;
    current.lastPlaceId = visit.placeId;
    current.uncertaintyMs += visit.uncertaintyMs;
  }

  if (current) shifts.push(closeShift(current));
  return shifts;
}

/**
 * A stop we can prove was brief: short, and hemmed in by fixes close enough on
 * both sides that there was no room for more. A lone fix surrounded by hours of
 * silence looks just as short, but proves nothing, so it is not a drive-by.
 */
function isDriveBy(visit, minVisitMs) {
  return visit.end - visit.start < minVisitMs && visit.uncertaintyMs < minVisitMs;
}

function openShift(visit) {
  return {
    start: visit.start,
    end: visit.end,
    lastPlaceId: visit.placeId,
    segments: [{ placeId: visit.placeId, start: visit.start, end: visit.end }],
    breaks: [],
    blindGaps: [...visit.blindGaps],
    uncertaintyMs: visit.uncertaintyMs,
  };
}

function closeShift(shift) {
  const breakMs = shift.breaks.reduce((sum, b) => sum + b.ms, 0);
  const blindMs = shift.blindGaps.reduce((sum, g) => sum + g.ms, 0);
  const siteIds = [...new Set(shift.segments.map((s) => s.placeId))];
  const blindGaps = [...shift.blindGaps].sort((a, b) => a.start - b.start);
  return {
    id: `s_${shift.start}`,
    date: dayKey(shift.start),
    start: shift.start,
    end: shift.end,
    siteIds,
    segments: shift.segments,
    breaks: shift.breaks,
    breakMs,
    blindGaps,
    blindMs,
    workedMs: Math.max(0, shift.end - shift.start - breakMs),
    uncertaintyMs: shift.uncertaintyMs,
    confidence: rateConfidence(shift.uncertaintyMs, blindMs),
    source: 'auto',
  };
}

/**
 * How much this shift deserves a second look before it goes on a timesheet.
 * Anything but `high` gets a "check this" marker in the day list.
 */
export function rateConfidence(uncertaintyMs, blindMs) {
  const worstMinutes = (uncertaintyMs + blindMs) / MINUTE;
  if (worstMinutes > 60) return 'low';
  if (worstMinutes > 20) return 'medium';
  return 'high';
}

/** Group shifts by their day key, oldest first. */
export function shiftsByDay(shifts) {
  const byDay = new Map();
  for (const shift of [...shifts].sort((a, b) => a.start - b.start)) {
    if (!byDay.has(shift.date)) byDay.set(shift.date, []);
    byDay.get(shift.date).push(shift);
  }
  return byDay;
}
