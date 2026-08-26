/**
 * Every tuning number in one place, with the reasoning attached. These are
 * defaults for someone who drives to a job site and stays there; the Settings
 * screen writes overrides into the same shape.
 */

export const DEFAULTS = {
  // --- Sampling -------------------------------------------------------------
  /** Reject fixes vaguer than this; they cannot tell us which side of a site
   *  boundary you are on. */
  maxAccuracyM: 150,
  /** How often to take a fix while the app is open and you are on a site. */
  sampleIntervalMs: 2 * 60_000,
  /** How often to take a fix while the app is open and you are not. */
  idleSampleIntervalMs: 5 * 60_000,

  // --- Learning places ------------------------------------------------------
  /** Two fixes closer than this are treated as the same place. A highway work
   *  zone is long, so this is generous compared with a typical office geofence. */
  clusterRadiusM: 150,
  /** A place never grows past this, so one long corridor does not swallow the
   *  next town over. */
  maxPlaceRadiusM: 400,
  /** Same place before and after a gap means you almost certainly stayed, but
   *  only credit it up to here — beyond that we are guessing. */
  maxBridgeMinutes: 360,
  /** Hours of total presence before a place is offered as a job site. */
  minWorkDwellHours: 6,
  /** Distinct days of presence before a place is offered as a job site. */
  minWorkDays: 2,
  /** Presence during these local hours is what marks a place as home. */
  overnightWindow: [22 * 60, 5 * 60],
  /** Home needs this much overnight presence before we trust the label. */
  minHomeOvernightHours: 8,

  // --- Turning presence into shifts ----------------------------------------
  /** Ignore drive-bys: a stop shorter than this is not a shift. */
  minVisitMinutes: 20,
  /** How far past the first/last fix an arrival or departure may be pushed when
   *  sampling was sparse. Keeps a 9-hour blind spot from inventing 4 hours. */
  edgePaddingMinutes: 15,
  /** An off-site gap longer than this starts a separate shift rather than
   *  becoming a break — you went home and came back. */
  splitShiftGapMinutes: 180,
  /** An off-site gap at least this long inside a shift is an unpaid break.
   *  Shorter gaps stay paid: moving the truck, walking the zone. */
  unpaidBreakMinutes: 30,
  /** A hole in the record with no fixes at all, bracketed by the same site on
   *  both sides, is read as "you stayed" up to this long. Generous on purpose:
   *  if the phone saw you on the job at seven and again at three, splitting
   *  that into two fifteen-minute shifts is far more wrong than joining it.
   *  The day is flagged for review either way. */
  maxBlindMergeMinutes: 720,

  // --- Pay rules ------------------------------------------------------------
  /** 0 = Sunday. Payroll weeks differ; this drives weekly overtime. */
  weekStartsOn: 0,
  /** Hours in a day past which time counts as overtime. Null disables. */
  dailyOtAfterHours: 8,
  /** Hours in a week past which time counts as overtime. Null disables. */
  weeklyOtAfterHours: 40,
  /** Hours in a day past which time counts as double time. Null disables. */
  doubleTimeAfterHours: null,
  /** Round each shift to this many minutes. 6 = tenths of an hour. */
  roundToMinutes: 1,
};

export function withDefaults(overrides = {}) {
  return { ...DEFAULTS, ...overrides };
}
