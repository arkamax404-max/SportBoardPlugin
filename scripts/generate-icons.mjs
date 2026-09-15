// Deterministic, dependency-free raster and PNG generator for the four plugin icons.
// Geometry is rendered at 4x resolution and downsampled with integer arithmetic.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ICON_SIZE = 196;
export const ICON_PATHS = [
  "assets/plugin.png",
  "assets/action.png",
  "assets/ready.png",
  "assets/selected.png",
];

const SCALE = 4;
const SIZE = ICON_SIZE * SCALE;
const COLORS = {
  navy: [0x0b, 0x1f, 0x33, 0xff],
  white: [0xf8, 0xfa, 0xfc, 0xff],
  green: [0x22, 0xc5, 0x5e, 0xff],
  amber: [0xf5, 0xb9, 0x42, 0xff],
  cyan: [0x38, 0xbd, 0xf8, 0xff],
  transparent: [0, 0, 0, 0],
};

function canvas() {
  return new Uint8Array(SIZE * SIZE * 4);
}

function pixel(image, x, y, color) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const offset = (y * SIZE + x) * 4;
  image.set(color, offset);
}

function rect(image, x, y, width, height, color) {
  const left = Math.round(x * SCALE);
  const top = Math.round(y * SCALE);
  const right = Math.round((x + width) * SCALE);
  const bottom = Math.round((y + height) * SCALE);
  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) pixel(image, px, py, color);
  }
}

function roundedRect(image, x, y, width, height, radius, color) {
  const left = Math.round(x * SCALE);
  const top = Math.round(y * SCALE);
  const right = Math.round((x + width) * SCALE);
  const bottom = Math.round((y + height) * SCALE);
  const r = Math.round(radius * SCALE);
  const r2 = r * r;
  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      const cx = px < left + r ? left + r : px >= right - r ? right - r - 1 : px;
      const cy = py < top + r ? top + r : py >= bottom - r ? bottom - r - 1 : py;
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= r2) pixel(image, px, py, color);
    }
  }
}

function circle(image, cx, cy, radius, color) {
  const centerX = Math.round(cx * SCALE);
  const centerY = Math.round(cy * SCALE);
  const r = Math.round(radius * SCALE);
  const r2 = r * r;
  for (let y = centerY - r; y <= centerY + r; y += 1) {
    for (let x = centerX - r; x <= centerX + r; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= r2) pixel(image, x, y, color);
    }
  }
}

function line(image, x1, y1, x2, y2, width, color) {
  const ax = x1 * SCALE;
  const ay = y1 * SCALE;
  const bx = x2 * SCALE;
  const by = y2 * SCALE;
  const radius = (width * SCALE) / 2;
  const minX = Math.floor(Math.min(ax, bx) - radius);
  const maxX = Math.ceil(Math.max(ax, bx) + radius);
  const minY = Math.floor(Math.min(ay, by) - radius);
  const maxY = Math.ceil(Math.max(ay, by) + radius);
  const vx = bx - ax;
  const vy = by - ay;
  const length2 = vx * vx + vy * vy;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const projection = length2 === 0 ? 0 : ((x - ax) * vx + (y - ay) * vy) / length2;
      const t = Math.max(0, Math.min(1, projection));
      const dx = x - (ax + t * vx);
      const dy = y - (ay + t * vy);
      if (dx * dx + dy * dy <= radius * radius) pixel(image, x, y, color);
    }
  }
}

function outlineRect(image, x, y, width, height, stroke, color) {
  rect(image, x, y, width, stroke, color);
  rect(image, x, y + height - stroke, width, stroke, color);
  rect(image, x, y, stroke, height, color);
  rect(image, x + width - stroke, y, stroke, height, color);
}

const SEGMENTS = {
  0: ["a", "b", "c", "d", "e", "f"],
  1: ["b", "c"],
};

function digit(image, value, x, y, width, height, thickness, color) {
  const horizontal = width - thickness;
  const vertical = height / 2 - thickness;
  const positions = {
    a: [x + thickness / 2, y, horizontal, thickness],
    b: [x + width - thickness, y + thickness / 2, thickness, vertical],
    c: [x + width - thickness, y + height / 2, thickness, vertical],
    d: [x + thickness / 2, y + height - thickness, horizontal, thickness],
    e: [x, y + height / 2, thickness, vertical],
    f: [x, y + thickness / 2, thickness, vertical],
    g: [x + thickness / 2, y + height / 2 - thickness / 2, horizontal, thickness],
  };
  for (const segment of SEGMENTS[value]) rect(image, ...positions[segment], color);
}

function base(image) {
  roundedRect(image, 24, 24, 148, 148, 24, COLORS.navy);
}

function scoreboard(image, left, top, width, height, accent) {
  roundedRect(image, left, top, width, height, 10, COLORS.white);
  roundedRect(image, left + 5, top + 5, width - 10, height - 10, 7, COLORS.navy);
  rect(image, left + 10, top + 10, width - 20, 4, accent);
}

function pluginIcon() {
  const image = canvas();
  base(image);
  scoreboard(image, 46, 39, 104, 54, COLORS.amber);
  digit(image, 0, 61, 53, 25, 27, 5, COLORS.white);
  digit(image, 0, 110, 53, 25, 27, 5, COLORS.white);
  circle(image, 98, 67, 3, COLORS.amber);
  outlineRect(image, 45, 105, 106, 48, 4, COLORS.green);
  line(image, 98, 105, 98, 153, 4, COLORS.green);
  circle(image, 98, 129, 12, COLORS.green);
  circle(image, 98, 129, 7, COLORS.navy);
  circle(image, 98, 129, 3, COLORS.white);
  return image;
}

function actionIcon() {
  const image = canvas();
  base(image);
  scoreboard(image, 38, 45, 120, 100, COLORS.cyan);
  digit(image, 1, 57, 69, 27, 51, 8, COLORS.white);
  digit(image, 0, 109, 69, 32, 51, 8, COLORS.white);
  circle(image, 98, 94, 4, COLORS.cyan);
  line(image, 72, 155, 98, 164, 7, COLORS.cyan);
  line(image, 98, 164, 124, 155, 7, COLORS.cyan);
  return image;
}

function readyIcon() {
  const image = canvas();
  base(image);
  roundedRect(image, 34, 40, 128, 112, 16, COLORS.green);
  roundedRect(image, 41, 47, 114, 98, 11, COLORS.navy);
  rect(image, 51, 54, 94, 6, COLORS.green);
  digit(image, 0, 54, 72, 34, 49, 7, COLORS.white);
  digit(image, 0, 108, 72, 34, 49, 7, COLORS.white);
  circle(image, 98, 96, 4, COLORS.green);
  roundedRect(image, 72, 132, 52, 25, 12, COLORS.navy);
  circle(image, 98, 144, 10, COLORS.green);
  circle(image, 98, 144, 4, COLORS.white);
  return image;
}

function selectedIcon() {
  const image = canvas();
  base(image);
  scoreboard(image, 38, 45, 120, 88, COLORS.cyan);
  digit(image, 0, 53, 66, 31, 43, 7, COLORS.white);
  digit(image, 0, 112, 66, 31, 43, 7, COLORS.white);
  circle(image, 98, 87, 4, COLORS.cyan);
  circle(image, 101, 116, 45, COLORS.navy);
  line(image, 62, 116, 88, 140, 13, COLORS.amber);
  line(image, 88, 140, 145, 77, 13, COLORS.amber);
  return image;
}

function downsample(image) {
  const result = Buffer.alloc(ICON_SIZE * ICON_SIZE * 4);
  const samples = SCALE * SCALE;
  for (let y = 0; y < ICON_SIZE; y += 1) {
    for (let x = 0; x < ICON_SIZE; x += 1) {
      const sums = [0, 0, 0, 0];
      for (let sy = 0; sy < SCALE; sy += 1) {
        for (let sx = 0; sx < SCALE; sx += 1) {
          const source = (((y * SCALE + sy) * SIZE) + x * SCALE + sx) * 4;
          for (let channel = 0; channel < 4; channel += 1) sums[channel] += image[source + channel];
        }
      }
      const target = (y * ICON_SIZE + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) result[target + channel] = Math.round(sums[channel] / samples);
    }
  }
  return result;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function encodePng(rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(ICON_SIZE, 0);
  header.writeUInt32BE(ICON_SIZE, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(ICON_SIZE * (1 + ICON_SIZE * 4));
  for (let y = 0; y < ICON_SIZE; y += 1) {
    const row = y * (1 + ICON_SIZE * 4);
    scanlines[row] = 0;
    rgba.copy(scanlines, row + 1, y * ICON_SIZE * 4, (y + 1) * ICON_SIZE * 4);
  }
  // A zlib stream made from uncompressed DEFLATE blocks avoids platform or
  // zlib-version differences while remaining valid on every PNG decoder.
  const blocks = [];
  for (let offset = 0; offset < scanlines.length; offset += 0xffff) {
    const length = Math.min(0xffff, scanlines.length - offset);
    const header = Buffer.alloc(5);
    header[0] = offset + length === scanlines.length ? 1 : 0;
    header.writeUInt16LE(length, 1);
    header.writeUInt16LE((~length) & 0xffff, 3);
    blocks.push(header, scanlines.subarray(offset, offset + length));
  }
  const zlibHeader = Buffer.from([0x78, 0x01]);
  const adler = Buffer.alloc(4);
  let a = 1;
  let b = 0;
  for (const byte of scanlines) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  adler.writeUInt32BE(((b << 16) | a) >>> 0);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", Buffer.concat([zlibHeader, ...blocks, adler])),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function generateIcons() {
  const rasters = [pluginIcon(), actionIcon(), readyIcon(), selectedIcon()];
  return new Map(ICON_PATHS.map((path, index) => [path, encodePng(downsample(rasters[index]))]));
}

export function main() {
  const pluginRoot = fileURLToPath(new URL("../com.ulanzi.sportboard.ulanziPlugin/", import.meta.url));
  for (const [relative, bytes] of generateIcons()) {
    const target = join(pluginRoot, ...relative.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  console.log(`generate:icons: wrote ${ICON_PATHS.length} deterministic ${ICON_SIZE}x${ICON_SIZE} RGBA PNG files.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
