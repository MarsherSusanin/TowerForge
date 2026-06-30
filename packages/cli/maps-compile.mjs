// maps-compile.mjs — Compile maps/src/*.tmj into maps/compiled/maps.json.
import process from "node:process";
import { compileMapSources, readMapSources, writeCompiledMaps } from "./lib/map-compiler.mjs";
import { resolveProjectDir } from "./lib/project-loader.mjs";
import { parseJsonFlag, printJson } from "./lib/trace.mjs";

function parseArgs() {
  const raw = process.argv.slice(2);
  const result = { projectDir: null, json: parseJsonFlag(raw) };
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === "--project" && raw[i + 1]) {
      result.projectDir = raw[i + 1];
      i += 1;
    }
  }
  return result;
}

const args = parseArgs();
const PROJECT_DIR = resolveProjectDir(args.projectDir, []);

try {
  const sources = readMapSources(PROJECT_DIR);
  const result = compileMapSources(sources);
  if (!result.ok) {
    if (args.json) printJson({ ok: false, projectDir: PROJECT_DIR, issues: result.issues });
    else {
      for (const issue of result.issues) {
        console.error(`  ✗ [${issue.entityKind}:${issue.entityId}] ${issue.fieldPath} — ${issue.message}`);
      }
    }
    process.exit(1);
  }
  const outFile = writeCompiledMaps(PROJECT_DIR, result.maps);
  const summary = { ok: true, projectDir: PROJECT_DIR, outFile, mapCount: Object.keys(result.maps).length, issues: result.issues };
  if (args.json) printJson(summary);
  else console.log(`  ✓ Compiled ${summary.mapCount} map source(s) to ${outFile}`);
} catch (error) {
  if (args.json) printJson({ ok: false, projectDir: PROJECT_DIR, error: error.message });
  else console.error(`  ✗ ${error.message}`);
  process.exit(1);
}
