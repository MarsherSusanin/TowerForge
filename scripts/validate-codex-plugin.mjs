#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "plugins", "towerforge");
const manifestPath = path.join(plugin, ".codex-plugin", "plugin.json");
const marketplacePath = path.join(root, ".agents", "plugins", "marketplace.json");
const distributionPath = path.join(root, "distribution", "codex-plugin");
const mirrorSyncPath = path.join(distributionPath, ".github", "workflows", "sync.yml");
const errors = [];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { errors.push(`${path.relative(root, file)}: ${error.message}`); return {}; }
}

const manifest = readJson(manifestPath);
const marketplace = readJson(marketplacePath);
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.name ?? "")) errors.push("plugin name must be kebab-case");
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version ?? "")) errors.push("plugin version must be semver");
for (const field of ["description", "author", "interface"]) if (!manifest[field]) errors.push(`plugin manifest is missing ${field}`);
for (const field of ["displayName", "shortDescription", "longDescription", "developerName", "category", "capabilities"]) {
  if (!manifest.interface?.[field]) errors.push(`plugin interface is missing ${field}`);
}
if ((manifest.interface?.defaultPrompt?.length ?? 0) > 3) errors.push("plugin may expose at most three default prompts");
for (const prompt of manifest.interface?.defaultPrompt ?? []) if (prompt.length > 128) errors.push(`default prompt exceeds 128 characters: ${prompt}`);

for (const relative of [manifest.skills, manifest.mcpServers, manifest.interface?.composerIcon, manifest.interface?.logo, manifest.interface?.logoDark]) {
  if (relative && !fs.existsSync(path.resolve(plugin, relative))) errors.push(`referenced plugin path does not exist: ${relative}`);
}
if (manifest.repository !== "https://github.com/Lindforge-Studios/towerforge-codex-plugin") errors.push("plugin repository must point to the public distribution mirror");
for (const relative of ["README.md", "SECURITY.md", "CONTRIBUTING.md", ".github/workflows/verify.yml", ".github/workflows/sync.yml", "scripts/verify-release.mjs"]) {
  if (!fs.existsSync(path.join(distributionPath, relative))) errors.push(`distribution template is missing: ${relative}`);
}
if (fs.existsSync(mirrorSyncPath)) {
  const mirrorSync = fs.readFileSync(mirrorSyncPath, "utf8");
  if (/secrets\.|deploy.?key|personal.?access.?token|\bPAT\b/i.test(mirrorSync)) errors.push("mirror sync must not use stored credentials");
  if (!/permissions:\s*\n\s*contents:\s*write/.test(mirrorSync)) errors.push("mirror sync must request only repository contents write access");
  if (!mirrorSync.includes("https://github.com/Lindforge-Studios/TowerForge.git")) errors.push("mirror sync must read the canonical public source");
}
if (!fs.existsSync(path.join(plugin, "runtime", "packages", "mcp", "server.mjs"))) errors.push("bundled MCP runtime is missing; run npm run plugin:build");
if (!fs.existsSync(path.join(plugin, "runtime", "packages", "engine", "dist", "index.js"))) errors.push("bundled engine runtime is missing");
for (const relative of [
  "node_modules/@nodable/entities/package.json",
  "node_modules/anynum/package.json",
  "node_modules/fast-xml-builder/package.json",
  "node_modules/fast-xml-parser/package.json",
  "node_modules/is-unsafe/package.json",
  "node_modules/path-expression-matcher/package.json",
  "node_modules/pngjs/package.json",
  "node_modules/strnum/package.json",
  "node_modules/xml-naming/package.json"
]) {
  if (!fs.existsSync(path.join(plugin, "runtime", relative))) errors.push(`bundled production dependency is missing: ${relative}`);
}

const entry = marketplace.plugins?.find((candidate) => candidate.name === manifest.name);
if (!entry) errors.push("marketplace does not contain the plugin");
if (entry?.source?.source !== "local" || entry?.source?.path !== "./plugins/towerforge") errors.push("marketplace source must target ./plugins/towerforge");
if (!entry?.policy?.installation || !entry?.policy?.authentication) errors.push("marketplace policy is incomplete");

if (errors.length) {
  process.stderr.write(`Codex plugin validation failed:\n- ${errors.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write(`Codex plugin ${manifest.name}@${manifest.version} is valid.\n`);
