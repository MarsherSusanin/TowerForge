import fs from "node:fs";
import path from "node:path";
import { listVisualAssetPaths, validateSafeAssetPath } from "./project-schema.mjs";

export function importProjectAsset(projectDir, visuals, request) {
  const assetsRoot = visuals.assetsRoot || "assets";
  const sourceRel = request?.sourcePath;
  const targetRel = request?.targetPath || path.basename(sourceRel || "");
  const sourceIssue = validateSafeAssetPath(sourceRel, "sourcePath");
  if (sourceIssue) throw new Error(sourceIssue);
  const targetIssue = validateSafeAssetPath(targetRel, "targetPath");
  if (targetIssue) throw new Error(targetIssue);

  const sourcePath = resolveInsideProject(projectDir, sourceRel);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`Asset source not found: ${sourceRel}`);
  }

  const assetRelPath = path.posix.join(assetsRoot, toPosix(targetRel));
  const destPath = resolveInsideProject(projectDir, assetRelPath);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  if (path.resolve(sourcePath) !== path.resolve(destPath)) {
    fs.copyFileSync(sourcePath, destPath);
  }

  const updatedVisuals = JSON.parse(JSON.stringify(visuals));
  updatedVisuals.assetsRoot ??= assetsRoot;
  updatedVisuals.sprites ??= {};
  updatedVisuals.atlases ??= {};
  updatedVisuals.bindings ??= { towers: {}, enemies: {}, tiles: {}, ui: {} };

  const id = request?.id || path.basename(targetRel, path.extname(targetRel)).replace(/[^a-zA-Z0-9_-]+/g, "_");
  const kind = request?.kind || "sprite";
  if (kind === "atlas") {
    updatedVisuals.atlases[id] = {
      ...(updatedVisuals.atlases[id] ?? {}),
      src: assetRelPath,
      columns: Number(request?.columns ?? updatedVisuals.atlases[id]?.columns ?? 1),
      rows: Number(request?.rows ?? updatedVisuals.atlases[id]?.rows ?? 1)
    };
  } else {
    updatedVisuals.sprites[id] = {
      ...(updatedVisuals.sprites[id] ?? {}),
      src: assetRelPath
    };
  }

  return { visuals: updatedVisuals, asset: { id, kind, path: assetRelPath } };
}

export function copyVisualAssets(projectDir, outDir, visuals) {
  const copied = [];
  const missing = [];
  const invalid = [];
  for (const item of listVisualAssetPaths(visuals)) {
    const safeIssue = validateSafeAssetPath(item.path, item.id);
    if (safeIssue) {
      invalid.push({ ...item, reason: safeIssue });
      continue;
    }
    const sourcePath = resolveInsideProject(projectDir, item.path);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      missing.push(item);
      continue;
    }
    const destPath = path.join(outDir, item.path);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(sourcePath, destPath);
    copied.push(item);
  }
  return { copied, missing, invalid };
}

function resolveInsideProject(projectDir, relPath) {
  const fullPath = path.resolve(projectDir, relPath);
  const rel = path.relative(projectDir, fullPath);
  if (!rel || rel === "." || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes project directory: ${relPath}`);
  }
  return fullPath;
}

function toPosix(value) {
  return String(value).replace(/\\/g, "/").replace(/^\/+/, "");
}
