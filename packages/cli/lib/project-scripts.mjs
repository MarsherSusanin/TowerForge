import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TOWER_SCRIPT_SUFFIX = ".tower.json";
export const MAX_TOWER_SCRIPT_BYTES = 256 * 1024;
export const MAX_TOWER_SCRIPT_FILES = 128;
export const MAX_TOWER_SCRIPT_SCAN_ENTRIES = 4096;
export const MAX_TOWER_SCRIPT_DEPTH = 32;

export function readTowerScriptFiles(projectDir) {
  const root = path.join(projectDir, "scripts");
  const files = {};
  const scripts = {};
  const issues = [];
  if (!fs.existsSync(root)) return { files, scripts, issues };

  const paths = [];
  walkScriptFiles(root, root, paths, issues, { entries: 0, stopped: false }, 0);
  for (const absolutePath of paths.slice(0, MAX_TOWER_SCRIPT_FILES)) {
    const relativePath = toProjectPath(projectDir, absolutePath);
    let source = "";
    try {
      const size = fs.statSync(absolutePath).size;
      if (size > MAX_TOWER_SCRIPT_BYTES) {
        issues.push({ path: relativePath, message: `TowerScript exceeds ${MAX_TOWER_SCRIPT_BYTES} bytes.` });
        files[relativePath] = { path: relativePath, source: "", error: "File is too large." };
        continue;
      }
      source = fs.readFileSync(absolutePath, "utf8");
      const definition = JSON.parse(source);
      files[relativePath] = { path: relativePath, source, definition };
      const id = typeof definition?.id === "string" ? definition.id : "";
      if (!id) {
        issues.push({ path: relativePath, message: "TowerScript needs a non-empty id." });
      } else if (scripts[id]) {
        issues.push({ path: relativePath, message: `Duplicate TowerScript id "${id}".` });
      } else {
        scripts[id] = definition;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      files[relativePath] = { path: relativePath, source, error: message };
      issues.push({ path: relativePath, message: `Invalid TowerScript JSON: ${message}` });
    }
  }
  if (paths.length > MAX_TOWER_SCRIPT_FILES) issues.push({ path: "scripts", message: `A project may contain at most ${MAX_TOWER_SCRIPT_FILES} TowerScript files.` });
  return { files, scripts, issues };
}

export function parseTowerScriptSource(source) {
  if (typeof source !== "string") throw new Error("TowerScript source must be text.");
  if (Buffer.byteLength(source, "utf8") > MAX_TOWER_SCRIPT_BYTES) throw new Error(`TowerScript exceeds ${MAX_TOWER_SCRIPT_BYTES} bytes.`);
  let definition;
  try { definition = JSON.parse(source); }
  catch (error) { throw new Error(`Invalid TowerScript JSON: ${error.message}`); }
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error("TowerScript root must be an object.");
  return definition;
}

export function resolveTowerScriptPath(projectDir, relativePath, { mustExist = false } = {}) {
  if (typeof relativePath !== "string" || !relativePath.replaceAll("\\", "/").startsWith("scripts/")) throw new Error("TowerScript path must stay under scripts/.");
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized.endsWith(TOWER_SCRIPT_SUFFIX)) throw new Error(`TowerScript filename must end with ${TOWER_SCRIPT_SUFFIX}.`);
  if (normalized.includes("\0") || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) throw new Error("Invalid TowerScript path.");
  const projectRoot = path.resolve(projectDir);
  const absolutePath = path.resolve(projectRoot, normalized);
  const relative = path.relative(projectRoot, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("TowerScript path escapes the project.");
  assertNoSymlinkPath(projectRoot, absolutePath, mustExist);
  if (mustExist && (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile())) throw new Error(`TowerScript does not exist: ${normalized}`);
  return absolutePath;
}

export function scriptFileRevision(filePath) {
  if (!fs.existsSync(filePath)) return "missing";
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").slice(0, 20);
}

export function writeTowerScriptAtomic(projectDir, relativePath, source, { ifRevision } = {}) {
  const definition = parseTowerScriptSource(source);
  const absolutePath = resolveTowerScriptPath(projectDir, relativePath);
  const revision = scriptFileRevision(absolutePath);
  if (ifRevision !== undefined && ifRevision !== revision) return { ok: false, conflict: true, revision, path: relativePath };
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const backup = backupProjectEntry(projectDir, absolutePath);
  const temporary = `${absolutePath}.tmp.${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(definition, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, absolutePath);
  return { ok: true, path: relativePath, definition, backup, revision: scriptFileRevision(absolutePath), previousRevision: revision };
}

export function restoreTowerScriptWrite(projectDir, relativePath, backup) {
  const absolutePath = resolveTowerScriptPath(projectDir, relativePath);
  if (backup && fs.existsSync(backup)) {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.copyFileSync(backup, absolutePath);
  } else {
    fs.rmSync(absolutePath, { force: true });
  }
}

export function backupProjectEntry(projectDir, absolutePath) {
  if (!fs.existsSync(absolutePath)) return null;
  const relative = path.relative(projectDir, absolutePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(projectDir, ".towerforge", "backups", "scripts", stamp, relative);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.cpSync(absolutePath, backup, { recursive: true });
  return backup;
}

function walkScriptFiles(root, current, paths, issues, scan, depth) {
  if (scan.stopped) return;
  if (depth > MAX_TOWER_SCRIPT_DEPTH) {
    issues.push({ path: path.relative(root, current) || "scripts", message: `TowerScript directories may be at most ${MAX_TOWER_SCRIPT_DEPTH} levels deep.` });
    return;
  }
  for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    scan.entries += 1;
    if (scan.entries > MAX_TOWER_SCRIPT_SCAN_ENTRIES) {
      issues.push({ path: "scripts", message: `TowerScript scan exceeds ${MAX_TOWER_SCRIPT_SCAN_ENTRIES} entries.` });
      scan.stopped = true;
      return;
    }
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      issues.push({ path: path.relative(root, absolute), message: "Symbolic links are not allowed under scripts/." });
    } else if (entry.isDirectory()) {
      walkScriptFiles(root, absolute, paths, issues, scan, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith(TOWER_SCRIPT_SUFFIX)) {
      paths.push(absolute);
    }
  }
}

function assertNoSymlinkPath(projectRoot, absolutePath, includeLeaf) {
  let current = path.dirname(absolutePath);
  const stop = path.resolve(projectRoot);
  while (current.startsWith(stop) && current !== stop) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("Symbolic links are not allowed in TowerScript paths.");
    current = path.dirname(current);
  }
  if (includeLeaf && fs.existsSync(absolutePath) && fs.lstatSync(absolutePath).isSymbolicLink()) throw new Error("Symbolic links are not allowed in TowerScript paths.");
}

function toProjectPath(projectDir, absolutePath) {
  return path.relative(projectDir, absolutePath).split(path.sep).join("/");
}
