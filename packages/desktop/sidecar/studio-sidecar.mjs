#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveDesktopProject } from "./project-state.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(process.env["TOWERFORGE_RUNTIME_ROOT"] || path.join(__dirname, "../../.."));
const userDataDir = process.env["TOWERFORGE_USER_DATA_DIR"];

function parseProjectArg(argv) {
  const pFlag = argv.indexOf("--project");
  if (pFlag !== -1 && argv[pFlag + 1]) return argv[pFlag + 1];
  for (const arg of argv) {
    if (!arg.startsWith("--")) return arg;
  }
  return null;
}

const explicitProjectDir = parseProjectArg(process.argv.slice(2));
const projectDir = resolveDesktopProject({ explicitProjectDir, runtimeRoot, userDataDir });
const serverScript = path.join(runtimeRoot, "packages", "studio", "server.mjs");

const child = spawn(process.execPath, [serverScript, "--project", projectDir], {
  cwd: runtimeRoot,
  env: {
    ...process.env,
    PROJECT_DIR: projectDir,
    PORT: process.env["PORT"] || "0",
    TOWERFORGE_DESKTOP: "1",
    TOWERFORGE_RUNTIME_ROOT: runtimeRoot,
    TOWERFORGE_USER_DATA_DIR: userDataDir
  },
  stdio: ["ignore", "pipe", "pipe"]
});

child.stdout.on("data", (chunk) => process.stdout.write(chunk));
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

function stop() {
  child.kill("SIGTERM");
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);
