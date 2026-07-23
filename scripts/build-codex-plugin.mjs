#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "plugins", "towerforge");
const runtime = path.join(plugin, "runtime");
const rootPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const pluginManifest = JSON.parse(fs.readFileSync(path.join(plugin, ".codex-plugin", "plugin.json"), "utf8"));
if (rootPackage.version !== pluginManifest.version) {
  throw new Error(`Root version ${rootPackage.version} and plugin version ${pluginManifest.version} differ.`);
}

function copy(source, destination, options = {}) {
  if (!fs.existsSync(source)) throw new Error(`Required plugin input is missing: ${path.relative(root, source)}`);
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (candidate) => {
      const relative = path.relative(source, candidate).split(path.sep).join("/");
      if (!relative) return true;
      if (/(^|\/)node_modules(\/|$)/.test(relative)) return false;
      if (/\.test\.mjs$/.test(relative) || /\.test\.js$/.test(relative)) return false;
      if (/(^|\/)(coverage|target)(\/|$)/.test(relative)) return false;
      return options.filter ? options.filter(relative, candidate) : true;
    }
  });
}

if (!fs.existsSync(path.join(root, "packages", "engine", "dist", "index.js"))) {
  throw new Error("Engine dist is missing. Run `npm run build:engine` before `npm run plugin:build`.");
}

fs.rmSync(runtime, { recursive: true, force: true });
fs.mkdirSync(runtime, { recursive: true });

copy(path.join(root, "packages", "mcp"), path.join(runtime, "packages", "mcp"), {
  filter: (relative) => relative !== "package.json"
});
copy(path.join(root, "packages", "cli"), path.join(runtime, "packages", "cli"));
copy(path.join(root, "packages", "engine", "dist"), path.join(runtime, "packages", "engine", "dist"), {
  filter: (relative) => relative !== ".build-stamp"
});
copy(path.join(root, "packages", "renderer", "src"), path.join(runtime, "packages", "renderer", "src"));
copy(path.join(root, "packages", "renderer", "vendor"), path.join(runtime, "packages", "renderer", "vendor"));

const runtimeDependencies = [
  "@nodable/entities",
  "anynum",
  "fast-xml-builder",
  "fast-xml-parser",
  "is-unsafe",
  "path-expression-matcher",
  "pngjs",
  "strnum",
  "xml-naming"
];

for (const dependency of runtimeDependencies) {
  copy(path.join(root, "node_modules", dependency), path.join(runtime, "node_modules", dependency));
}

fs.writeFileSync(path.join(runtime, "package.json"), `${JSON.stringify({
  name: "towerforge-codex-plugin-runtime",
  version: pluginManifest.version,
  private: true,
  type: "module"
}, null, 2)}\n`);

fs.mkdirSync(path.join(plugin, "assets"), { recursive: true });
fs.copyFileSync(path.join(root, "assets", "brand", "towerforge-mark.svg"), path.join(plugin, "assets", "icon.svg"));
fs.copyFileSync(path.join(root, "assets", "brand", "towerforge-app-icon.png"), path.join(plugin, "assets", "logo.png"));
fs.copyFileSync(path.join(root, "assets", "brand", "towerforge-lockup-dark.svg"), path.join(plugin, "assets", "logo-dark.svg"));

process.stdout.write(`Built Codex plugin runtime at ${path.relative(root, runtime)}\n`);
