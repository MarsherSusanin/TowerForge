import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { validateProjectDir } from "./project-loader.mjs";

export const TDPACK_FORMAT = "towerforge.tdpack";
export const TDPACK_VERSION = 1;

const ROOT_FILES = new Set(["project.json", "build-targets.json"]);
const ROOT_DIRS = new Set(["content", "maps", "assets", "scripts"]);
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_PACK_BYTES = 256 * 1024 * 1024;

export async function exportProjectPack(projectDir, outputPath) {
  const { result } = await validateProjectDir(projectDir);
  if (!result.ok) {
    const count = result.issues.filter((issue) => issue.severity === "error").length;
    throw new Error(`Cannot export an invalid project (${count} validation error${count === 1 ? "" : "s"}).`);
  }
  const entries = collectPackEntries(projectDir);
  const manifest = {
    format: TDPACK_FORMAT,
    version: TDPACK_VERSION,
    createdAt: new Date().toISOString(),
    projectName: JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")).name ?? path.basename(projectDir, ".tdproj"),
    entries
  };
  const compressed = gzipSync(Buffer.from(JSON.stringify(manifest), "utf8"), { level: 9 });
  if (compressed.length > MAX_PACK_BYTES) throw new Error(`Pack exceeds the ${MAX_PACK_BYTES} byte archive limit.`);
  const resolvedOutput = path.resolve(outputPath ?? path.join(path.dirname(projectDir), `${path.basename(projectDir, ".tdproj")}.tdpack`));
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  const tmp = `${resolvedOutput}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tmp, compressed);
    fs.renameSync(tmp, resolvedOutput);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return {
    ok: true,
    outputPath: resolvedOutput,
    fileCount: entries.length,
    sourceBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    packBytes: compressed.length,
    sha256: sha256(compressed),
    format: TDPACK_FORMAT,
    version: TDPACK_VERSION
  };
}

export function inspectProjectPack(packPath) {
  const source = fs.readFileSync(packPath);
  if (source.length > MAX_PACK_BYTES) throw new Error(`Pack exceeds the ${MAX_PACK_BYTES} byte archive limit.`);
  let manifest;
  try {
    manifest = JSON.parse(gunzipSync(source, { maxOutputLength: MAX_TOTAL_BYTES * 2 }).toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid .tdpack container: ${error.message}`);
  }
  if (manifest?.format !== TDPACK_FORMAT || manifest?.version !== TDPACK_VERSION) {
    throw new Error(`Unsupported .tdpack format/version: ${String(manifest?.format)} v${String(manifest?.version)}.`);
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0 || manifest.entries.length > MAX_FILES) {
    throw new Error(`Pack must contain between 1 and ${MAX_FILES} files.`);
  }
  const seen = new Set();
  let sourceBytes = 0;
  const entries = manifest.entries.map((entry) => {
    const relativePath = validatePackPath(entry?.path);
    if (seen.has(relativePath)) throw new Error(`Pack contains duplicate path "${relativePath}".`);
    seen.add(relativePath);
    const bytes = Buffer.from(String(entry?.data ?? ""), "base64");
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`Pack entry "${relativePath}" exceeds the per-file size limit.`);
    sourceBytes += bytes.length;
    if (sourceBytes > MAX_TOTAL_BYTES) throw new Error("Pack exceeds the total uncompressed size limit.");
    if (entry.size !== bytes.length || entry.sha256 !== sha256(bytes)) throw new Error(`Pack entry "${relativePath}" failed size/SHA-256 verification.`);
    return { path: relativePath, size: bytes.length, sha256: entry.sha256, bytes };
  });
  if (!seen.has("project.json")) throw new Error("Pack is missing project.json.");
  return {
    format: manifest.format,
    version: manifest.version,
    createdAt: manifest.createdAt,
    projectName: manifest.projectName,
    fileCount: entries.length,
    sourceBytes,
    packBytes: source.length,
    sha256: sha256(source),
    entries
  };
}

export async function importProjectPack(packPath, parentDir, options = {}) {
  const pack = inspectProjectPack(packPath);
  const projectName = options.name
    ? safeProjectName(options.name)
    : slugProjectName(pack.projectName ?? path.basename(packPath, ".tdpack"));
  const destination = path.resolve(parentDir, `${projectName}.tdproj`);
  if (fs.existsSync(destination)) throw new Error(`Destination already exists: ${destination}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.import-${process.pid}-${Date.now()}`;
  try {
    fs.mkdirSync(temporary, { recursive: false });
    for (const entry of pack.entries) {
      const output = path.join(temporary, ...entry.path.split("/"));
      const relative = path.relative(temporary, output);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Pack path escapes destination: ${entry.path}`);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, entry.bytes, { flag: "wx" });
    }
    const { result } = await validateProjectDir(temporary);
    if (!result.ok) {
      const first = result.issues.find((issue) => issue.severity === "error");
      throw new Error(`Imported project is invalid: ${first?.message ?? "validation failed"}`);
    }
    fs.renameSync(temporary, destination);
    return { ok: true, projectDir: destination, projectName, fileCount: pack.fileCount, sha256: pack.sha256 };
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function collectPackEntries(projectDir) {
  const paths = [];
  for (const file of [...ROOT_FILES].sort()) {
    const absolute = path.join(projectDir, file);
    if (fs.existsSync(absolute)) paths.push(file);
  }
  for (const dir of [...ROOT_DIRS].sort()) {
    const absolute = path.join(projectDir, dir);
    if (fs.existsSync(absolute)) walkProjectTree(projectDir, absolute, paths);
  }
  if (!paths.includes("project.json")) throw new Error("Project is missing project.json.");
  if (paths.length > MAX_FILES) throw new Error(`Project exceeds the ${MAX_FILES} file pack limit.`);
  let total = 0;
  return paths.sort().map((relativePath) => {
    const absolute = path.join(projectDir, ...relativePath.split("/"));
    const bytes = fs.readFileSync(absolute);
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`Project file "${relativePath}" exceeds the per-file size limit.`);
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) throw new Error("Project exceeds the total pack size limit.");
    return { path: relativePath, size: bytes.length, sha256: sha256(bytes), data: bytes.toString("base64") };
  });
}

function walkProjectTree(projectDir, current, output) {
  for (const name of fs.readdirSync(current).sort()) {
    const absolute = path.join(current, name);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not supported in .tdpack exports: ${path.relative(projectDir, absolute)}`);
    if (stat.isDirectory()) walkProjectTree(projectDir, absolute, output);
    else if (stat.isFile()) output.push(path.relative(projectDir, absolute).split(path.sep).join("/"));
  }
}

function validatePackPath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0")) throw new Error("Pack contains an invalid file path.");
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized.startsWith("../") || normalized.startsWith("/") || path.posix.isAbsolute(normalized)) {
    throw new Error(`Pack contains unsafe path "${value}".`);
  }
  const [root, ...rest] = normalized.split("/");
  if (!(ROOT_FILES.has(normalized) || (ROOT_DIRS.has(root) && rest.length > 0))) throw new Error(`Pack path is outside allowed project roots: ${value}`);
  return normalized;
}

function safeProjectName(value) {
  const name = String(value).replace(/\.tdproj$/i, "");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(name)) throw new Error("Project name must use 1-80 letters, digits, hyphens, or underscores.");
  return name;
}

function slugProjectName(value) {
  const slug = String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return safeProjectName(slug || "imported-project");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
