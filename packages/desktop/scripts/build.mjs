#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

function defaultBundles() {
  if (process.platform === "darwin") return "dmg";
  if (process.platform === "win32") return "nsis,msi";
  if (process.platform === "linux") return "appimage,deb,rpm";
  throw new Error(`Unsupported desktop build platform: ${process.platform}`);
}

const args = process.argv.slice(2);
const hasBundleArg = args.includes("--bundles") || args.includes("-b");
const tauriArgs = ["build", ...args];
if (!hasBundleArg) tauriArgs.push("--bundles", defaultBundles());

const command = process.platform === "win32" ? "tauri.cmd" : "tauri";
const result = spawnSync(command, tauriArgs, { stdio: "inherit", shell: process.platform === "win32" });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
