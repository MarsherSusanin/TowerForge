import path from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { validateSafeAssetPath } from "./project-schema.mjs";

export const TILESET_IMPORT_LIMITS = Object.freeze({ descriptorBytes: 2_000_000, tiles: 4096, wangSets: 64 });
export const ALLOWED_TILED_PROPERTIES = new Set([
  "towerforge.terrainId", "buildable", "walkable", "groundSpeedMultiplier", "tags", "connectGroup", "connectionSource"
]);

export function previewTiledTilesetImport({ descriptor, sourceName = "tileset.tsj", tileSetId, atlasId, topology, slicing, transformations, materialOverrides, terrainTypeOverrides }) {
  if (typeof descriptor !== "string") throw new Error("Tileset descriptor must be UTF-8 text.");
  if (Buffer.byteLength(descriptor, "utf8") > TILESET_IMPORT_LIMITS.descriptorBytes) throw new Error("Tileset descriptor exceeds the 2 MB limit.");
  const extension = path.extname(sourceName).toLowerCase();
  const tiled = extension === ".tsx" ? parseTsx(descriptor) : parseTsj(descriptor);
  const id = safeId(tileSetId ?? tiled.name ?? path.basename(sourceName, extension));
  const resolvedAtlasId = safeId(atlasId ?? `${id}_atlas`);
  validateTiledTileset(tiled, sourceName);

  const image = String(tiled.image ?? "");
  const imageIssue = validateSafeAssetPath(image, "image");
  if (imageIssue || !/\.png$/i.test(image)) throw new Error(imageIssue ?? "Tileset image must be a PNG file.");
  const tileWidth = positiveInteger(slicing?.tileWidth ?? tiled.tilewidth, "tilewidth");
  const tileHeight = positiveInteger(slicing?.tileHeight ?? tiled.tileheight, "tileheight");
  const margin = nonNegativeInteger(slicing?.margin ?? tiled.margin ?? 0, "margin");
  const spacing = nonNegativeInteger(slicing?.spacing ?? tiled.spacing ?? 0, "spacing");
  const columns = positiveInteger(slicing?.columns ?? tiled.columns, "columns");
  const tileCount = positiveInteger(tiled.tilecount, "tilecount");
  if (tileCount > TILESET_IMPORT_LIMITS.tiles) throw new Error(`Tileset exceeds the ${TILESET_IMPORT_LIMITS.tiles}-tile limit.`);

  const sprites = {};
  for (let tileId = 0; tileId < tileCount; tileId += 1) {
    const x = margin + (tileId % columns) * (tileWidth + spacing);
    const y = margin + Math.floor(tileId / columns) * (tileHeight + spacing);
    sprites[`${id}_tile_${tileId}`] = { atlas: resolvedAtlasId, frame: { x, y, w: tileWidth, h: tileHeight } };
  }

  const resolvedTopology = topology === "hex" || topology === "square"
    ? topology
    : tiled.tileheight !== tiled.tilewidth ? "hex" : "square";
  const wangSets = tiled.wangsets ?? [];
  const wangRuleKinds = [...new Set(wangSets.map((set) => normalizeWangType(set.type, resolvedTopology)))];
  if (wangRuleKinds.length > 1) {
    throw new Error(`All Wang sets in one TowerForge tileset must use the same type; found ${wangRuleKinds.join(", ")}.`);
  }
  const ruleKind = wangRuleKinds[0] ?? "random";
  const generatedMaterials = buildMaterials(tiled, wangSets, id, ruleKind);
  const materials = materialOverrides === undefined ? generatedMaterials : normalizeMaterialOverrides(materialOverrides, sprites);
  const warnings = [];
  if (wangSets.length === 0) warnings.push("No Wang set found; imported as deterministic random variants.");
  if (Object.keys(materials).length === 0) warnings.push("No towerforge.terrainId mapping found; bind terrain materials in the Tileset Workbench.");

  return {
    source: {
      sourceName,
      image,
      columns,
      tileCount,
      rows: Math.ceil(tileCount / columns),
      expectedWidth: margin * 2 + columns * tileWidth + Math.max(0, columns - 1) * spacing,
      expectedHeight: margin * 2 + Math.ceil(tileCount / columns) * tileHeight + Math.max(0, Math.ceil(tileCount / columns) - 1) * spacing,
      declaredImageWidth: numberOrUndefined(tiled.imagewidth),
      declaredImageHeight: numberOrUndefined(tiled.imageheight)
    },
    atlas: { id: resolvedAtlasId, src: image },
    sprites,
    tileSet: {
      id,
      atlas: resolvedAtlasId,
      tileWidth,
      tileHeight,
      margin,
      spacing,
      topology: resolvedTopology,
      ruleKind,
      transformations: normalizeTransformations(mergeTransformations(tiled.transformations, transformations)),
      materials
    },
    terrainTypes: terrainTypeOverrides === undefined ? collectTerrainTypes(tiled) : normalizeTerrainTypeOverrides(terrainTypeOverrides),
    warnings
  };
}

function parseTsj(text) {
  let value;
  try { value = JSON.parse(text); } catch (error) { throw new Error(`Invalid TSJ JSON: ${error.message}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("TSJ root must be an object.");
  return value;
}

function parseTsx(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("TSX DTD and entity declarations are not allowed.");
  if (/\0/.test(text)) throw new Error("TSX contains a NUL byte.");
  const validation = XMLValidator.validate(text, { allowBooleanAttributes: false });
  if (validation !== true) throw new Error(`Invalid TSX XML: ${validation.err.msg} at line ${validation.err.line}.`);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
    processEntities: false,
    allowBooleanAttributes: false,
    isArray: (_name, jPath) => [
      "tileset.tile",
      "tileset.properties.property",
      "tileset.tile.properties.property",
      "tileset.wangsets.wangset",
      "tileset.wangsets.wangset.properties.property",
      "tileset.wangsets.wangset.wangcolor",
      "tileset.wangsets.wangset.wangcolor.properties.property",
      "tileset.wangsets.wangset.wangtile"
    ].includes(jPath)
  });
  const root = parser.parse(text)?.tileset;
  if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error("TSX must contain one tileset root element.");
  const properties = normalizeXmlProperties(root.properties?.property);
  const tiles = asArray(root.tile).map((tile) => ({
    id: Number(tile.id),
    probability: numberOrUndefined(tile.probability),
    properties: normalizeXmlProperties(tile.properties?.property)
  }));
  const wangsets = asArray(root.wangsets?.wangset).map((set) => ({
    name: set.name,
    type: set.type,
    properties: normalizeXmlProperties(set.properties?.property),
    wangcolors: asArray(set.wangcolor).map((color) => ({
      name: color.name,
      tile: Number(color.tile),
      probability: numberOrUndefined(color.probability),
      properties: normalizeXmlProperties(color.properties?.property)
    })),
    wangtiles: asArray(set.wangtile).map((tile) => ({
      tileid: Number(tile.tileid),
      wangid: String(tile.wangid ?? "").split(",").map(Number)
    }))
  }));
  return {
    ...root,
    tilewidth: Number(root.tilewidth),
    tileheight: Number(root.tileheight),
    tilecount: Number(root.tilecount),
    columns: Number(root.columns),
    margin: Number(root.margin ?? 0),
    spacing: Number(root.spacing ?? 0),
    image: root.image?.source,
    imagewidth: numberOrUndefined(root.image?.width),
    imageheight: numberOrUndefined(root.image?.height),
    properties,
    tiles,
    wangsets,
    transformations: root.transformations
  };
}

function validateTiledTileset(tiled, sourceName) {
  if (!tiled.name || typeof tiled.name !== "string") throw new Error(`${sourceName} needs a tileset name.`);
  if (Array.isArray(tiled.wangsets) && tiled.wangsets.length > TILESET_IMPORT_LIMITS.wangSets) throw new Error("Too many Wang sets.");
  scanProperties(tiled.properties, "properties");
  for (const [index, tile] of (tiled.tiles ?? []).entries()) scanProperties(tile.properties, `tiles[${index}].properties`);
  for (const [index, set] of (tiled.wangsets ?? []).entries()) {
    scanProperties(set.properties, `wangsets[${index}].properties`);
    for (const [colorIndex, color] of (set.colors ?? set.wangcolors ?? []).entries()) scanProperties(color.properties, `wangsets[${index}].colors[${colorIndex}].properties`);
  }
}

function scanProperties(properties, fieldPath) {
  for (const property of properties ?? []) {
    if (!property || typeof property.name !== "string") throw new Error(`${fieldPath} contains a malformed property.`);
    if (!ALLOWED_TILED_PROPERTIES.has(property.name)) {
      throw new Error(`${fieldPath} contains unsupported property "${property.name}".`);
    }
  }
}

function buildMaterials(tiled, wangSets, tileSetId, ruleKind) {
  const materials = {};
  const probability = new Map((tiled.tiles ?? []).map((tile) => [Number(tile.id), Number(tile.probability ?? 1)]));
  for (const wangSet of wangSets) {
    const colors = wangSet?.colors ?? wangSet?.wangcolors ?? [];
    const materialIds = colors.map((color, index) => {
      const props = propertiesToObject(color.properties);
      const terrainId = String(props["towerforge.terrainId"] ?? safeId(color.name ?? `terrain_${index + 1}`));
      materials[terrainId] ??= {
        connectGroup: String(props.connectGroup ?? terrainId),
        connectionSource: props.connectionSource === "pathRoutes" ? "pathRoutes" : "neighbors",
        signatures: {}
      };
      return terrainId;
    });
    for (const wangTile of wangSet?.wangtiles ?? []) {
      const ids = normalizeWangId(wangTile.wangid);
      const colorIndex = ids.find((value) => value > 0) - 1;
      const material = materials[materialIds[colorIndex]];
      if (!material) continue;
      const signature = wangSignature(ids, ruleKind);
      material.signatures[signature] ??= [];
      material.signatures[signature].push({ spriteId: `${tileSetId}_tile_${wangTile.tileid}`, weight: probability.get(Number(wangTile.tileid)) ?? 1 });
    }
  }
  if (wangSets.length === 0) {
    const terrainId = String(propertiesToObject(tiled.properties)["towerforge.terrainId"] ?? "buildable");
    materials[terrainId] = {
      connectGroup: terrainId,
      connectionSource: "neighbors",
      signatures: {
        random: Array.from({ length: Number(tiled.tilecount) }, (_, tileId) => ({ spriteId: `${tileSetId}_tile_${tileId}`, weight: probability.get(tileId) ?? 1 }))
      }
    };
  }
  return materials;
}

function collectTerrainTypes(tiled) {
  const result = {};
  const candidates = [tiled, ...(tiled.wangsets ?? []).flatMap((set) => set.colors ?? set.wangcolors ?? []), ...(tiled.tiles ?? [])];
  for (const candidate of candidates) {
    const props = propertiesToObject(candidate.properties);
    const id = props["towerforge.terrainId"];
    if (typeof id !== "string" || !id) continue;
    if (!["buildable", "walkable", "groundSpeedMultiplier", "tags"].some((field) => Object.hasOwn(props, field))) continue;
    result[id] = {
      id,
      label: candidate.name || id,
      buildable: booleanValue(props.buildable, false),
      walkable: booleanValue(props.walkable, true),
      groundSpeedMultiplier: finiteNumber(props.groundSpeedMultiplier, 1),
      tags: Array.isArray(props.tags) ? props.tags.map(String) : String(props.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean)
    };
  }
  return result;
}

function normalizeMaterialOverrides(value, sprites) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("materialOverrides must be an object keyed by terrain id.");
  if (Object.keys(value).length > 256) throw new Error("materialOverrides exceeds the 256-material limit.");
  const result = {};
  for (const [rawTerrainId, material] of Object.entries(value)) {
    const terrainId = safeId(rawTerrainId);
    if (!material || typeof material !== "object" || Array.isArray(material)) throw new Error(`Material ${terrainId} must be an object.`);
    rejectUnknownKeys(material, ["connectGroup", "connectionSource", "signatures"], `materialOverrides.${terrainId}`);
    if (!material.signatures || typeof material.signatures !== "object" || Array.isArray(material.signatures)) throw new Error(`Material ${terrainId} needs signatures.`);
    if (Object.keys(material.signatures).length > 512) throw new Error(`Material ${terrainId} exceeds the 512-signature limit.`);
    const signatures = {};
    for (const [signature, rawVariants] of Object.entries(material.signatures)) {
      if (!signature || signature.length > 128) throw new Error(`Material ${terrainId} has an invalid signature.`);
      const variants = Array.isArray(rawVariants) ? rawVariants : [rawVariants];
      if (variants.length < 1 || variants.length > 64) throw new Error(`Signature ${signature} must have 1 to 64 variants.`);
      signatures[signature] = variants.map((variant, index) => normalizeVariant(variant, sprites, `${terrainId}.${signature}[${index}]`));
    }
    result[terrainId] = {
      connectGroup: safeId(material.connectGroup ?? terrainId),
      connectionSource: material.connectionSource === "pathRoutes" ? "pathRoutes" : material.connectionSource === undefined || material.connectionSource === "neighbors" ? "neighbors" : invalid("connectionSource must be neighbors or pathRoutes."),
      signatures
    };
  }
  return result;
}

function normalizeVariant(variant, sprites, field) {
  if (!variant || typeof variant !== "object" || Array.isArray(variant)) throw new Error(`${field} must be an object.`);
  rejectUnknownKeys(variant, ["spriteId", "weight", "transform"], field);
  const spriteId = safeId(variant.spriteId);
  if (!sprites[spriteId]) throw new Error(`${field} references unknown imported sprite ${spriteId}.`);
  const result = { spriteId, weight: finitePositiveNumber(variant.weight ?? 1, `${field}.weight`) };
  if (variant.transform !== undefined) {
    if (!variant.transform || typeof variant.transform !== "object" || Array.isArray(variant.transform)) throw new Error(`${field}.transform must be an object.`);
    rejectUnknownKeys(variant.transform, ["flipX", "flipY", "rotate"], `${field}.transform`);
    result.transform = {
      flipX: booleanValue(variant.transform.flipX, false),
      flipY: booleanValue(variant.transform.flipY, false),
      rotate: [0, 90, 180, 270].includes(Number(variant.transform.rotate ?? 0)) ? Number(variant.transform.rotate ?? 0) : invalid(`${field}.transform.rotate must be 0, 90, 180, or 270.`)
    };
  }
  return result;
}

function normalizeTerrainTypeOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("terrainTypeOverrides must be an object keyed by terrain id.");
  const result = {};
  for (const [rawId, terrain] of Object.entries(value)) {
    const id = safeId(rawId);
    if (!terrain || typeof terrain !== "object" || Array.isArray(terrain)) throw new Error(`Terrain ${id} must be an object.`);
    rejectUnknownKeys(terrain, ["id", "label", "buildable", "walkable", "groundSpeedMultiplier", "tags"], `terrainTypeOverrides.${id}`);
    if (terrain.id !== undefined && terrain.id !== id) throw new Error(`Terrain ${id} has a mismatched id.`);
    const tags = Array.isArray(terrain.tags) ? terrain.tags : String(terrain.tags ?? "").split(",");
    result[id] = {
      id,
      label: String(terrain.label ?? id).slice(0, 120),
      buildable: booleanValue(terrain.buildable, false),
      walkable: booleanValue(terrain.walkable, true),
      groundSpeedMultiplier: finitePositiveNumber(terrain.groundSpeedMultiplier ?? 1, `terrainTypeOverrides.${id}.groundSpeedMultiplier`),
      tags: tags.map((tag) => String(tag).trim()).filter(Boolean).map((tag) => safeId(tag)).slice(0, 64)
    };
  }
  return result;
}

function wangSignature(ids, ruleKind) {
  const binary = ids.map((value) => value > 0 ? "1" : "0");
  if (ruleKind === "edge") return `edge:${bitsToMask([binary[0], binary[2], binary[4], binary[6]])}`;
  if (ruleKind === "corner") return `corner:${bitsToMask([binary[7], binary[1], binary[3], binary[5]])}`;
  return `wang:${binary.join("")}`;
}

function normalizeWangId(value) {
  if (Array.isArray(value)) return value.map((entry) => Number(entry) || 0).slice(0, 8).concat(Array(8).fill(0)).slice(0, 8);
  return String(value ?? "").split(",").map((entry) => Number(entry) || 0).slice(0, 8).concat(Array(8).fill(0)).slice(0, 8);
}

function normalizeWangType(type, topology) {
  if (topology === "hex") return "edge";
  if (type === "edge" || type === "corner" || type === "mixed") return type;
  return "mixed";
}

function normalizeTransformations(value = {}) {
  return {
    hflip: booleanValue(value.hflip, false),
    vflip: booleanValue(value.vflip, false),
    rotate: booleanValue(value.rotate, false),
    preferUntransformed: booleanValue(value.preferuntransformed ?? value.preferUntransformed, true)
  };
}

function mergeTransformations(imported = {}, overrides = {}) {
  const result = { ...(imported ?? {}), ...(overrides ?? {}) };
  if (overrides?.preferUntransformed !== undefined) result.preferuntransformed = overrides.preferUntransformed;
  return result;
}

function propertiesToObject(properties) {
  const result = {};
  for (const property of properties ?? []) if (property && typeof property.name === "string") result[property.name] = property.value;
  return result;
}

function normalizeXmlProperties(properties) {
  return asArray(properties).map((property) => ({
    name: property.name,
    type: property.type ?? "string",
    value: parsePropertyValue(property.value ?? property["#text"], property.type)
  }));
}

function parsePropertyValue(value, type) {
  if (type === "bool") return String(value) === "true" || String(value) === "1";
  if (type === "int" || type === "float") return Number(value);
  return String(value ?? "");
}

function asArray(value) { return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]; }
function bitsToMask(bits) { return bits.reduce((mask, bit, index) => bit === "1" ? mask | 1 << index : mask, 0); }
function safeId(value) {
  const id = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(id)) throw new Error(`Unsafe tileset id "${id}".`);
  return id;
}
function positiveInteger(value, field) { if (!Number.isInteger(Number(value)) || Number(value) <= 0) throw new Error(`${field} must be a positive integer.`); return Number(value); }
function nonNegativeInteger(value, field) { if (!Number.isInteger(Number(value)) || Number(value) < 0) throw new Error(`${field} must be a non-negative integer.`); return Number(value); }
function numberOrUndefined(value) { const number = Number(value); return Number.isFinite(number) ? number : undefined; }
function finiteNumber(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function booleanValue(value, fallback) { return typeof value === "boolean" ? value : value === "true" || value === "1" ? true : value === "false" || value === "0" ? false : fallback; }
function finitePositiveNumber(value, field) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be a finite number greater than zero.`); return number; }
function rejectUnknownKeys(value, allowed, field) { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${field} contains unsupported field "${key}".`); }
function invalid(message) { throw new Error(message); }
