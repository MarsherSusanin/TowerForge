// validate.mjs — Validate a .tdproj project's content files with @mycelium/engine.
// Usage: node validate.mjs [--project <path>] | PROJECT_DIR=<path> node validate.mjs
import process from "node:process";
import { resolveProjectDir, validateProjectDir } from "./lib/project-loader.mjs";
import { parseJsonFlag, printJson } from "./lib/trace.mjs";

const rawArgs = process.argv.slice(2);
const json = parseJsonFlag(rawArgs);
const PROJECT_DIR = resolveProjectDir(null, rawArgs.filter((arg) => arg !== "--json"));

try {
  const { files, result } = await validateProjectDir(PROJECT_DIR);
  if (json) {
    printJson({
      ok: result.ok,
      projectDir: PROJECT_DIR,
      issueCount: result.issues.length,
      errorCount: result.issues.filter((issue) => issue.severity === "error").length,
      warningCount: result.issues.filter((issue) => issue.severity === "warning").length,
      summary: {
        missions: Object.keys(files.balance.missions).length,
        maps: Object.keys(files.maps).length,
        mapSources: Object.keys(files.mapSources ?? {}).length,
        enemies: Object.keys(files.balance.enemies).length,
        towers: Object.keys(files.balance.towers).length
      },
      issues: result.issues
    });
    process.exit(result.ok ? 0 : 1);
  }

  if (!result.ok) {
    for (const issue of result.issues) {
      const prefix = issue.severity === "error" ? "✗" : "!";
      console.error(`  ${prefix} [${issue.entityKind}:${issue.entityId}] ${issue.fieldPath} — ${issue.message}`);
    }
    process.exit(1);
  }

  const warningCount = result.issues.filter((issue) => issue.severity === "warning").length;
  for (const issue of result.issues) {
    console.warn(`  ! [${issue.entityKind}:${issue.entityId}] ${issue.fieldPath} — ${issue.message}`);
  }
  console.log(
    `  ✓ All checks passed — ${Object.keys(files.balance.missions).length} mission(s), ` +
    `${Object.keys(files.maps).length} map(s), ${Object.keys(files.balance.enemies).length} enem(ies), ` +
    `${Object.keys(files.balance.towers).length} tower(s)${warningCount ? `, ${warningCount} warning(s)` : ""}.`
  );
} catch (error) {
  if (json) printJson({ ok: false, error: error.message });
  else console.error(`  ✗ ${error.message}`);
  process.exit(1);
}
