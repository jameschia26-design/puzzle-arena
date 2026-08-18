/**
 * Emits the PWA icon set from tools/logo.mjs.
 *
 *   node tools/make-icons.mjs
 *
 * Writes PNGs by hand rather than pulling in a rasteriser: the mark is nothing
 * but axis-aligned rectangles, so painting it into a pixel buffer gives exact,
 * un-anti-aliased edges at every size — which is what a pixel logo wants, and
 * what a general-purpose SVG rasteriser would smudge.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shapes, toSvg, UNITS, PALETTE } from './logo.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'apps', 'web', 'public');

/* ------------------------------- PNG ------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // Each scanline is prefixed with filter type 0 (None).
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const at = y * (1 + width * 4);
    raw[at] = 0;
    rgba.copy(raw, at + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------ render ----------------------------- */

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

function render(size, options) {
  const rgba = Buffer.alloc(size * size * 4); // transparent by default
  const scale = size / UNITS;

  for (const rect of shapes(options)) {
    const [r, g, b] = hexToRgb(rect.fill);
    // Round to pixel boundaries so adjacent rects tile with no seam or blur.
    const x0 = Math.max(0, Math.round(rect.x * scale));
    const y0 = Math.max(0, Math.round(rect.y * scale));
    const x1 = Math.min(size, Math.round((rect.x + rect.w) * scale));
    const y1 = Math.min(size, Math.round((rect.y + rect.h) * scale));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const at = (y * size + x) * 4;
        rgba[at] = r;
        rgba[at + 1] = g;
        rgba[at + 2] = b;
        rgba[at + 3] = 255;
      }
    }
  }
  return encodePng(size, size, rgba);
}

/* ------------------------------ write ------------------------------ */

mkdirSync(publicDir, { recursive: true });

const outputs = [
  // Android / desktop install icons.
  ['icon-192.png', render(192, {})],
  ['icon-512.png', render(512, {})],
  // Maskable: the launcher crops to a circle, so the art is inset into the
  // safe zone and the background bleeds to the edge.
  ['icon-maskable-512.png', render(512, { inset: 4 })],
  // iOS home screen. iOS applies its own rounding and ignores transparency.
  ['apple-touch-icon.png', render(180, {})],
  ['favicon-32.png', render(32, {})],
  ['logo.svg', Buffer.from(toSvg(), 'utf8')],
  // Transparent variant for use inside the app, where the page already has
  // the background.
  ['logo-flat.svg', Buffer.from(toSvg({ background: false }), 'utf8')],
];

for (const [name, data] of outputs) {
  writeFileSync(join(publicDir, name), data);
  console.log(`${name.padEnd(24)} ${String(data.length).padStart(7)} bytes`);
}
console.log(`\nwrote ${outputs.length} files to ${publicDir}`);
console.log(`palette: ${Object.entries(PALETTE).map(([k, v]) => `${k}=${v}`).join(' ')}`);
