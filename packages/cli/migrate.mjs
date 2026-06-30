// migrate.mjs — Inspect or write .tdproj schema migrations.
import process from "node:process";
import { loadProjectFiles, resolveProjectDir } from "./lib/project-loader.mjs";
import { writeMigratedProjectFiles } from "./lib/project-migrations.mjs";
import { parseJsonFlag, printJson } from "./lib/trace.mjs";

function parseArgs() {
  const raw = process.argv.slice(2);
  const result = { projectDir: null, write: false, json: parseJsonFlag(raw) };
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === "--project" && raw[i + 1]) {
      result.projectDir = raw[i + 1];
      i += 1;
    } else if (raw[i] === "--write") {
      result.write = true;
    }
  }
  return result;
}

const args = parseArgs();
const PROJECT_DIR = resolveProjectDir(args.projectDir, []);

try {
  const files = loadProjectFiles(PROJECT_DIR);
  if (args.write && files.appliedMigrations.length > 0) {
    writeMigratedProjectFiles(PROJECT_DIR, files);
  }
  const result = {
    ok: true,
    projectDir: PROJECT_DIR,
    write: args.write,
    migrationCount: files.appliedMigrations.length,
    migrations: files.appliedMigrations
  };
  if (args.json) printJson(result);
  else if (files.appliedMigrations.length === 0) {
    console.log("  ✓ Project schema is current.");
  } else {
    console.log(`  ${args.write ? "✓ Applied" : "!"} ${files.appliedMigrations.length} migration(s).`);
    for (const migration of files.appliedMigrations) {
      console.log(`    ${migration.id}: ${migration.description}`);
    }
    if (!args.write) console.log("  Run again with --write to persist migrated files.");
  }
} catch (error) {
  if (args.json) printJson({ ok: false, projectDir: PROJECT_DIR, error: error.message });
  else console.error(`  ✗ ${error.message}`);
  process.exit(1);
}
