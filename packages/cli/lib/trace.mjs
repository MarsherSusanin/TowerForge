import fs from "node:fs";
import path from "node:path";

export function parseJsonFlag(args) {
  return args.includes("--json");
}

export function printJson(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function writeRunTrace(projectDir, event) {
  const runsDir = path.join(projectDir, ".towerforge", "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const filePath = path.join(runsDir, `${day}.jsonl`);
  const entry = {
    timestamp: new Date().toISOString(),
    ...event
  };
  fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf8");
  return filePath;
}

export function mergeValidationResults(...results) {
  const issues = results.flatMap((result) => result?.issues ?? []);
  return {
    ok: issues.filter((issue) => issue.severity === "error").length === 0,
    issues
  };
}
