#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../src/icons');
const SIZES = [16, 32, 48, 128];

// CRC32 table for PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

// Signed distance to rounded box centered at (0,0) with half-extents (bx, by) and radius r
function sdRoundBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

// Distance to line segment AB
function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function sampleIcon(u, v) {
  // Normalized coordinates [-1, 1]
  const x = u * 2 - 1;
  const y = v * 2 - 1;

  // Rounded squircle container
  const bgDist = sdRoundBox(x, y, 0.92, 0.92, 0.42);
  if (bgDist > 0) {
    return [0, 0, 0, 0];
  }

  // Rich diagonal gradient background: deep indigo -> electric violet -> cyan highlight
  const g = clamp((u * 0.65 + v * 0.55), 0, 1);
  let r = mix(15, 76, g);
  let gr = mix(23, 29, g);
  let b = mix(54, 149, g);

  // Subtle top-left cyan radial glow
  const glow = Math.exp(-((x + 0.35) ** 2 + (y + 0.35) ** 2) * 2.2);
  r = mix(r, 14, glow * 0.45);
  gr = mix(gr, 165, glow * 0.45);
  b = mix(b, 233, glow * 0.45);

  // Inner subtle border sheen
  if (bgDist > -0.055) {
    const borderT = clamp((bgDist + 0.055) / 0.055, 0, 1);
    r = mix(r, 148, borderT * 0.28);
    gr = mix(gr, 163, borderT * 0.28);
    b = mix(b, 224, borderT * 0.35);
  }

  // Magnifying glass lens centered slightly top-left
  const cx = -0.1;
  const cy = -0.1;
  const lensR = 0.46;
  const ringHalfW = 0.085;
  const dCenter = Math.hypot(x - cx, y - cy);

  // Translucent dark-cyan glass fill inside lens
  if (dCenter < lensR - ringHalfW * 0.5) {
    r = mix(r, 12, 0.42);
    gr = mix(gr, 24, 0.42);
    b = mix(b, 48, 0.42);
  }

  // Handle going bottom-right
  const handleDist = sdSegment(x, y, cx + 0.34, cy + 0.34, 0.66, 0.66) - 0.1;
  if (handleDist < 0) {
    r = 224;
    gr = 231;
    b = 255;
  }

  // Bright lens rim
  const ringDist = Math.abs(dCenter - lensR) - ringHalfW;
  if (ringDist < 0) {
    const rimT = clamp((x - y + 1) * 0.5, 0, 1);
    r = mix(125, 248, rimT);
    gr = mix(211, 250, rimT);
    b = mix(252, 255, rimT);
  }

  // Crisp infinity symbol (two joined rings) inside the magnifying glass lens
  const infY = cy;
  const infOff = 0.145;
  const infR = 0.13;
  const infStroke = 0.048;
  const dLeft = Math.abs(Math.hypot(x - (cx - infOff), y - infY) - infR) - infStroke;
  const dRight = Math.abs(Math.hypot(x - (cx + infOff), y - infY) - infR) - infStroke;
  if (Math.min(dLeft, dRight) < 0) {
    r = 56;
    gr = 219;
    b = 255;
  }

  return [r, gr, b, 255];
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const ss = 4; // 4x4 supersampling for clean antialiasing
  const invTotal = 1 / (ss * ss);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;

      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (px + (sx + 0.5) / ss) / size;
          const v = (py + (sy + 0.5) / ss) / size;
          const [r, g, b, a] = sampleIcon(u, v);
          const alpha = a / 255;
          accR += r * alpha;
          accG += g * alpha;
          accB += b * alpha;
          accA += alpha;
        }
      }

      const avgA = accA * invTotal;
      const idx = (py * size + px) * 4;
      if (avgA > 0.001) {
        rgba[idx] = Math.round(clamp(accR / accA, 0, 255));
        rgba[idx + 1] = Math.round(clamp(accG / accA, 0, 255));
        rgba[idx + 2] = Math.round(clamp(accB / accA, 0, 255));
        rgba[idx + 3] = Math.round(clamp(avgA * 255, 0, 255));
      }
    }
  }

  return encodePng(size, size, rgba);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = renderIcon(size);
  const outPath = path.join(OUT_DIR, `icon-${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`Generated ${path.relative(process.cwd(), outPath)} (${png.length} bytes)`);
}
