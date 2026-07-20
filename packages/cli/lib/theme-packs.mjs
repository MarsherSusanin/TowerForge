import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeVisuals, validateSafeAssetPath } from "./project-schema.mjs";
import { readRawProjectFiles, validateProjectDir } from "./project-loader.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THEME_PACKS_ROOT = path.resolve(__dirname, "../theme-packs");
const PACK_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function listThemePacks() {
  if (!fs.existsSync(THEME_PACKS_ROOT)) return [];
  return fs.readdirSync(THEME_PACKS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && PACK_ID_RE.test(entry.name))
    .map((entry) => readThemePack(entry.name))
    .map(({ manifest }) => ({
      id: manifest.id,
      label: manifest.label,
      description: manifest.description,
      background: manifest.background,
      theme: manifest.theme,
      previewUrl: `/api/theme-packs/${encodeURIComponent(manifest.id)}/preview`
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function getThemePackPreviewPath(packId) {
  return readThemePack(packId).sourcePath;
}

export function themePackRevision(projectDir) {
  const hash = createHash("sha256");
  for (const rel of ["content/visuals.json", "content/battle-backgrounds.json"]) {
    const filePath = path.join(projectDir, rel);
    hash.update(`${rel}:`);
    if (fs.existsSync(filePath)) hash.update(fs.readFileSync(filePath));
    hash.update(";");
  }
  return hash.digest("hex").slice(0, 20);
}

export function previewThemePack(projectDir, packId) {
  const plan = planThemePack(projectDir, packId);
  return {
    ok: true,
    dryRun: true,
    pack: publicPack(plan.manifest),
    revision: plan.revision,
    changes: plan.changes
  };
}

export async function applyThemePack(projectDir, packId, options = {}) {
  const plan = planThemePack(projectDir, packId);
  if (options.ifRevision && options.ifRevision !== plan.revision) {
    return {
      ok: false,
      conflict: true,
      expectedRevision: options.ifRevision,
      actualRevision: plan.revision,
      message: "Theme files changed since preview; no files were written."
    };
  }
  if (options.dryRun) return previewThemePack(projectDir, packId);

  const originals = snapshotPaths([plan.visualsPath, plan.backgroundsPath, plan.destinationPath]);
  const backupDir = createBackup(projectDir, plan.manifest.id, originals);
  try {
    copyFileAtomic(plan.sourcePath, plan.destinationPath);
    writeJsonAtomic(plan.visualsPath, plan.visuals);
    writeJsonAtomic(plan.backgroundsPath, plan.battleBackgrounds);
    const validation = await validateProjectDir(projectDir);
    if (!validation.result.ok) {
      const errors = validation.result.issues.filter((issue) => issue.severity === "error");
      throw new ThemeValidationError("Theme pack produced an invalid project.", errors);
    }
    return {
      ok: true,
      dryRun: false,
      pack: publicPack(plan.manifest),
      revision: themePackRevision(projectDir),
      backupDir,
      changes: plan.changes,
      validation: validation.result
    };
  } catch (error) {
    restorePaths(originals);
    return {
      ok: false,
      rolledBack: true,
      packId,
      backupDir,
      error: error.message,
      issues: error instanceof ThemeValidationError ? error.issues : undefined
    };
  }
}

function planThemePack(projectDir, packId) {
  const projectFile = path.join(projectDir, "project.json");
  if (!fs.existsSync(projectFile)) throw new Error(`No project.json found at: ${projectDir}`);
  const { manifest, sourcePath } = readThemePack(packId);
  const raw = readRawProjectFiles(projectDir);
  const missionIds = Object.keys(raw.balance?.missions ?? {});
  if (!missionIds.length) throw new Error("A theme pack needs at least one mission to bind its battle background.");

  const destinationRel = `assets/themes/${manifest.id}/battle-background.png`;
  const destinationPath = resolveInside(projectDir, destinationRel, "theme asset destination");
  const visuals = normalizeVisuals(raw.visuals);
  visuals.sprites[manifest.asset.spriteId] = { src: destinationRel };
  visuals.theme = structuredClone(manifest.theme);
  visuals.theme.id = manifest.id;
  visuals.theme.label = manifest.label;

  const battleBackgrounds = structuredClone(raw.battleBackgrounds ?? {});
  battleBackgrounds.fallbackMissionId = battleBackgrounds.fallbackMissionId || missionIds[0];
  battleBackgrounds.placeholderMissionIds = [];
  battleBackgrounds.definitions = battleBackgrounds.definitions && typeof battleBackgrounds.definitions === "object"
    ? battleBackgrounds.definitions
    : {};
  for (const missionId of missionIds) {
    battleBackgrounds.definitions[missionId] = {
      ...(battleBackgrounds.definitions[missionId] ?? {}),
      missionId,
      spriteId: manifest.asset.spriteId,
      color: manifest.background.color,
      opacity: manifest.background.opacity
    };
  }

  return {
    manifest,
    sourcePath,
    destinationPath,
    visualsPath: path.join(projectDir, "content", "visuals.json"),
    backgroundsPath: path.join(projectDir, "content", "battle-backgrounds.json"),
    visuals,
    battleBackgrounds,
    revision: themePackRevision(projectDir),
    changes: {
      files: ["content/visuals.json", "content/battle-backgrounds.json", destinationRel],
      spriteId: manifest.asset.spriteId,
      missionIds,
      replacesThemeId: raw.visuals?.theme?.id ?? null
    }
  };
}

function readThemePack(packId) {
  if (typeof packId !== "string" || !PACK_ID_RE.test(packId)) throw new Error("Invalid theme pack id.");
  const packDir = resolveInside(THEME_PACKS_ROOT, packId, "theme pack");
  const manifestPath = path.join(packDir, "pack.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`Unknown theme pack: ${packId}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  validateManifest(manifest, packId);
  const sourcePath = resolveInside(packDir, manifest.asset.source, "theme asset source");
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`Theme pack asset not found: ${manifest.asset.source}`);
  }
  return { manifest, sourcePath };
}

function validateManifest(manifest, expectedId) {
  if (manifest?.schemaVersion !== 1) throw new Error(`Theme pack ${expectedId} uses an unsupported schemaVersion.`);
  if (manifest.id !== expectedId || !PACK_ID_RE.test(manifest.id)) throw new Error(`Theme pack manifest id must match ${expectedId}.`);
  if (typeof manifest.label !== "string" || !manifest.label.trim()) throw new Error(`Theme pack ${expectedId} needs a label.`);
  if (validateSafeAssetPath(manifest.asset?.source, "asset.source")) throw new Error(validateSafeAssetPath(manifest.asset?.source, "asset.source"));
  if (!/^[a-zA-Z0-9_.-]+$/.test(manifest.asset?.spriteId ?? "")) throw new Error(`Theme pack ${expectedId} has an invalid spriteId.`);
  if (!/^#[0-9a-f]{6}$/i.test(manifest.background?.color ?? "")) throw new Error(`Theme pack ${expectedId} has an invalid background color.`);
  if (!Number.isFinite(manifest.background?.opacity) || manifest.background.opacity < 0 || manifest.background.opacity > 1) {
    throw new Error(`Theme pack ${expectedId} opacity must be between 0 and 1.`);
  }
  for (const group of [manifest.theme?.ui, manifest.theme?.renderer]) {
    if (!group || typeof group !== "object") throw new Error(`Theme pack ${expectedId} needs UI and renderer palettes.`);
    for (const [key, value] of Object.entries(group)) {
      if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Theme pack ${expectedId} palette ${key} must be a six-digit hex color.`);
    }
  }
}

function resolveInside(root, relativePath, label) {
  const fullPath = path.resolve(root, relativePath);
  const relative = path.relative(root, fullPath);
  if (!relative || relative === "." || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes its allowed root.`);
  }
  return fullPath;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, filePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function copyFileAtomic(sourcePath, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const tempPath = `${destinationPath}.tmp.${process.pid}`;
  try {
    fs.copyFileSync(sourcePath, tempPath);
    fs.renameSync(tempPath, destinationPath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function snapshotPaths(paths) {
  return paths.map((filePath) => ({
    filePath,
    existed: fs.existsSync(filePath),
    content: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null
  }));
}

function restorePaths(snapshots) {
  for (const item of snapshots) {
    if (item.existed) {
      fs.mkdirSync(path.dirname(item.filePath), { recursive: true });
      fs.writeFileSync(item.filePath, item.content);
    } else {
      fs.rmSync(item.filePath, { force: true });
    }
  }
}

function createBackup(projectDir, packId, snapshots) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(projectDir, ".towerforge", "backups", `theme-${packId}-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const item of snapshots) {
    if (!item.existed) continue;
    const relative = path.relative(projectDir, item.filePath);
    const destination = path.join(backupDir, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, item.content);
  }
  return backupDir;
}

function publicPack(manifest) {
  return {
    id: manifest.id,
    label: manifest.label,
    description: manifest.description,
    background: manifest.background,
    theme: manifest.theme
  };
}

class ThemeValidationError extends Error {
  constructor(message, issues) {
    super(message);
    this.issues = issues;
  }
}
