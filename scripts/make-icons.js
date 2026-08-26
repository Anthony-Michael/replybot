/**
 * Renders the app icon to PNG without pulling in a build toolchain.
 *
 * The whole icon is describable in maths — a rounded square, a clock face, two
 * hands — so it is cheaper to rasterise it here than to depend on anything.
 * Run with `node scripts/make-icons.js` after changing the artwork.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BRAND = [27, 73, 101];
const INK = [255, 255, 255];
const ACCENT = [95, 211, 154];

/** Signed distance to a rounded square centred on the canvas. */
function roundedSquare(x, y, size, radius) {
  const half = size / 2;
  const dx = Math.abs(x - half) - (half - radius);
  const dy = Math.abs(y - half) - (half - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

const mix = (a, b, t) => a.map((c, i) => Math.round(c + (b[i] - c) * t));
/** Anti-aliasing: turn a signed distance into coverage over one pixel. */
const coverage = (d) => Math.min(1, Math.max(0, 0.5 - d));

function pixel(x, y, size) {
  const s = size / 512;
  const bg = coverage(roundedSquare(x, y, size, 112 * s));
  if (bg <= 0) return [0, 0, 0, 0];

  const cx = size / 2;
  const cy = size / 2;
  const r = Math.hypot(x - cx, y - cy);

  let colour = BRAND;

  // Clock face: a heavy ring.
  const ring = Math.abs(r - 150 * s) - 18 * s;
  colour = mix(colour, INK, coverage(ring));

  // Hour hand pointing at seven, minute hand at twelve — a shift that started
  // early and is still running.
  colour = mix(colour, ACCENT, coverage(hand(x, y, cx, cy, -Math.PI / 2, 108 * s, 17 * s)));
  colour = mix(colour, INK, coverage(hand(x, y, cx, cy, Math.PI * 0.72, 78 * s, 19 * s)));

  // Centre pin.
  colour = mix(colour, ACCENT, coverage(r - 26 * s));

  return [...colour, Math.round(bg * 255)];
}

/** Distance to a capsule from the centre out along `angle`. */
function hand(x, y, cx, cy, angle, length, width) {
  const px = x - cx;
  const py = y - cy;
  const ax = Math.cos(angle);
  const ay = Math.sin(angle);
  const t = Math.min(length, Math.max(0, px * ax + py * ay));
  return Math.hypot(px - ax * t, py - ay * t) - width / 2;
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
      offset += 4;
    }
  }

  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

for (const size of [192, 512]) {
  writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), png(size));
  console.log(`icons/icon-${size}.png`);
}
