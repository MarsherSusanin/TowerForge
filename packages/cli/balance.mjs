// balance.mjs — Simulation-driven balance report for a .tdproj project.
// Usage: node balance.mjs [--project <path>] [--mission <id>]... [--seconds <n>] [--json]
import process from "node:process";
import { resolveProjectDir, runBalanceSweepForProject } from "./lib/project-loader.mjs";
import { parseJsonFlag, printJson } from "./lib/trace.mjs";

function parseArgs() {
  const raw = process.argv.slice(2);
  const result = { projectDir: null, missionIds: [], simSeconds: undefined, json: parseJsonFlag(raw) };
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === "--project" && raw[i + 1]) { result.projectDir = raw[i + 1]; i += 1; }
    else if (raw[i] === "--mission" && raw[i + 1]) { result.missionIds.push(raw[i + 1]); i += 1; }
    else if (raw[i] === "--seconds" && raw[i + 1]) { result.simSeconds = Number(raw[i + 1]); i += 1; }
    else if (!result.projectDir && !raw[i].startsWith("--")) { result.projectDir = raw[i]; } // bare positional project path
  }
  return result;
}

const args = parseArgs();
const PROJECT_DIR = resolveProjectDir(args.projectDir, []);

try {
  const report = await runBalanceSweepForProject(PROJECT_DIR, {
    missionIds: args.missionIds,
    simSeconds: Number.isFinite(args.simSeconds) ? args.simSeconds : undefined
  });

  if (args.json) {
    printJson({ ok: true, projectDir: PROJECT_DIR, ...report });
    process.exit(0);
  }

  console.log(`\n  Balance report — ${report.summary.missions} mission(s), ${report.summary.winnable} winnable, ${report.summary.flagged} flagged.\n`);
  for (const mission of report.missions) {
    const pct = Math.round(mission.winRate * 100);
    const bar = "█".repeat(Math.round(mission.winRate * 20)).padEnd(20, "·");
    console.log(`  ${mission.label} (${mission.missionId})`);
    console.log(`    win-rate   ${bar} ${pct}%  (${mission.strategyCount} strategies)`);
    console.log(`    core left  ${Math.round(mission.avgCoreHpRemaining * 100)}% avg${mission.avgClearTime != null ? `   clear ~${mission.avgClearTime}u` : ""}`);
    if (mission.soloWinners.length) console.log(`    solo wins  ${mission.soloWinners.join(", ")}`);
    for (const flag of mission.flags) {
      const mark = flag.severity === "error" ? "✗" : flag.severity === "warning" ? "!" : "·";
      console.log(`    ${mark} [${flag.code}] ${flag.message}`);
      if (flag.suggestion) console.log(`        → ${flag.suggestion}`);
    }
    console.log();
  }
} catch (error) {
  if (args.json) printJson({ ok: false, projectDir: PROJECT_DIR, error: error.message });
  else console.error(`  ✗ ${error.message}`);
  process.exit(1);
}
