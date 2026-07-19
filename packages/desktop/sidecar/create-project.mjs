#!/usr/bin/env node
import process from "node:process";
import { createProject } from "../../cli/lib/create-project.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

try {
  const result = createProject({
    name: valueAfter("--name"),
    parentDir: valueAfter("--parent"),
    templateName: valueAfter("--template") || "classic"
  });
  process.stdout.write(JSON.stringify({ ok: true, projectDir: result.projectDir }) + "\n");
} catch (error) {
  process.stderr.write(error.message + "\n");
  process.exit(1);
}
