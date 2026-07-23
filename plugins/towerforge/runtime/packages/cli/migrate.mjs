// migrate.mjs — Inspect or write .tdproj schema migrations.
import process from "node:process";
import { readRawProjectFiles, resolveProjectDir } from "./lib/project-loader.mjs";
import { migrateProjectFiles, writeMigratedProjectFiles } from "./lib/project-migrations.mjs";
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
    } else if (!result.projectDir && !raw[i].startsWith("--")) {
      result.projectDir = raw[i]; // bare positional project path (was silently dropped)
    }
  }
  return result;
}

const args = parseArgs();
const PROJECT_DIR = resolveProjectDir(args.projectDir, []);

try {
  // Migrate the RAW files (migration deltas only), never the normalized loadProjectFiles() output —
  // persisting normalized data would freeze constants-inherited mission defaults and hex→decimal
  // colors into the source, silently breaking the constants→mission inheritance the author relies on.
  const raw = readRawProjectFiles(PROJECT_DIR);
  const { files: migratedFiles, migrations } = migrateProjectFiles(raw);
  if (args.write && migrations.length > 0) {
    writeMigratedProjectFiles(PROJECT_DIR, migratedFiles);
  }
  const result = {
    ok: true,
    projectDir: PROJECT_DIR,
    write: args.write,
    migrationCount: migrations.length,
    migrations: migrations
  };
  if (args.json) printJson(result);
  else if (migrations.length === 0) {
    console.log("  ✓ Project schema is current.");
  } else {
    console.log(`  ${args.write ? "✓ Applied" : "!"} ${migrations.length} migration(s).`);
    for (const migration of migrations) {
      console.log(`    ${migration.id}: ${migration.description}`);
    }
    if (!args.write) console.log("  Run again with --write to persist migrated files.");
  }
} catch (error) {
  if (args.json) printJson({ ok: false, projectDir: PROJECT_DIR, error: error.message });
  else console.error(`  ✗ ${error.message}`);
  process.exit(1);
}
