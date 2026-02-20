#!/usr/bin/env node
/**
 * generate-icon.js
 *
 * Generates vscode-extension/media/icon.png using pure Node.js built-ins.
 * No external dependencies required.
 *
 * Design: 16×16 logical pixel art, each logical pixel = 8×8 real pixels → 128×128 PNG
 *
 * Layout:
 *   Rows  0-3  Palm leaves (symmetric, two-branch spread)
 *   Rows  4-9  Coconut (centered, brown with highlight)
 *   Row  10    Empty separator
 *   Rows 11-15 Terminal prompt: >_ (green chevron + bright cursor block)
 *
 * The cursor block (bright green) sits right at the tip of the > arrow —
 * a visual metaphor for "the agent is ready to act at this exact point".
 */

'use strict';

const { deflateSync } = require('zlib');
const { writeFileSync, mkdirSync } = require('fs');
const { join, dirname } = require('path');

// ─── Config ────────────────────────────────────────────────────────────────
const SCALE   = 8;    // logical → real pixels
const LOGICAL = 16;   // grid size
const W = LOGICAL * SCALE; // 128
const H = LOGICAL * SCALE; // 128

// ─── RGBA palette ──────────────────────────────────────────────────────────
// Key → [R, G, B, A]
const C = {
  0: [ 13,  17,  23, 255],   // dark background  #0d1117
  1: [ 74,  44,  23, 255],   // coconut shadow
  2: [122,  74,  40, 255],   // coconut dark
  3: [168, 101,  53, 255],   // coconut base
  4: [220, 160, 110, 255],   // coconut highlight
  5: [ 26,  77,  26, 255],   // palm dark
  6: [ 45, 122,  45, 255],   // palm green
  7: [ 74, 170,  74, 255],   // palm light
  8: [ 57, 211,  83, 255],   // terminal green  (> arrow)
  9: [160, 255, 180, 255],   // terminal bright (cursor block)
};

// ─── 16×16 logical pixel grid ──────────────────────────────────────────────
//
//  Palm layout (rows 0-3):
//    r0: two leaf pairs spreading outward
//    r1: leaves wider
//    r2: leaves converging inward
//    r3: narrow junction above trunk
//
//  Coconut (rows 4-9): brown sphere with highlight, hanging from trunk
//
//  >_ prompt (rows 11-15):
//    > chevron at cols 5-7 (tip at col 7, rows 11-13-15 form the V shape)
//    _ cursor block at cols 7-10, rows 14-15
//
const G = [
  [0,0,0,5,6,7,0,0,0,7,6,5,0,0,0,0],  // r0  palm leaves outer
  [0,0,5,6,7,6,5,0,5,6,7,6,5,0,0,0],  // r1  palm leaves wide
  [0,0,0,5,6,7,6,0,6,7,6,5,0,0,0,0],  // r2  palm leaves inner
  [0,0,0,0,0,6,7,7,7,6,0,0,0,0,0,0],  // r3  trunk junction
  [0,0,0,0,0,1,2,3,2,1,0,0,0,0,0,0],  // r4  coconut top
  [0,0,0,0,1,2,3,4,3,2,1,0,0,0,0,0],  // r5  coconut upper
  [0,0,0,0,1,2,4,4,4,2,1,0,0,0,0,0],  // r6  coconut highlight
  [0,0,0,0,1,2,3,3,3,2,1,0,0,0,0,0],  // r7  coconut lower
  [0,0,0,0,0,1,2,2,2,1,0,0,0,0,0,0],  // r8  coconut bottom
  [0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,0],  // r9  coconut base
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],  // r10 separator
  [0,0,0,0,0,8,0,0,0,0,0,0,0,0,0,0],  // r11 > top-left
  [0,0,0,0,0,0,8,0,0,0,0,0,0,0,0,0],  // r12 > upper-mid
  [0,0,0,0,0,0,0,8,0,0,0,0,0,0,0,0],  // r13 > tip  ← cursor starts here
  [0,0,0,0,0,0,8,9,9,9,9,0,0,0,0,0],  // r14 > lower-mid + cursor top
  [0,0,0,0,0,8,0,9,9,9,9,0,0,0,0,0],  // r15 > bottom-left + cursor bottom
];

// ─── Build raw RGBA rows ────────────────────────────────────────────────────
const rows = [];
for (let gy = 0; gy < LOGICAL; gy++) {
  for (let sy = 0; sy < SCALE; sy++) {
    const row = Buffer.alloc(W * 4);
    for (let gx = 0; gx < LOGICAL; gx++) {
      const [r, g, b, a] = C[G[gy][gx]];
      for (let sx = 0; sx < SCALE; sx++) {
        const off = (gx * SCALE + sx) * 4;
        row[off]     = r;
        row[off + 1] = g;
        row[off + 2] = b;
        row[off + 3] = a;
      }
    }
    rows.push(row);
  }
}

// ─── PNG filter bytes (type 0 = None, one byte per scanline) ───────────────
const scanlines = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  scanlines[y * (W * 4 + 1)] = 0; // filter type None
  rows[y].copy(scanlines, y * (W * 4 + 1) + 1);
}

// ─── Compress (PNG IDAT = RFC 1950 zlib, which deflateSync produces) ────────
const compressed = deflateSync(scanlines, { level: 9 });

// ─── PNG chunk helpers ──────────────────────────────────────────────────────
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

// Standard reflected CRC-32 (IEEE 802.3)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([t, data]);
  return Buffer.concat([u32(data.length), payload, u32(crc32(payload))]);
}

// ─── Assemble PNG ───────────────────────────────────────────────────────────
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); // width
ihdr.writeUInt32BE(H, 4); // height
ihdr[8]  = 8; // bit depth
ihdr[9]  = 6; // color type RGBA
ihdr[10] = 0; // compression method
ihdr[11] = 0; // filter method
ihdr[12] = 0; // interlace method

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
  chunk('IHDR', ihdr),
  chunk('IDAT', compressed),
  chunk('IEND', Buffer.alloc(0)),
]);

// ─── Write output ───────────────────────────────────────────────────────────
const outPath = join(__dirname, '..', 'media', 'icon.png');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, png);

console.log(`icon.png  ${W}x${H}px  ${png.length} bytes`);
console.log(`           ${outPath}`);
