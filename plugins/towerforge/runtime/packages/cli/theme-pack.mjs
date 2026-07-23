#!/usr/bin/env node
import process from "node:process";
import { resolveProjectDir } from "./lib/project-loader.mjs";
import { applyThemePack, listThemePacks, previewThemePack } from "./lib/theme-packs.mjs";

const args = process.argv.slice(2);
const command = args[0] || "list";
const json = args.includes("--json");
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

try {
  if (command === "list") {
    const result = { ok: true, packs: listThemePacks() };
    if (json) console.log(JSON.stringify(result));
    else for (const pack of result.packs) console.log(`${pack.id}\t${pack.label}\t${pack.description}`);
    process.exit(0);
  }
  if (command !== "apply") throw new Error("Usage: towerforge themes:list | towerforge themes:apply <packId> [--project <path>] [--dry-run] [--json]");
  const packId = args[1];
  if (!packId || packId.startsWith("--")) throw new Error("themes:apply requires a pack id.");
  const projectDir = resolveProjectDir(valueAfter("--project"));
  const result = args.includes("--dry-run")
    ? previewThemePack(projectDir, packId)
    : await applyThemePack(projectDir, packId);
  if (json) console.log(JSON.stringify({ projectDir, ...result }));
  else if (result.ok) console.log(`${result.dryRun ? "Previewed" : "Applied"} ${result.pack.label} for ${result.changes.missionIds.length} mission(s).`);
  else console.error(result.error || result.message || "Theme pack failed.");
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  if (json) console.log(JSON.stringify({ ok: false, error: error.message }));
  else console.error(error.message);
  process.exit(1);
}
