#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { TOWERFORGE_AGENT_GUIDE_VERSION } from "../packages/mcp/agent-instructions.mjs";
import { TOWERFORGE_MCP_PROTOCOL_VERSION, TOWERFORGE_MCP_SERVER_VERSION } from "../packages/mcp/protocol.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginSource = path.join(root, "plugins", "towerforge");
const distributionSource = path.join(root, "distribution", "codex-plugin");
const marketplaceSource = path.join(root, ".agents", "plugins", "marketplace.json");

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function listFiles(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing to export symlink: ${path.relative(root, absolute)}`);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  walk(directory);
  return files.sort((a, b) => a.localeCompare(b));
}

function copyTree(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (candidate) => {
      if (fs.lstatSync(candidate).isSymbolicLink()) throw new Error(`Refusing to export symlink: ${path.relative(root, candidate)}`);
      return true;
    }
  });
}

function replaceTokens(file, values) {
  let content = fs.readFileSync(file, "utf8");
  for (const [token, value] of Object.entries(values)) content = content.split(`{{${token}}}`).join(value);
  if (/\{\{[A-Z0-9_]+\}\}/.test(content)) throw new Error(`Unresolved distribution token in ${path.relative(root, file)}.`);
  fs.writeFileSync(file, content, "utf8");
}

function assertSafeOutput(outputDirectory) {
  const relative = path.relative(root, outputDirectory);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) {
    throw new Error("Plugin repository export must be outside the TowerForge source tree.");
  }
  const reverse = path.relative(outputDirectory, root);
  if (reverse === "" || (!reverse.startsWith(`..${path.sep}`) && reverse !== "..")) {
    throw new Error("Plugin repository export cannot contain the TowerForge source tree.");
  }
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

function assertCleanSource() {
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" }).trim();
  if (status) throw new Error("Refusing to export from a dirty TowerForge worktree. Commit the exact source first.");
}

export function exportPluginRepository(options) {
  const outputDirectory = path.resolve(options.outputDirectory);
  const sourceCommit = options.sourceCommit ?? currentCommit();
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("sourceCommit must be a full lowercase Git SHA.");
  if (options.checkClean !== false) assertCleanSource();
  assertSafeOutput(outputDirectory);

  const pluginManifest = JSON.parse(fs.readFileSync(path.join(pluginSource, ".codex-plugin", "plugin.json"), "utf8"));
  const rootPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (pluginManifest.version !== TOWERFORGE_MCP_SERVER_VERSION) {
    throw new Error(`Plugin ${pluginManifest.version} and MCP server ${TOWERFORGE_MCP_SERVER_VERSION} versions differ.`);
  }

  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  copyTree(distributionSource, outputDirectory);
  copyTree(pluginSource, path.join(outputDirectory, "plugins", "towerforge"));
  fs.mkdirSync(path.join(outputDirectory, ".agents", "plugins"), { recursive: true });
  fs.copyFileSync(marketplaceSource, path.join(outputDirectory, ".agents", "plugins", "marketplace.json"));
  fs.copyFileSync(path.join(root, "LICENSE"), path.join(outputDirectory, "LICENSE"));

  replaceTokens(path.join(outputDirectory, "README.md"), {
    PLUGIN_VERSION: pluginManifest.version,
    SOURCE_COMMIT: sourceCommit
  });

  const files = listFiles(outputDirectory).map((absolute) => ({
    path: path.relative(outputDirectory, absolute).split(path.sep).join("/"),
    size: fs.statSync(absolute).size,
    sha256: sha256(absolute)
  }));
  const manifest = {
    schemaVersion: 1,
    pluginVersion: pluginManifest.version,
    towerforgeVersion: rootPackage.version,
    mcpServerVersion: TOWERFORGE_MCP_SERVER_VERSION,
    mcpProtocolVersion: TOWERFORGE_MCP_PROTOCOL_VERSION,
    agentGuideVersion: TOWERFORGE_AGENT_GUIDE_VERSION,
    sourceRepository: "https://github.com/Lindforge-Studios/TowerForge",
    sourceCommit,
    sourceTree: `https://github.com/Lindforge-Studios/TowerForge/tree/${sourceCommit}`,
    runtimeRequirements: { node: ">=22", installsDependenciesAtRuntime: false },
    files
  };
  fs.writeFileSync(path.join(outputDirectory, "build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { outputDirectory, manifest };
}

function parseArgs(args) {
  const outIndex = args.indexOf("--out");
  if (outIndex === -1 || !args[outIndex + 1]) throw new Error("Usage: npm run plugin:export -- --out /absolute/output/directory");
  return { outputDirectory: args[outIndex + 1] };
}

const invoked = process.argv[1]
  && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) {
  const result = exportPluginRepository(parseArgs(process.argv.slice(2)));
  process.stdout.write(`Exported TowerForge Codex plugin ${result.manifest.pluginVersion} (${result.manifest.files.length} files) from ${result.manifest.sourceCommit}.\n`);
}
