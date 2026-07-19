#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const tauriRoot = path.join(desktopRoot, "src-tauri");
const runtimeRoot = path.join(tauriRoot, "runtime");
const binariesDir = path.join(tauriRoot, "binaries");

function runBuildEngine() {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "packages/engine/tsconfig.build.json"], {
    cwd: repoRoot,
    stdio: "inherit"
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function copyDir(src, dest, filter = () => true) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
    filter: (entry) => {
      const rel = path.relative(src, entry);
      return filter(rel, entry);
    }
  });
}

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function runtimeFilter(rel) {
  const parts = rel.split(path.sep);
  const base = parts[parts.length - 1];
  return (
    base !== ".DS_Store" &&
    base !== ".claude" &&
    !base.endsWith(".test.mjs") &&
    !base.endsWith(".test.js") &&
    !base.endsWith(".test.ts") &&
    base !== "node_modules" &&
    base !== "target" &&
    base !== ".towerforge" &&
    base !== "dist" &&
    base !== "mobile" &&
    base !== "desktop"
  );
}

function currentTargetTriple() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "darwin" && arch === "arm64") return "aarch64-apple-darwin";
  if (platform === "darwin" && arch === "x64") return "x86_64-apple-darwin";
  if (platform === "win32" && arch === "x64") return "x86_64-pc-windows-msvc";
  if (platform === "win32" && arch === "arm64") return "aarch64-pc-windows-msvc";
  if (platform === "linux" && arch === "x64") return "x86_64-unknown-linux-gnu";
  if (platform === "linux" && arch === "arm64") return "aarch64-unknown-linux-gnu";
  throw new Error(`Unsupported desktop sidecar target: ${platform}/${arch}`);
}

function canUseCurrentNodeFor(targetTriple) {
  const current = currentTargetTriple();
  if (targetTriple === current) return true;
  if (process.platform !== "darwin") return false;
  const result = spawnSync("file", [process.execPath], { encoding: "utf8" });
  return result.status === 0 && result.stdout.includes("universal binary");
}

function targetTriples() {
  const targets = new Set([currentTargetTriple()]);
  if (process.env["TAURI_ENV_TARGET_TRIPLE"]) targets.add(process.env["TAURI_ENV_TARGET_TRIPLE"]);
  if (process.env["CARGO_BUILD_TARGET"]) targets.add(process.env["CARGO_BUILD_TARGET"]);
  return [...targets];
}

function targetPlatform(triple) {
  if (triple.includes("apple-darwin")) return { os: "darwin", cpu: triple.startsWith("aarch64") ? "arm64" : "x64" };
  if (triple.includes("windows-msvc")) return { os: "win32", cpu: triple.startsWith("aarch64") ? "arm64" : "x64" };
  if (triple.includes("linux")) return { os: "linux", cpu: triple.startsWith("aarch64") ? "arm64" : "x64" };
  throw new Error(`Unsupported target triple: ${triple}`);
}

function packageMatchesTargets(meta, targets) {
  const osList = Array.isArray(meta.os) ? meta.os : null;
  const cpuList = Array.isArray(meta.cpu) ? meta.cpu : null;
  return targets.some((target) => {
    const osAllowed = !osList || osList.includes(target.os);
    const cpuAllowed = !cpuList || cpuList.includes(target.cpu);
    return osAllowed && cpuAllowed;
  });
}

function copyRuntimeDependencies() {
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));
  const targets = targetTriples().map(targetPlatform);
  let copied = 0;
  for (const [packagePath, meta] of Object.entries(lock.packages || {})) {
    if (!packagePath.startsWith("node_modules/") || meta.dev || meta.link) continue;
    if (packagePath.startsWith("node_modules/@towerforge/")) continue;
    if (!packageMatchesTargets(meta, targets)) continue;
    const source = path.join(repoRoot, packagePath);
    if (!fs.existsSync(source)) continue;
    copyDir(source, path.join(runtimeRoot, packagePath), (rel) => path.basename(rel) !== ".DS_Store");
    copied += 1;
  }
  return copied;
}

function copyNodeSidecar() {
  fs.mkdirSync(binariesDir, { recursive: true });
  const ext = process.platform === "win32" ? ".exe" : "";
  const copied = [];
  for (const target of targetTriples()) {
    if (!canUseCurrentNodeFor(target)) {
      throw new Error(`Current Node binary (${process.platform}/${process.arch}) cannot be used as a ${target} sidecar. Build with a matching Node/Rust target or provide a universal Node binary.`);
    }
    const dest = path.join(binariesDir, `node-${target}${ext}`);
    fs.copyFileSync(process.execPath, dest);
    fs.chmodSync(dest, 0o755);
    copied.push(dest);
  }
  return copied;
}

runBuildEngine();
cleanDir(runtimeRoot);
fs.copyFileSync(path.join(repoRoot, "package.json"), path.join(runtimeRoot, "package.json"));
copyDir(path.join(repoRoot, "packages", "studio"), path.join(runtimeRoot, "packages", "studio"), runtimeFilter);
copyDir(path.join(repoRoot, "packages", "desktop", "sidecar"), path.join(runtimeRoot, "packages", "desktop", "sidecar"), runtimeFilter);
copyDir(path.join(repoRoot, "packages", "cli"), path.join(runtimeRoot, "packages", "cli"), runtimeFilter);
copyDir(path.join(repoRoot, "packages", "mcp"), path.join(runtimeRoot, "packages", "mcp"), runtimeFilter);
copyDir(path.join(repoRoot, "packages", "renderer"), path.join(runtimeRoot, "packages", "renderer"), runtimeFilter);
copyDir(path.join(repoRoot, "packages", "engine", "dist"), path.join(runtimeRoot, "packages", "engine", "dist"), runtimeFilter);
copyDir(path.join(repoRoot, "examples", "starter.tdproj"), path.join(runtimeRoot, "examples", "starter.tdproj"), runtimeFilter);
const runtimeDependencies = copyRuntimeDependencies();

const nodeSidecars = copyNodeSidecar();
console.log(`Prepared TowerForge desktop runtime at ${runtimeRoot}`);
console.log(`Prepared ${runtimeDependencies} production dependency packages for agent runtimes.`);
for (const nodeSidecar of nodeSidecars) console.log(`Prepared Node sidecar at ${nodeSidecar}`);
