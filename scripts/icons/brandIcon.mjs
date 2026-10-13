// Dependency-free rasterizer for the brand mark (dark rounded square + mint plus) and a minimal PNG encoder.
// Geometry matches public/favicon.svg: a 32-unit square, 8-unit corner radius, plus arms from 9 to 23
// with a 4-unit round-capped stroke.
import { deflateSync } from 'node:zlib';

const BACKGROUND = [0x0f, 0x1a, 0x15];
const MINT = [0x8c, 0xe6, 0xbd];
const UNITS = 32;
const RADIUS = 8;
const ARM_START = 9;
const ARM_END = 23;
const STROKE = 4;
const SAMPLES = 4;

const insideRoundedSquare = (x, y, rounded) => {
  if (x < 0 || y < 0 || x > UNITS || y > UNITS) return false;
  if (!rounded) return true;
  const cx = Math.min(Math.max(x, RADIUS), UNITS - RADIUS);
  const cy = Math.min(Math.max(y, RADIUS), UNITS - RADIUS);
  return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2;
};

// Distance from a point to a segment, for round-capped strokes.
const segmentDistance = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

const insidePlus = (x, y) => {
  const center = UNITS / 2;
  const half = STROKE / 2;
  return segmentDistance(x, y, ARM_START, center, ARM_END, center) <= half
    || segmentDistance(x, y, center, ARM_START, center, ARM_END) <= half;
};

/** RGBA pixels of the brand mark at `size`×`size`. `rounded: false` fills the corners (iOS rounds them itself). */
export function renderBrandIcon(size, { rounded = true } = {}) {
  const data = new Uint8Array(size * size * 4);
  const scale = UNITS / size;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let squareHits = 0;
      let plusHits = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px + (sx + 0.5) / SAMPLES) * scale;
          const y = (py + (sy + 0.5) / SAMPLES) * scale;
          if (insideRoundedSquare(x, y, rounded)) {
            squareHits += 1;
            if (insidePlus(x, y)) plusHits += 1;
          }
        }
      }
      const offset = (py * size + px) * 4;
      if (!squareHits) continue;
      const mix = plusHits / squareHits;
      for (let channel = 0; channel < 3; channel += 1) {
        data[offset + channel] = Math.round(BACKGROUND[channel] + (MINT[channel] - BACKGROUND[channel]) * mix);
      }
      data[offset + 3] = Math.round((squareHits / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return { width: size, height: size, data };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type, payload) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** 8-bit RGBA PNG (color type 6, no filtering) from renderBrandIcon output. */
export function encodePng({ width, height, data }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    rows[rowStart] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(rows, rowStart + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
