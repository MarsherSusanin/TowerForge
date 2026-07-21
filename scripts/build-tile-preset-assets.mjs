import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";

const ROOT = path.resolve(import.meta.dirname, "..");
const CELL = 64;
const COLUMNS = 16;
const TERRAINS = ["buildable", "path", "blocked", "water", "spawn", "core"];
const THEMES = {
  "verdant-frontier": {
    buildable: [42, 85, 49], path: [125, 91, 61], blocked: [58, 69, 55],
    water: [52, 118, 139], spawn: [157, 121, 48], core: [68, 139, 76]
  },
  "frostbound-citadel": {
    buildable: [57, 83, 92], path: [88, 105, 116], blocked: [52, 61, 70],
    water: [62, 143, 171], spawn: [157, 121, 52], core: [53, 138, 151]
  }
};

for (const [themeId, palette] of Object.entries(THEMES)) {
  writeAtlas(themeId, "square", 16, palette);
  writeAtlas(themeId, "hex", 64, palette);
}

function writeAtlas(themeId, topology, masks, palette) {
  const rows = Math.ceil(TERRAINS.length * masks / COLUMNS);
  const width = COLUMNS * CELL;
  const height = rows * CELL;
  const rgba = Buffer.alloc(width * height * 4);
  for (let terrainIndex = 0; terrainIndex < TERRAINS.length; terrainIndex += 1) {
    for (let mask = 0; mask < masks; mask += 1) {
      const tileIndex = terrainIndex * masks + mask;
      paintTile(rgba, width, (tileIndex % COLUMNS) * CELL, Math.floor(tileIndex / COLUMNS) * CELL, topology, mask, palette[TERRAINS[terrainIndex]], themeId, terrainIndex);
    }
  }
  const destination = path.join(ROOT, "packages", "cli", "theme-packs", themeId, "assets", `tiles-${topology}.png`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, encodePng(width, height, rgba));
  process.stdout.write(`${path.relative(ROOT, destination)} ${width}x${height}\n`);
}

function paintTile(buffer, atlasWidth, ox, oy, topology, mask, base, themeId, terrainIndex) {
  const edgeCount = topology === "square" ? 4 : 6;
  const center = (CELL - 1) / 2;
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      if (topology === "hex" && !insideHex(x, y, center, CELL * 0.47)) continue;
      const noise = textureNoise(x, y, mask, terrainIndex, themeId);
      const vignette = Math.round(Math.hypot(x - center, y - center) / CELL * 7);
      const color = base.map((channel) => clamp(channel + noise - vignette));
      setPixel(buffer, atlasWidth, ox + x, oy + y, color[0], color[1], color[2], 255);
    }
  }

  // Non-connected sides receive a dark natural seam; connected sides stay visually continuous.
  for (let direction = 0; direction < edgeCount; direction += 1) {
    if ((mask & (1 << direction)) !== 0) continue;
    drawEdge(buffer, atlasWidth, ox, oy, topology, direction, base);
  }
  drawSpeckles(buffer, atlasWidth, ox, oy, topology, base, mask, terrainIndex, themeId);
}

function drawEdge(buffer, atlasWidth, ox, oy, topology, direction, base) {
  const dark = base.map((channel) => clamp(channel - 25));
  if (topology === "square") {
    for (let step = 0; step < CELL; step += 1) for (let width = 0; width < 3; width += 1) {
      const coords = [
        [step, width], [CELL - 1 - width, step], [step, CELL - 1 - width], [width, step]
      ][direction];
      setPixel(buffer, atlasWidth, ox + coords[0], oy + coords[1], dark[0], dark[1], dark[2], 220);
    }
    return;
  }
  const points = hexPoints();
  const a = points[direction];
  const b = points[(direction + 1) % points.length];
  drawLine(buffer, atlasWidth, ox, oy, a, b, dark);
  drawLine(buffer, atlasWidth, ox, oy, inward(a), inward(b), dark.map((channel) => clamp(channel + 8)));
}

function drawSpeckles(buffer, atlasWidth, ox, oy, topology, base, mask, terrainIndex, themeId) {
  let seed = hash(`${themeId}:${topology}:${terrainIndex}:${mask}`);
  for (let index = 0; index < 18; index += 1) {
    seed = Math.imul(seed ^ seed >>> 15, 2246822519) >>> 0;
    const x = 5 + seed % (CELL - 10);
    seed = Math.imul(seed ^ seed >>> 13, 3266489917) >>> 0;
    const y = 5 + seed % (CELL - 10);
    if (topology === "hex" && !insideHex(x, y, (CELL - 1) / 2, CELL * 0.43)) continue;
    const light = index % 3 === 0 ? 18 : -12;
    const color = base.map((channel) => clamp(channel + light));
    setPixel(buffer, atlasWidth, ox + x, oy + y, color[0], color[1], color[2], 170);
    if (index % 2 === 0) setPixel(buffer, atlasWidth, ox + x + 1, oy + y, color[0], color[1], color[2], 130);
  }
}

function hexPoints() {
  const center = (CELL - 1) / 2;
  return Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 6 + index * Math.PI / 3;
    return [Math.round(center + Math.cos(angle) * CELL * 0.47), Math.round(center + Math.sin(angle) * CELL * 0.47)];
  });
}

function inward(point) {
  const center = (CELL - 1) / 2;
  return [Math.round(point[0] + (center - point[0]) * 0.05), Math.round(point[1] + (center - point[1]) * 0.05)];
}

function drawLine(buffer, atlasWidth, ox, oy, a, b, color) {
  const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  for (let index = 0; index <= steps; index += 1) {
    const x = Math.round(a[0] + (b[0] - a[0]) * index / steps);
    const y = Math.round(a[1] + (b[1] - a[1]) * index / steps);
    setPixel(buffer, atlasWidth, ox + x, oy + y, color[0], color[1], color[2], 230);
  }
}

function insideHex(x, y, center, radius) {
  const dx = Math.abs(x - center) / radius;
  const dy = Math.abs(y - center) / radius;
  return dx <= Math.sqrt(3) / 2 && dy <= 1 && Math.sqrt(3) * dx + dy <= 1.5;
}

function textureNoise(x, y, mask, terrainIndex, themeId) {
  const value = hash(`${themeId}:${x >> 1}:${y >> 1}:${mask}:${terrainIndex}`);
  return value % 13 - 6;
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

function setPixel(buffer, width, x, y, red, green, blue, alpha) {
  const offset = (y * width + x) * 4;
  buffer[offset] = red;
  buffer[offset + 1] = green;
  buffer[offset + 2] = blue;
  buffer[offset + 3] = alpha;
}

function clamp(value) { return Math.max(0, Math.min(255, Math.round(value))); }

function encodePng(width, height, rgba) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const target = y * (width * 4 + 1);
    scanlines[target] = 0;
    rgba.copy(scanlines, target + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", Buffer.concat([uint32(width), uint32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", zlib.deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuffer, data]);
  return Buffer.concat([uint32(data.length), body, uint32(crc32(body))]);
}

function uint32(value) { const buffer = Buffer.alloc(4); buffer.writeUInt32BE(value >>> 0); return buffer; }
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
