// package.mjs — Wrap a built web bundle into a native app project (Capacitor mobile or Tauri desktop).
// Usage: node package.mjs [--project <path>] [--kind mobile|desktop] [--target <targetId>] [--out <dir>] [--json]
import process from "node:process";
import { resolveProjectDir } from "./lib/project-loader.mjs";
import { packageProject } from "./lib/packaging.mjs";
import { parseJsonFlag, printJson } from "./lib/trace.mjs";

function parseArgs() {
  const raw = process.argv.slice(2);
  const result = { projectDir: null, kind: "mobile", targetId: null, outDir: null, json: parseJsonFlag(raw) };
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "--project" && raw[i + 1]) result.projectDir = raw[++i];
    else if (raw[i] === "--kind" && raw[i + 1]) result.kind = raw[++i];
    else if (raw[i] === "--target" && raw[i + 1]) result.targetId = raw[++i];
    else if (raw[i] === "--out" && raw[i + 1]) result.outDir = raw[++i];
  }
  return result;
}

const args = parseArgs();
if (args.kind !== "mobile" && args.kind !== "desktop") {
  console.error(`Unknown --kind "${args.kind}". Use "mobile" (Capacitor) or "desktop" (Tauri).`);
  process.exit(1);
}
const projectDir = resolveProjectDir(args.projectDir, []);

try {
  const result = await packageProject(projectDir, { kind: args.kind, targetId: args.targetId, outDir: args.outDir });
  if (args.json) {
    printJson(result);
    process.exit(result.ok ? 0 : 1);
  }
  if (!result.ok) {
    console.error(`  ✗ ${result.error}`);
    process.exit(1);
  }
  const label = result.kind === "desktop" ? "desktop (Tauri)" : "mobile (Capacitor)";
  console.log(`  ✓ Packaged ${result.app.appName} for ${label} → ${result.outDir}`);
  console.log(`    App id: ${result.app.appId}   version ${result.app.version}`);
  console.log(`\n  Next steps:`);
  for (const step of result.nextSteps) console.log(`    ${step}`);
  console.log(`\n  See ${result.outDir}/README.md for the full store/distribution checklist.`);
} catch (error) {
  if (args.json) printJson({ ok: false, error: error.message });
  else console.error(`  ✗ ${error.message}`);
  process.exit(1);
}
