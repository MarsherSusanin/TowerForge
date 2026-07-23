import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { backupProjectEntry } from "./project-scripts.mjs";

const IGNORED_DIRS = new Set([".git", ".towerforge", "node_modules", "dist", "target", "build"]);
const TEXT_EXTENSIONS = new Set([".json", ".tmj", ".tower", ".md", ".txt", ".css", ".js", ".mjs", ".ts", ".html", ".svg", ".gitignore"]);
const MAX_TREE_ENTRIES = 2500;
const MAX_TREE_DEPTH = 32;
const MAX_READ_BYTES = 1024 * 1024;
const SENSITIVE_NAMES = new Set([".env", ".env.local", ".env.development", ".env.production", "credentials.json"]);
const SENSITIVE_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx"]);

export function listProjectTree(projectDir) {
  const root = path.resolve(projectDir);
  const ignoredRootDirs = generatedRootDirs(root);
  let count = 0;
  let truncated = false;
  const walk = (directory, relativeBase = "", depth = 0) => {
    if (depth > MAX_TREE_DEPTH) {
      truncated = true;
      return [];
    }
    const nodes = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort(compareEntries)) {
      if (count >= MAX_TREE_ENTRIES) {
        truncated = true;
        break;
      }
      if (entry.name === ".DS_Store" || isSensitiveName(entry.name) || (entry.name.startsWith(".") && entry.name !== ".gitignore") || (entry.isDirectory() && (IGNORED_DIRS.has(entry.name) || (!relativeBase && ignoredRootDirs.has(entry.name))))) continue;
      const absolute = path.join(directory, entry.name);
      if (fs.lstatSync(absolute).isSymbolicLink()) continue;
      count += 1;
      const relativePath = [relativeBase, entry.name].filter(Boolean).join("/");
      if (entry.isDirectory()) {
        nodes.push({ name: entry.name, path: relativePath, kind: "directory", manageable: relativePath === "scripts" || relativePath.startsWith("scripts/"), children: walk(absolute, relativePath, depth + 1) });
      } else if (entry.isFile()) {
        const stat = fs.statSync(absolute);
        nodes.push({ name: entry.name, path: relativePath, kind: "file", size: stat.size, text: isTextFile(entry.name), editable: relativePath.startsWith("scripts/") && entry.name.endsWith(".tower.json"), manageable: relativePath.startsWith("scripts/") });
      }
    }
    return nodes;
  };
  return { nodes: walk(root), truncated, entryCount: count };
}

export function readProjectTextFile(projectDir, relativePath) {
  if (normalizeRelative(relativePath).split("/").some((segment) => IGNORED_DIRS.has(segment) || isSensitiveName(segment))) throw new Error("This project path is not exposed by the editor.");
  const absolute = resolveProjectEntry(projectDir, relativePath, { mustExist: true });
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) throw new Error("Project entry is not a file.");
  if (!isTextFile(path.basename(absolute))) throw new Error("Binary files cannot be opened in the text editor.");
  if (stat.size > MAX_READ_BYTES) throw new Error(`Text file exceeds ${MAX_READ_BYTES} bytes.`);
  const bytes = fs.readFileSync(absolute);
  return { path: normalizeRelative(relativePath), source: bytes.toString("utf8"), size: stat.size, revision: createHash("sha256").update(bytes).digest("hex").slice(0, 20), editable: normalizeRelative(relativePath).startsWith("scripts/") && relativePath.endsWith(".tower.json") };
}

export function createScriptDirectory(projectDir, relativePath) {
  const absolute = resolveManageableScriptEntry(projectDir, relativePath);
  if (fs.existsSync(absolute)) throw new Error("Project entry already exists.");
  fs.mkdirSync(absolute, { recursive: false });
  return { ok: true, path: normalizeRelative(relativePath) };
}

export function renameScriptEntry(projectDir, fromPath, toPath) {
  const from = resolveManageableScriptEntry(projectDir, fromPath, { mustExist: true });
  const to = resolveManageableScriptEntry(projectDir, toPath);
  if (fs.existsSync(to)) throw new Error("Destination already exists.");
  const fromIsFile = fs.statSync(from).isFile();
  if (fromIsFile && (!fromPath.endsWith(".tower.json") || !toPath.endsWith(".tower.json"))) throw new Error("TowerScript files must keep the .tower.json suffix.");
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  return { ok: true, from: normalizeRelative(fromPath), to: normalizeRelative(toPath) };
}

export function deleteScriptEntry(projectDir, relativePath) {
  const absolute = resolveManageableScriptEntry(projectDir, relativePath, { mustExist: true });
  const backup = backupProjectEntry(projectDir, absolute);
  fs.rmSync(absolute, { recursive: true, force: true });
  return { ok: true, path: normalizeRelative(relativePath), backup };
}

export function resolveProjectEntry(projectDir, relativePath, { mustExist = false } = {}) {
  const normalized = normalizeRelative(relativePath);
  const root = path.resolve(projectDir);
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Project path escapes the project directory.");
  assertNoSymlinks(root, absolute, mustExist);
  if (mustExist && !fs.existsSync(absolute)) throw new Error(`Project entry does not exist: ${normalized}`);
  return absolute;
}

function resolveManageableScriptEntry(projectDir, relativePath, options) {
  const normalized = normalizeRelative(relativePath);
  if (normalized === "scripts" || !normalized.startsWith("scripts/")) throw new Error("Project tree writes are confined to entries below scripts/.");
  return resolveProjectEntry(projectDir, normalized, options);
}

function normalizeRelative(value) {
  if (typeof value !== "string" || !value) throw new Error("Project path is required.");
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.includes("\0") || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) throw new Error("Invalid project path.");
  return normalized;
}

function assertNoSymlinks(root, absolute, includeLeaf) {
  let current = includeLeaf ? absolute : path.dirname(absolute);
  while (current.startsWith(root) && current !== root) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("Project tree operations do not follow symbolic links.");
    current = path.dirname(current);
  }
}

function isTextFile(name) {
  return name === ".gitignore" || TEXT_EXTENSIONS.has(path.extname(name).toLowerCase()) || name.endsWith(".tower.json");
}

function isSensitiveName(name) {
  return SENSITIVE_NAMES.has(name.toLowerCase()) || SENSITIVE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function compareEntries(a, b) {
  if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function generatedRootDirs(projectDir) {
  const result = new Set(["desktop", "mobile", "web"]);
  try {
    const buildTargets = JSON.parse(fs.readFileSync(path.join(projectDir, "build-targets.json"), "utf8"));
    for (const target of Object.values(buildTargets?.targets ?? {})) {
      const value = typeof target?.webDir === "string" ? target.webDir.replaceAll("\\", "/") : "";
      const first = value.split("/")[0];
      if (first && first !== "." && first !== ".." && !path.isAbsolute(value)) result.add(first);
    }
  } catch { /* A malformed catalog is reported by project validation. */ }
  return result;
}
