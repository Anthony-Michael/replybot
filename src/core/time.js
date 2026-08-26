/**
 * Time helpers. Everything here works in the device's local timezone, because a
 * work day is a local-clock concept: a shift that starts at 06:00 belongs to
 * that calendar day wherever the crew happens to be.
 */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** 'YYYY-MM-DD' for a timestamp, in local time. */
export function dayKey(ts) {
  const d = new Date(ts);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Local midnight (ms) that starts the day containing `ts`. */
export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Parse 'YYYY-MM-DD' to the local-midnight timestamp of that day. */
export function dayKeyToTs(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/**
 * First day of the pay week containing `ts`.
 * `weekStartsOn` is 0=Sunday .. 6=Saturday. Many construction and flagging
 * outfits run a Sunday or Monday week; both are common, so it is a setting.
 */
export function startOfWeek(ts, weekStartsOn = 0) {
  const start = startOfDay(ts);
  const dow = new Date(start).getDay();
  const back = (dow - weekStartsOn + 7) % 7;
  return start - back * DAY;
}

/** Minutes since local midnight, useful for "is this an overnight sample". */
export function minutesIntoDay(ts) {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

/** 'HH:MM' 24-hour clock. */
export function clock(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 'h:mm AM' for display. */
export function clock12(ts) {
  const d = new Date(ts);
  const h = d.getHours();
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(d.getMinutes()).padStart(2, '0')} ${suffix}`;
}

/** Duration in ms as '7h 45m'. */
export function duration(ms) {
  const total = Math.max(0, Math.round(ms / MINUTE));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Hours as a decimal, rounded to 2dp — the format payroll wants. */
export function decimalHours(ms) {
  return Math.round((ms / HOUR) * 100) / 100;
}

/** Combine a 'YYYY-MM-DD' with an 'HH:MM' into a local timestamp. */
export function combine(key, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return dayKeyToTs(key) + h * HOUR + m * MINUTE;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function weekdayName(ts) {
  return WEEKDAY_NAMES[new Date(ts).getDay()];
}

export function isWeekend(ts) {
  const dow = new Date(ts).getDay();
  return dow === 0 || dow === 6;
}
