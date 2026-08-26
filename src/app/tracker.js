/**
 * Getting fixes out of the phone.
 *
 * The honest constraint: a web app cannot read location with the screen off.
 * That is an operating-system rule, not something more code fixes. So this does
 * everything it legitimately can — takes a fix the instant the app is opened,
 * keeps a watch running while it is on screen, and can hold a wake lock through
 * a shift so the phone keeps reporting from a pocket — and the inference layer
 * is built to cope with the holes that remain rather than pretend they are not
 * there.
 */

import { refresh, currentStatus } from '../core/engine.js';

export const PERMISSION = {
  UNKNOWN: 'unknown',
  GRANTED: 'granted',
  DENIED: 'denied',
  UNAVAILABLE: 'unavailable',
};

export function createTracker(store, { onUpdate = () => {}, now = () => Date.now() } = {}) {
  let watchId = null;
  let timer = null;
  let wakeLock = null;
  let permission = PERMISSION.UNKNOWN;
  let lastError = null;

  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  function record(position) {
    permission = PERMISSION.GRANTED;
    lastError = null;
    store.addSample({
      ts: position.timestamp ?? now(),
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracy: position.coords.accuracy,
    });
    refresh(store, now());
    syncWakeLock();
    onUpdate();
  }

  function fail(error) {
    // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
    if (error.code === 1) permission = PERMISSION.DENIED;
    lastError = { code: error.code, message: error.message, at: now() };
    onUpdate();
  }

  const OPTIONS = { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 };

  /** One fix, right now. Used on every app open — the cheapest useful signal. */
  function sampleOnce() {
    if (!supported) {
      permission = PERMISSION.UNAVAILABLE;
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          record(p);
          resolve(p);
        },
        (e) => {
          fail(e);
          resolve(null);
        },
        OPTIONS,
      );
    });
  }

  /**
   * The wake lock is what turns this from "hours if you remember to look" into
   * something that runs itself, so it is held whenever a shift is open and
   * dropped the moment one is not.
   */
  async function syncWakeLock() {
    const wanted =
      store.state.settings.keepAwakeOnShift !== false &&
      currentStatus(store.state, now()).onSite;

    if (wanted && !wakeLock && typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          wakeLock = null;
        });
      } catch {
        wakeLock = null; // Denied, or the battery is too low. Not fatal.
      }
    } else if (!wanted && wakeLock) {
      try {
        await wakeLock.release();
      } catch {
        /* already gone */
      }
      wakeLock = null;
    }
  }

  function currentInterval() {
    const { settings } = store.state;
    return currentStatus(store.state, now()).onSite
      ? settings.sampleIntervalMs
      : settings.idleSampleIntervalMs;
  }

  function scheduleNext() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await sampleOnce();
      scheduleNext();
    }, currentInterval());
  }

  function start() {
    if (!supported) {
      permission = PERMISSION.UNAVAILABLE;
      onUpdate();
      return;
    }
    // A watch and a timer do different jobs: the watch reports movement as it
    // happens, the timer guarantees a fix even while you stand still all day.
    if (watchId === null) {
      watchId = navigator.geolocation.watchPosition(record, fail, OPTIONS);
    }
    sampleOnce();
    scheduleNext();
  }

  function stop() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    clearTimeout(timer);
    timer = null;
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  /** Coming back to the app is itself information: take a fix immediately. */
  function handleVisibility() {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'visible') {
      sampleOnce();
      syncWakeLock();
      scheduleNext();
    }
  }

  async function requestPermission() {
    const position = await sampleOnce();
    return position ? PERMISSION.GRANTED : permission;
  }

  async function readPermission() {
    if (!supported) return PERMISSION.UNAVAILABLE;
    if (typeof navigator.permissions?.query !== 'function') return permission;
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      permission = status.state === 'prompt' ? PERMISSION.UNKNOWN : status.state;
      status.addEventListener?.('change', () => {
        permission = status.state === 'prompt' ? PERMISSION.UNKNOWN : status.state;
        onUpdate();
      });
    } catch {
      /* Safari and friends; fall back to whatever a real call told us. */
    }
    return permission;
  }

  return {
    start,
    stop,
    sampleOnce,
    requestPermission,
    readPermission,
    handleVisibility,
    syncWakeLock,
    get supported() {
      return supported;
    },
    get permission() {
      return permission;
    },
    get lastError() {
      return lastError;
    },
    get holdingWakeLock() {
      return Boolean(wakeLock);
    },
  };
}
