import path from "node:path";
import process from "node:process";
import { exportProjectPack, importProjectPack, inspectProjectPack } from "./lib/project-pack.mjs";
import { resolveProjectDir } from "./lib/project-loader.mjs";
import { parseJsonFlag, printJson } from "./lib/trace.mjs";

const raw = process.argv.slice(2);
const command = raw[0];
const args = parseArgs(raw.slice(1));

try {
  if (command === "export") {
    const projectDir = resolveProjectDir(args.projectDir, raw.slice(1));
    const outputPath = args.output ? path.resolve(args.output) : path.join(path.dirname(projectDir), `${path.basename(projectDir, ".tdproj")}.tdpack`);
    const result = await exportProjectPack(projectDir, outputPath);
    if (args.json) printJson({ ...result, projectDir });
    else console.log(`Exported ${result.fileCount} files to ${result.outputPath}\nSHA-256: ${result.sha256}`);
  } else if (command === "import") {
    if (!args.packPath) throw new Error("Usage: towerforge import <project.tdpack> [--dir <parent>] [--name <name>]");
    const result = await importProjectPack(path.resolve(args.packPath), path.resolve(args.parentDir ?? process.cwd()), { name: args.name });
    if (args.json) printJson(result);
    else console.log(`Imported ${result.projectName} to ${result.projectDir}\nSHA-256: ${result.sha256}`);
  } else if (command === "inspect") {
    if (!args.packPath) throw new Error("Usage: towerforge inspect-pack <project.tdpack>");
    const { entries, ...result } = inspectProjectPack(path.resolve(args.packPath));
    if (args.json) printJson({ ...result, files: entries.map((entry) => ({ path: entry.path, size: entry.size, sha256: entry.sha256 })) });
    else console.log(`${result.projectName} · ${result.fileCount} files · ${result.sourceBytes} bytes\nSHA-256: ${result.sha256}`);
  } else {
    throw new Error("Expected export, import, or inspect.");
  }
} catch (error) {
  if (args.json) printJson({ ok: false, error: error.message });
  else console.error(error.message);
  process.exitCode = 1;
}

function parseArgs(values) {
  const result = { json: parseJsonFlag(values) };
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === "--project" && values[i + 1]) result.projectDir = values[++i];
    else if (value === "--out" && values[i + 1]) result.output = values[++i];
    else if (value === "--dir" && values[i + 1]) result.parentDir = values[++i];
    else if (value === "--name" && values[i + 1]) result.name = values[++i];
    else if (value !== "--json" && !value.startsWith("--") && !result.packPath) result.packPath = value;
  }
  return result;
}
