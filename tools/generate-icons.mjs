import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "icons");
fs.mkdirSync(outDir, { recursive: true });

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function canvas(width, height) {
  const data = Buffer.alloc(width * height * 4);
  function set(x, y, r, g, b, a = 255) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= width || y >= height || a <= 0) return;
    const i = (y * width + x) * 4;
    const src = a / 255;
    const dst = data[i + 3] / 255;
    const out = src + dst * (1 - src);
    if (out <= 0) return;
    data[i] = (r * src + data[i] * dst * (1 - src)) / out;
    data[i + 1] = (g * src + data[i + 1] * dst * (1 - src)) / out;
    data[i + 2] = (b * src + data[i + 2] * dst * (1 - src)) / out;
    data[i + 3] = out * 255;
  }
  function fill(r, g, b) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  function circle(cx, cy, radius, color) {
    const [r, g, b, a] = color;
    const minX = Math.max(0, Math.floor(cx - radius - 1));
    const maxX = Math.min(width - 1, Math.ceil(cx + radius + 1));
    const minY = Math.max(0, Math.floor(cy - radius - 1));
    const maxY = Math.min(height - 1, Math.ceil(cy + radius + 1));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const dist = Math.hypot(dx, dy);
        if (dist <= radius) set(x, y, r, g, b, a ?? 255);
        else if (dist < radius + 1) set(x, y, r, g, b, (a ?? 255) * (radius + 1 - dist));
      }
    }
  }
  function polygon(points, color) {
    const [r, g, b, a] = color;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    for (const [x, y] of points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    minX = Math.max(0, Math.floor(minX));
    maxX = Math.min(width - 1, Math.ceil(maxX));
    minY = Math.max(0, Math.floor(minY));
    maxY = Math.min(height - 1, Math.ceil(maxY));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (inside(x + 0.5, y + 0.5, points)) set(x, y, r, g, b, a ?? 255);
      }
    }
  }
  return { data, fill, circle, polygon };
}

function inside(x, y, points) {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.00001) + xi;
    if (intersect) hit = !hit;
  }
  return hit;
}

function drawIcon(size, { inset = 0 } = {}) {
  const art = canvas(size, size);
  art.fill(12, 13, 16);
  const cx = size / 2;
  const cy = size / 2 + size * 0.02;
  const radius = size * (0.34 - inset);
  art.circle(cx, cy + size * 0.015, radius * 1.02, [90, 28, 16, 255]);
  art.circle(cx, cy, radius, [255, 90, 54, 255]);
  const ink = [18, 14, 16, 255];
  const s = radius;
  art.circle(cx, cy - s * 0.62, s * 0.1, ink);
  art.circle(cx, cy - s * 0.18, s * 0.42, ink);
  art.polygon(
    [
      [cx - s * 0.22, cy - s * 0.28],
      [cx + s * 0.22, cy - s * 0.28],
      [cx + s * 0.5, cy + s * 0.28],
      [cx - s * 0.5, cy + s * 0.28],
    ],
    ink,
  );
  art.polygon(
    [
      [cx - s * 0.56, cy + s * 0.24],
      [cx + s * 0.56, cy + s * 0.24],
      [cx + s * 0.48, cy + s * 0.4],
      [cx - s * 0.48, cy + s * 0.4],
    ],
    ink,
  );
  art.circle(cx, cy + s * 0.16, s * 0.08, [255, 90, 54, 255]);
  art.polygon(
    [
      [cx - s * 0.34, cy + s * 0.62],
      [cx - s * 0.12, cy + s * 0.62],
      [cx - s * 0.22, cy + s * 0.92],
      [cx - s * 0.44, cy + s * 0.92],
    ],
    ink,
  );
  art.polygon(
    [
      [cx + s * 0.12, cy + s * 0.62],
      [cx + s * 0.34, cy + s * 0.62],
      [cx + s * 0.44, cy + s * 0.92],
      [cx + s * 0.22, cy + s * 0.92],
    ],
    ink,
  );
  return art.data;
}

function write(name, size, options) {
  const png = encodePng(size, size, drawIcon(size, options));
  fs.writeFileSync(path.join(outDir, name), png);
}

write("favicon-32.png", 32);
write("apple-touch-icon.png", 180);
write("icon-192.png", 192);
write("icon-512.png", 512);
write("icon-maskable-512.png", 512, { inset: 0.06 });

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0c0d10"/>
  <circle cx="32" cy="34" r="20" fill="#ff5a36"/>
  <circle cx="32" cy="20" r="2.2" fill="#120e10"/>
  <path d="M24 24h16l6 14H18z" fill="#120e10"/>
  <circle cx="32" cy="28" r="8" fill="#120e10"/>
  <rect x="20" y="36" width="24" height="4" rx="2" fill="#120e10"/>
  <circle cx="32" cy="35" r="1.8" fill="#ff5a36"/>
  <path d="M24 42h5l-2 8h-5zM35 42h5l2 8h-5z" fill="#120e10"/>
</svg>
`;
fs.writeFileSync(path.join(outDir, "favicon.svg"), svg);
console.log("icons written");
