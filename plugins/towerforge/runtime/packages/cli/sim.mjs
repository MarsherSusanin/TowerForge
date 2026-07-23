// sim.mjs — Headless mission smoke-run for a .tdproj project.
// Usage: node sim.mjs <missionId> [duration] [--project <path>]
//        PROJECT_DIR=<path> node sim.mjs <missionId>
import process from "node:process";
import { resolveProjectDir, runMissionSmoke } from "./lib/project-loader.mjs";
import { parseJsonFlag, printJson } from "./lib/trace.mjs";

function parseArgs() {
  const raw = process.argv.slice(2);
  const result = { missionId: null, duration: 180, projectDir: null, json: parseJsonFlag(raw) };
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "--project" && raw[i + 1]) {
      result.projectDir = raw[i + 1];
      i += 2;
    } else if (raw[i] === "--json") {
      i += 1;
    } else if (!raw[i].startsWith("--")) {
      if (!result.missionId) result.missionId = raw[i];
      else {
        const parsed = Number(raw[i]);
        if (Number.isFinite(parsed) && parsed > 0) result.duration = parsed;
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  return result;
}

const args = parseArgs();
const PROJECT_DIR = resolveProjectDir(args.projectDir, []);

try {
  const result = await runMissionSmoke(PROJECT_DIR, args.missionId, args.duration);
  if (args.json) {
    printJson({ ...result, projectDir: PROJECT_DIR });
    process.exit(0);
  }

  console.log(`\nMission: ${result.label ?? result.missionId} (${result.missionId})`);
  console.log(`  Map:             ${result.mapId} (${result.mapSize}, path ${result.pathLength})`);
  console.log(`  Wave set:        ${result.waveSetId}`);
  console.log(`  Duration:        ${result.elapsed}/${result.duration} time units`);
  console.log(`  Outcome:         ${result.outcome}`);
  console.log(`  Core HP:         ${result.coreHp}`);
  console.log(`  Waves started:   ${result.startedWaveCount}/${result.totalWaves}`);
  console.log(`  Towers built:    ${result.towersBuilt}`);
  console.log(`  Active enemies:  ${result.activeEnemies}`);
  console.log(`  Coins:           ${result.coins}`);
  console.log(`  Towers:          ${(result.availableTowers ?? []).join(", ") || "(none)"}`);

  if (!result.startResult.ok) {
    console.log(`  Start wave:      failed — ${result.startResult.reason ?? "unknown reason"}`);
  }

  if (result.placements.length > 0) {
    console.log("\n  Auto placements:");
    for (const placement of result.placements) {
      console.log(`    ${placement.towerTypeId} at ${placement.coord.q},${placement.coord.r}`);
    }
  }

  if (Object.keys(result.eventCounts).length > 0) {
    console.log("\n  Event counts:");
    for (const [eventType, count] of Object.entries(result.eventCounts).sort()) {
      console.log(`    ${eventType.padEnd(24)} ${count}`);
    }
  }

  if (result.waveStats.length > 0) {
    console.log("\n  Wave pressure:");
    for (const wave of result.waveStats) {
      console.log(`    ${wave.label ?? wave.id}: ${wave.count} enemies, ${wave.totalHp} HP, ${wave.totalThreat} threat`);
    }
  }
  console.log();
} catch (error) {
  if (args.json) printJson({ ok: false, projectDir: PROJECT_DIR, error: error.message });
  else console.error(error.message);
  process.exit(1);
}
