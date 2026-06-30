// tools.mjs — Constructor tool registry shared by the MCP server.
//
// Each tool wraps an existing CLI library function so any MCP-capable AI agent gets the same
// capabilities as the Mycelium CLI and Studio. Kept transport-agnostic (no stdio here) so the
// registry and dispatcher can be unit-tested directly.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  loadProjectFiles,
  projectSummary,
  repoRoot,
  runBalanceSweepForProject,
  runMissionSmoke,
  validateProjectDir
} from "../cli/lib/project-loader.mjs";
import { compileMapSources, readMapSources, writeCompiledMaps } from "../cli/lib/map-compiler.mjs";

const BALANCE_PATCH_KEYS = ["enemies", "towers", "waveSets", "missions", "abilities", "constants", "defaultMissionId"];

/** Tool definitions advertised over `tools/list`. */
export const TOOLS = [
  {
    name: "get_project_summary",
    description:
      "Load and summarize a .tdproj project: manifest, constants, counts of missions/enemies/towers/maps, and applied schema migrations.",
    inputSchema: {
      type: "object",
      properties: { projectDir: { type: "string", description: "Path to the .tdproj directory. Defaults to the server's project." } }
    }
  },
  {
    name: "list_missions",
    description: "List the missions defined in the project with their map, wave set, available towers, and availability.",
    inputSchema: {
      type: "object",
      properties: { projectDir: { type: "string", description: "Path to the .tdproj directory." } }
    }
  },
  {
    name: "validate_project",
    description:
      "Run the full project validation (schema-level checks plus engine cross-reference and numeric guards). Returns the list of errors and warnings.",
    inputSchema: {
      type: "object",
      properties: { projectDir: { type: "string", description: "Path to the .tdproj directory." } }
    }
  },
  {
    name: "simulate_mission",
    description:
      "Run a deterministic headless smoke simulation of a mission (auto-places towers, starts waves) and return the outcome and event/wave statistics.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        missionId: { type: "string", description: "Mission id to simulate. Defaults to the project's defaultMissionId." },
        duration: { type: "number", description: "Simulation duration in time units (default 180)." }
      }
    }
  },
  {
    name: "compile_maps",
    description: "Compile maps/src/*.tmj sources into maps/compiled/maps.json and return the compiled map ids and any issues.",
    inputSchema: {
      type: "object",
      properties: { projectDir: { type: "string", description: "Path to the .tdproj directory." } }
    }
  },
  {
    name: "build_project",
    description: "Validate the project and build a deployable static web bundle. Returns the output directory and asset copy report.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        targetId: { type: "string", description: "Build target id from build-targets.json. Defaults to the canonical web target." }
      }
    }
  },
  {
    name: "balance_report",
    description:
      "Run a deterministic multi-strategy simulation sweep and return a balance report per mission (win-rate, surviving core HP, tower usage, and advisor flags like unwinnable / trivial / dominant-tower). Use this to diagnose balance before applying patches.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        missionId: { type: "string", description: "Restrict the sweep to a single mission. Omit to sweep all missions." },
        simSeconds: { type: "number", description: "Max simulated time-units per run (default 600)." }
      }
    }
  },
  {
    name: "apply_balance_patch",
    description:
      "Merge top-level balance sections (enemies, towers, waveSets, missions, abilities, constants, defaultMissionId) into content/balance.json. Backs up the previous file, then re-validates and returns the result.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        patch: {
          type: "object",
          description: "Object whose recognized top-level keys replace the matching sections of balance.json.",
          properties: {
            enemies: { type: "object" },
            towers: { type: "object" },
            waveSets: { type: "object" },
            missions: { type: "object" },
            abilities: { type: "object" },
            constants: { type: "object" },
            defaultMissionId: { type: "string" }
          }
        }
      },
      required: ["patch"]
    }
  }
];

const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));

/**
 * Dispatch a tool call. Returns a plain serializable object (the MCP layer wraps it as text content).
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {{ defaultProjectDir: string }} ctx
 */
export async function callTool(name, args = {}, ctx = {}) {
  if (!TOOL_NAMES.has(name)) {
    throw new Error(`Unknown tool: ${name}`);
  }
  const projectDir = resolveDir(args.projectDir, ctx.defaultProjectDir);

  switch (name) {
    case "get_project_summary": {
      const files = loadProjectFiles(projectDir);
      const summary = projectSummary(files);
      return {
        projectDir,
        manifest: summary.manifest,
        constants: summary.constants,
        defaultMissionId: summary.defaultMissionId,
        appliedMigrations: summary.appliedMigrations,
        counts: {
          missions: Object.keys(summary.missions ?? {}).length,
          enemies: Object.keys(summary.enemies ?? {}).length,
          towers: Object.keys(summary.towers ?? {}).length,
          waveSets: Object.keys(summary.waveSets ?? {}).length,
          maps: Object.keys(summary.maps ?? {}).length,
          mapSources: Object.keys(summary.mapSources ?? {}).length
        },
        availableMaps: summary.availableMaps,
        mapRoutes: summary.mapRoutes
      };
    }

    case "list_missions": {
      const files = loadProjectFiles(projectDir);
      const missions = files.balance.missions ?? {};
      return {
        projectDir,
        missions: Object.values(missions).map((mission) => ({
          id: mission.id,
          label: mission.label,
          availability: mission.availability ?? "playable",
          mapId: mission.mapId,
          waveSetId: mission.waveSetId,
          buildTowerIds: mission.buildTowerIds ?? [],
          abilityIds: mission.abilityIds ?? []
        }))
      };
    }

    case "validate_project": {
      const { result } = await validateProjectDir(projectDir);
      return {
        projectDir,
        ok: result.ok,
        errorCount: result.issues.filter((issue) => issue.severity === "error").length,
        warningCount: result.issues.filter((issue) => issue.severity === "warning").length,
        issues: result.issues
      };
    }

    case "simulate_mission": {
      const duration = Number.isFinite(args.duration) && args.duration > 0 ? args.duration : 180;
      return runMissionSmoke(projectDir, args.missionId, duration);
    }

    case "compile_maps": {
      const sources = readMapSources(projectDir);
      const result = compileMapSources(sources);
      if (!result.ok) {
        return { projectDir, ok: false, issues: result.issues };
      }
      const outFile = writeCompiledMaps(projectDir, result.maps);
      return { projectDir, ok: true, outFile, mapIds: Object.keys(result.maps), issues: result.issues };
    }

    case "balance_report": {
      const report = await runBalanceSweepForProject(projectDir, {
        missionIds: typeof args.missionId === "string" ? [args.missionId] : [],
        simSeconds: Number.isFinite(args.simSeconds) ? args.simSeconds : undefined
      });
      return { projectDir, ...report };
    }

    case "build_project":
      return runBuild(projectDir, typeof args.targetId === "string" ? args.targetId : null);

    case "apply_balance_patch":
      return applyBalancePatch(projectDir, args.patch);

    default:
      throw new Error(`Unhandled tool: ${name}`);
  }
}

function resolveDir(explicit, fallback) {
  if (typeof explicit === "string" && explicit.trim()) return path.resolve(explicit);
  if (typeof fallback === "string" && fallback.trim()) return fallback;
  throw new Error("No project directory provided and no default configured for this MCP server.");
}

const BUILD_TIMEOUT_MS = 180_000;

function runBuild(projectDir, targetId) {
  return new Promise((resolve) => {
    const buildArgs = [path.join(repoRoot, "packages", "cli", "build.mjs"), "--project", projectDir, "--json"];
    if (targetId) buildArgs.push("--target", targetId);
    // A timeout guards against a hung child (e.g. a stalled tsc) leaving the promise — and thus the
    // MCP server's graceful shutdown — pending forever.
    const child = spawn(process.execPath, buildArgs, { cwd: repoRoot, timeout: BUILD_TIMEOUT_MS, killSignal: "SIGKILL" });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => done({ ok: false, projectDir, error: error.message }));
    child.on("close", (code, signal) => {
      if (signal) {
        done({ ok: false, projectDir, error: `Build process terminated (${signal}) after ${BUILD_TIMEOUT_MS}ms.`, output: stdout.trim() || undefined });
        return;
      }
      try {
        done(JSON.parse(stdout));
      } catch {
        done({ ok: code === 0, projectDir, output: stdout.trim(), error: stderr.trim() || undefined });
      }
    });
  });
}

async function applyBalancePatch(projectDir, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("apply_balance_patch requires a `patch` object.");
  }
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = fs.existsSync(balancePath) ? JSON.parse(fs.readFileSync(balancePath, "utf8")) : {};
  const applied = [];
  for (const key of BALANCE_PATCH_KEYS) {
    if (patch[key] !== undefined) {
      balance[key] = patch[key];
      applied.push(key);
    }
  }
  if (applied.length === 0) {
    throw new Error(`Patch contained no recognized balance keys. Allowed: ${BALANCE_PATCH_KEYS.join(", ")}.`);
  }

  backupFile(projectDir, balancePath);
  writeJsonAtomic(balancePath, balance);

  const { result } = await validateProjectDir(projectDir);
  return {
    projectDir,
    ok: true,
    applied,
    validation: {
      ok: result.ok,
      errorCount: result.issues.filter((issue) => issue.severity === "error").length,
      warningCount: result.issues.filter((issue) => issue.severity === "warning").length,
      issues: result.issues
    }
  };
}

function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp.${process.pid}.${createHash("sha1").update(filePath).digest("hex").slice(0, 6)}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

function backupFile(projectDir, filePath) {
  if (!fs.existsSync(filePath)) return;
  const backupDir = path.join(projectDir, ".mycelium", "mcp-backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(filePath, path.join(backupDir, `${path.basename(filePath)}.${stamp}.bak`));
}
