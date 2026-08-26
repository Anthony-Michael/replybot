/**
 * A static server for local development. Geolocation needs a secure context,
 * which localhost counts as, so this is enough to try the real thing in a
 * phone browser over a tunnel or in a desktop browser with location spoofed.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const relative = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');

  try {
    const body = await readFile(join(ROOT, relative));
    response.writeHead(200, {
      'content-type': TYPES[extname(relative)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('Not found');
  }
}).listen(PORT, () => console.log(`ShiftSense on http://localhost:${PORT}`));
