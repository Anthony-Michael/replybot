/**
 * Geometry for GPS points. At job-site scale (tens to hundreds of metres) the
 * earth is flat enough that a plain mean is a fine centroid, but distances are
 * done properly with haversine so a site radius means the same thing at any
 * latitude.
 */

const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance between two {lat, lon} points, in metres. */
export function distance(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Mean position of a set of points. Longitudes are averaged through their unit
 * vectors so a cluster straddling the antimeridian does not collapse to zero.
 */
export function centroid(points) {
  if (points.length === 0) return null;
  let lat = 0;
  let x = 0;
  let y = 0;
  for (const p of points) {
    lat += p.lat;
    const lon = toRad(p.lon);
    x += Math.cos(lon);
    y += Math.sin(lon);
  }
  return {
    lat: lat / points.length,
    lon: (Math.atan2(y / points.length, x / points.length) * 180) / Math.PI,
  };
}

/**
 * Fold a new point into a running centroid without keeping every sample.
 * Same antimeridian-safe averaging as `centroid`, in incremental form.
 */
export function extendCentroid(current, count, point) {
  if (!current || count === 0) return { lat: point.lat, lon: point.lon };
  const n = count + 1;
  const lonCur = toRad(current.lon);
  const lonNew = toRad(point.lon);
  const x = (Math.cos(lonCur) * count + Math.cos(lonNew)) / n;
  const y = (Math.sin(lonCur) * count + Math.sin(lonNew)) / n;
  return {
    lat: (current.lat * count + point.lat) / n,
    lon: (Math.atan2(y, x) * 180) / Math.PI,
  };
}

/**
 * A phone reports GPS accuracy as a radius of likely error. A sample that says
 * "somewhere within 400m" cannot tell us whether you are on the job site, so
 * the tracker throws those away rather than letting them smear a cluster.
 */
export function isUsable(sample, maxAccuracyM = 150) {
  return (
    Number.isFinite(sample?.lat) &&
    Number.isFinite(sample?.lon) &&
    Number.isFinite(sample?.ts) &&
    (!Number.isFinite(sample.accuracy) || sample.accuracy <= maxAccuracyM)
  );
}
