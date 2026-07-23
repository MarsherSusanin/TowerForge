#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function listFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in the release: ${path.relative(root, absolute)}`);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  };
  walk(root);
  return files.sort();
}

function safeRelativePath(value) {
  return typeof value === "string"
    && value !== "build-manifest.json"
    && !value.includes("\\")
    && !path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value
    && !value.startsWith("../")
    && value !== "..";
}

export function verifyReleaseTree(root) {
  const manifestPath = path.join(root, "build-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported build manifest schema.");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.pluginVersion ?? "")) throw new Error("Invalid pluginVersion.");
  if (!/^[0-9a-f]{40}$/.test(manifest.sourceCommit ?? "")) throw new Error("Invalid sourceCommit.");
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error("Manifest file list is empty.");

  const expected = new Set();
  for (const record of manifest.files) {
    if (!safeRelativePath(record.path) || expected.has(record.path)) throw new Error(`Invalid or duplicate manifest path: ${record.path}`);
    expected.add(record.path);
    const absolute = path.join(root, ...record.path.split("/"));
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Manifest entry is not a regular file: ${record.path}`);
    if (stat.size !== record.size) throw new Error(`Size mismatch: ${record.path}`);
    if (sha256(absolute) !== record.sha256) throw new Error(`SHA-256 mismatch: ${record.path}`);
  }

  const actual = listFiles(root).filter((file) => file !== "build-manifest.json");
  const unexpected = actual.filter((file) => !expected.has(file));
  const missing = [...expected].filter((file) => !actual.includes(file));
  if (unexpected.length || missing.length) {
    throw new Error(`Release tree differs from manifest. Unexpected: ${unexpected.join(", ") || "none"}; missing: ${missing.join(", ") || "none"}.`);
  }
  return { ok: true, fileCount: actual.length, pluginVersion: manifest.pluginVersion, sourceCommit: manifest.sourceCommit };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const root = path.resolve(process.argv[2] ?? path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const result = verifyReleaseTree(root);
  process.stdout.write(`Verified TowerForge Codex plugin ${result.pluginVersion}: ${result.fileCount} files, source ${result.sourceCommit}.\n`);
}
