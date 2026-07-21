const SQUARE_EDGES = ["N", "E", "S", "W"];
const SQUARE_WANG = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const HEX_EDGES = ["NW", "NE", "E", "SE", "SW", "W"];

export const TILE_PRESETS = Object.freeze({
  "random-variants": preset("random-variants", "Random variants", "any", "random", ["random"]),
  "square-edge-16": preset("square-edge-16", "Square edge 16", "square", "edge", masks("edge", 4)),
  "square-corner-16": preset("square-corner-16", "Square corner 16", "square", "corner", masks("corner", 4)),
  "square-blob-47": preset("square-blob-47", "Square blob 47", "square", "blob", blob47()),
  "square-dual-grid-4": preset("square-dual-grid-4", "Square dual-grid sectors", "square", "dual-grid", ["sector:NW", "sector:NE", "sector:SE", "sector:SW"]),
  "hex-edge-64": preset("hex-edge-64", "Hex edge 64", "hex", "edge", masks("edge", 6)),
  "hex-sector-6": preset("hex-sector-6", "Hex sectors", "hex", "sectors", HEX_EDGES.map((direction) => `sector:${direction}`))
});

export function resolveTileSetBinding(visuals, map) {
  const bindings = visuals?.bindings?.tileSets ?? {};
  return bindings.maps?.[map.id] ?? bindings.grids?.[map.grid?.kind ?? "hex"];
}

export function resolveAutotile({ map, visuals, coord, terrain, seed = 0 }) {
  const tileSetId = resolveTileSetBinding(visuals, map);
  const tileSet = tileSetId ? visuals?.tileSets?.[tileSetId] : undefined;
  if (!tileSet) return { tileSetId: null, terrain, signature: "fallback", variants: [], missing: true };
  if (tileSet.topology !== "any" && tileSet.topology !== (map.grid?.kind ?? "hex")) {
    return { tileSetId, terrain, signature: "topology-mismatch", variants: [], missing: true };
  }
  const material = tileSet.materials?.[terrain];
  if (!material) return { tileSetId, terrain, signature: "material-missing", variants: [], missing: true };
  const signature = tileSignature({ map, coord, terrain, tileSet, material });
  if (tileSet.ruleKind === "dual-grid" || tileSet.ruleKind === "sectors") {
    const sectors = resolveSectorParts({ map, coord, terrain, tileSet, material, tileSetId, seed });
    return { tileSetId, terrain, signature, variants: [], sectors, missing: sectors.some((sector) => sector.missing) };
  }
  const choices = material.signatures?.[signature] ?? material.signatures?.["*"] ?? [];
  const variants = Array.isArray(choices) ? choices : [choices];
  const selected = chooseWeightedVariant(variants, `${map.id}|${coord.q},${coord.r}|${tileSetId}|${terrain}|${signature}|${seed}`);
  return { tileSetId, terrain, signature, variants, selected, missing: !selected };
}

export function tileSignature({ map, coord, terrain, tileSet, material }) {
  if (tileSet.ruleKind === "random") return "random";
  if (tileSet.ruleKind === "dual-grid" || tileSet.ruleKind === "sectors") {
    return sectorSignature(map, coord, terrain, material, tileSet);
  }
  const topology = map.grid?.kind ?? "hex";
  const directions = topology === "square" ? SQUARE_EDGES : HEX_EDGES;
  const connected = connectionDirections(map, coord, terrain, material, tileSet);
  if (tileSet.ruleKind === "edge") return maskSignature("edge", directions, connected);
  if (topology === "square" && tileSet.ruleKind === "corner") {
    return maskSignature("corner", ["NW", "NE", "SE", "SW"], areaConnections(map, coord, terrain, material, tileSet, true));
  }
  if (topology === "square" && (tileSet.ruleKind === "mixed" || tileSet.ruleKind === "blob")) {
    const all = new Set([...connected, ...areaConnections(map, coord, terrain, material, tileSet, true)]);
    if (tileSet.ruleKind === "blob") normalizeBlobCorners(all);
    return `wang:${SQUARE_WANG.map((direction) => all.has(direction) ? "1" : "0").join("")}`;
  }
  return maskSignature("edge", directions, connected);
}

export function inspectTileSetCoverage({ map, visuals, seed = 0 }) {
  const missing = new Map();
  const used = new Map();
  for (const tile of map.tiles ?? []) {
    const result = resolveAutotile({ map, visuals, coord: tile, terrain: tile.terrain, seed });
    const resolvedParts = result.sectors?.length ? result.sectors : [{ signature: result.signature, missing: result.missing }];
    for (const part of resolvedParts) {
      const key = `${tile.terrain}:${part.signature}`;
      const target = part.missing ? missing : used;
      const entry = target.get(key) ?? { terrain: tile.terrain, signature: part.signature, count: 0, coords: [] };
      entry.count += 1;
      if (entry.coords.length < 8) entry.coords.push({ q: tile.q, r: tile.r });
      target.set(key, entry);
    }
  }
  return {
    ok: missing.size === 0,
    tileSetId: resolveTileSetBinding(visuals, map) ?? null,
    used: [...used.values()],
    missing: [...missing.values()]
  };
}

export function chooseWeightedVariant(variants, stableKey) {
  const valid = variants.filter((variant) => variant && typeof variant.spriteId === "string" && (variant.weight ?? 1) > 0);
  if (valid.length === 0) return undefined;
  const total = valid.reduce((sum, variant) => sum + (variant.weight ?? 1), 0);
  let point = (stableHash(stableKey) / 0x100000000) * total;
  for (const variant of valid) {
    point -= variant.weight ?? 1;
    if (point < 0) return { ...variant };
  }
  return { ...valid[valid.length - 1] };
}

export function stableHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function connectionDirections(map, coord, terrain, material, tileSet) {
  if (material.connectionSource === "pathRoutes") return routeConnections(map, coord);
  return areaConnections(map, coord, terrain, material, tileSet, false);
}

function routeConnections(map, coord) {
  const directions = new Set();
  for (const route of map.pathRoutes ?? []) {
    route.pathCenterline?.forEach((point, index) => {
      if (!sameCoord(point, coord)) return;
      for (const neighbor of [route.pathCenterline[index - 1], route.pathCenterline[index + 1]]) {
        const direction = neighbor && directionBetween(map.grid, coord, neighbor);
        if (direction) directions.add(direction);
      }
    });
  }
  return directions;
}

function areaConnections(map, coord, terrain, material, tileSet, diagonals) {
  const result = new Set();
  const topology = map.grid?.kind ?? "hex";
  const directions = topology === "square"
    ? [...SQUARE_EDGES, ...(diagonals ? ["NW", "NE", "SE", "SW"] : [])]
    : HEX_EDGES;
  const ownGroup = material.connectGroup ?? terrain;
  for (const direction of directions) {
    const neighbor = neighborAt(coord, direction, map.grid);
    const tile = tileAt(map, neighbor);
    if (!tile) continue;
    const neighborMaterial = tileSet.materials?.[tile.terrain];
    const neighborGroup = neighborMaterial?.connectGroup ?? tile.connectGroup ?? tile.terrain;
    if (neighborGroup === ownGroup) result.add(direction);
  }
  return result;
}

function sectorSignature(map, coord, terrain, material, tileSet = { materials: {} }) {
  const topology = map.grid?.kind ?? "hex";
  const directions = topology === "square" ? ["NW", "NE", "SE", "SW"] : HEX_EDGES;
  const connected = areaConnections(map, coord, terrain, material, tileSet, topology === "square");
  return `sectors:${directions.map((direction) => connected.has(direction) ? "1" : "0").join("")}`;
}

function resolveSectorParts({ map, coord, terrain, tileSet, material, tileSetId, seed }) {
  const topology = map.grid?.kind ?? "hex";
  const directions = topology === "square" ? ["NW", "NE", "SE", "SW"] : HEX_EDGES;
  const connected = areaConnections(map, coord, terrain, material, tileSet, topology === "square");
  return directions.map((direction) => {
    const state = connected.has(direction) ? 1 : 0;
    const signature = `sector:${direction}:${state}`;
    const choices = material.signatures?.[signature]
      ?? material.signatures?.[`sector:${direction}`]
      ?? material.signatures?.[`sector:${state}`]
      ?? material.signatures?.["*"]
      ?? [];
    const variants = Array.isArray(choices) ? choices : [choices];
    const selected = chooseWeightedVariant(variants, `${map.id}|${coord.q},${coord.r}|${tileSetId}|${terrain}|${signature}|${seed}`);
    return { direction, connected: state === 1, signature, variants, selected, missing: !selected };
  });
}

function tileAt(map, coord) {
  if (typeof map.getTile === "function") return map.getTile(coord);
  return (map.tiles ?? []).find((tile) => sameCoord(tile, coord));
}

function directionBetween(grid, a, b) {
  const dq = b.q - a.q;
  const dr = b.r - a.r;
  if ((grid?.kind ?? "hex") === "square") {
    if (dq === 0 && dr === -1) return "N";
    if (dq === 1 && dr === 0) return "E";
    if (dq === 0 && dr === 1) return "S";
    if (dq === -1 && dr === 0) return "W";
    return undefined;
  }
  const even = a.r % 2 === 0;
  const entries = even
    ? [[-1, -1, "NW"], [0, -1, "NE"], [1, 0, "E"], [0, 1, "SE"], [-1, 1, "SW"], [-1, 0, "W"]]
    : [[0, -1, "NW"], [1, -1, "NE"], [1, 0, "E"], [1, 1, "SE"], [0, 1, "SW"], [-1, 0, "W"]];
  return entries.find(([x, y]) => x === dq && y === dr)?.[2];
}

function neighborAt(coord, direction, grid) {
  if ((grid?.kind ?? "hex") === "hex") {
    const even = coord.r % 2 === 0;
    const offsets = even
      ? { NW: [-1, -1], NE: [0, -1], E: [1, 0], SE: [0, 1], SW: [-1, 1], W: [-1, 0] }
      : { NW: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], SW: [0, 1], W: [-1, 0] };
    const [dq, dr] = offsets[direction] ?? [0, 0];
    return { q: coord.q + dq, r: coord.r + dr };
  }
  const offsets = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] };
  const [dq, dr] = offsets[direction] ?? [0, 0];
  return { q: coord.q + dq, r: coord.r + dr };
}

function maskSignature(prefix, directions, connected) {
  let mask = 0;
  directions.forEach((direction, index) => { if (connected.has(direction)) mask |= 1 << index; });
  return `${prefix}:${mask}`;
}

function masks(prefix, bits) {
  return Array.from({ length: 2 ** bits }, (_, mask) => `${prefix}:${mask}`);
}

function blob47() {
  const values = new Set();
  for (let edges = 0; edges < 16; edges += 1) {
    for (let corners = 0; corners < 16; corners += 1) {
      const directions = new Set();
      ["N", "E", "S", "W"].forEach((direction, bit) => { if (edges & 1 << bit) directions.add(direction); });
      ["NW", "NE", "SE", "SW"].forEach((direction, bit) => { if (corners & 1 << bit) directions.add(direction); });
      normalizeBlobCorners(directions);
      values.add(`wang:${SQUARE_WANG.map((direction) => directions.has(direction) ? "1" : "0").join("")}`);
    }
  }
  return [...values].sort();
}

function normalizeBlobCorners(directions) {
  if (!(directions.has("N") && directions.has("E"))) directions.delete("NE");
  if (!(directions.has("E") && directions.has("S"))) directions.delete("SE");
  if (!(directions.has("S") && directions.has("W"))) directions.delete("SW");
  if (!(directions.has("W") && directions.has("N"))) directions.delete("NW");
}

function preset(id, label, topology, ruleKind, requiredSignatures) {
  return { id, label, topology, ruleKind, requiredSignatures };
}

function sameCoord(a, b) {
  return a?.q === b?.q && a?.r === b?.r;
}
