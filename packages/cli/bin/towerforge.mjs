#!/usr/bin/env node
// towerforge — TowerForge CLI for .tdproj projects.
//
// Commands:
//   towerforge validate [--project <path>]
//   towerforge sim <missionId> [duration] [--project <path>]
//   towerforge build [--project <path>] [--target <targetId>]
//   towerforge maps:compile [--project <path>]
//   towerforge migrate [--project <path>] [--write]
//   towerforge studio [--project <path>] [--port <port>]
//   towerforge create <name> [--dir <path>]
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliDir = path.resolve(__dirname, "..");
// cliDir is packages/cli, so its siblings (studio, mcp) are one level up, not two.
const studioScript = path.resolve(cliDir, "../studio/server.mjs");
const mcpScript = path.resolve(cliDir, "../mcp/server.mjs");

const COMMANDS = ["validate", "sim", "balance", "build", "package", "maps:compile", "migrate", "studio", "create", "mcp"];

const [, , cmd, ...rest] = process.argv;

function usage() {
  console.log(`
TowerForge CLI — tools for .tdproj projects.

Usage:
  towerforge <command> [options]

Commands:
  validate              Validate project content files.
  sim <missionId>       Run a headless mission smoke simulation.
  balance               Simulation-driven balance report (win-rate, advisor flags).
  build                 Build a playable static web bundle.
  package               Wrap the web build into a native app (--kind mobile|desktop).
  maps:compile          Compile maps/src/*.tmj into maps/compiled/maps.json.
  migrate               Inspect or write .tdproj schema migrations.
  studio                Launch the visual studio editor.
  create <name>         Scaffold a new .tdproj project.
  mcp                   Start the MCP server exposing constructor tools to AI agents.

Options (apply to validate, sim, studio):
  --project <path>      Path to the .tdproj directory.
                        Also reads PROJECT_DIR env var.
                        Defaults to examples/starter.tdproj.

Options for studio:
  --port <port>         HTTP port (default 5174, or PORT env var).

Options for create:
  --dir <path>          Parent directory (default: current directory).

Options for sim:
  [duration]            Simulation duration in time units (default 120).

Options for build:
  --target <targetId>   Build target ID from build-targets.json.
  --out <dir>           Output directory inside the project.

Options for migrate:
  --write               Persist migrated files and create .towerforge backups.

Examples:
  towerforge validate --project ./my-game.tdproj
  towerforge sim meadow_01 --project ./my-game.tdproj
  towerforge build --project ./my-game.tdproj --target web-pwa
  towerforge maps:compile --project ./my-game.tdproj
  towerforge migrate --project ./my-game.tdproj --write
  towerforge studio --project ./my-game.tdproj --port 3000
  towerforge create my-game --dir ~/Projects
`.trim());
}

if (!cmd || cmd === "--help" || cmd === "-h") {
  usage();
  process.exit(0);
}

if (!COMMANDS.includes(cmd)) {
  console.error(`Unknown command: "${cmd}"`);
  console.error(`Available commands: ${COMMANDS.join(", ")}`);
  console.error(`Run "towerforge --help" for usage.`);
  process.exit(1);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

function runScript(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

if (cmd === "validate") {
  runScript(path.join(cliDir, "validate.mjs"), rest);
}

if (cmd === "sim") {
  if (rest.length === 0 || rest[0] === "--project") {
    // No mission ID provided — pass through and let sim.mjs handle the error
  }
  runScript(path.join(cliDir, "sim.mjs"), rest);
}

if (cmd === "balance") {
  runScript(path.join(cliDir, "balance.mjs"), rest);
}

if (cmd === "build") {
  runScript(path.join(cliDir, "build.mjs"), rest);
}

if (cmd === "package") {
  runScript(path.join(cliDir, "package.mjs"), rest);
}

if (cmd === "maps:compile") {
  runScript(path.join(cliDir, "maps-compile.mjs"), rest);
}

if (cmd === "migrate") {
  runScript(path.join(cliDir, "migrate.mjs"), rest);
}

if (cmd === "studio") {
  // Parse optional --port from rest, pass remaining args through
  const studioArgs = [];
  let i = 0;
  while (i < rest.length) {
    if (rest[i] === "--port" && rest[i + 1]) {
      process.env["PORT"] = rest[i + 1];
      i += 2;
    } else {
      studioArgs.push(rest[i]);
      i++;
    }
  }
  runScript(studioScript, studioArgs);
}

if (cmd === "create") {
  runScript(path.join(cliDir, "create.mjs"), rest);
}

if (cmd === "mcp") {
  runScript(mcpScript, rest);
}
