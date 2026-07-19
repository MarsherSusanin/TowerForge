// create.mjs — Scaffold a new .tdproj project from a genre template.
// Usage: node create.mjs <name> [--dir <path>] [--template classic|maze|idle|roguelike]
import path from "node:path";
import process from "node:process";
import { createProject, TEMPLATE_NAMES } from "./lib/create-project.mjs";

function parseArgs() {
  const raw = process.argv.slice(2);
  const result = { name: null, dir: null, template: "classic" };
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "--dir" && raw[i + 1]) {
      result.dir = path.resolve(raw[i + 1]);
      i += 2;
    } else if (raw[i] === "--template" && raw[i + 1]) {
      result.template = raw[i + 1];
      i += 2;
    } else if (!raw[i].startsWith("--")) {
      if (!result.name) result.name = raw[i];
      i++;
    } else {
      i++;
    }
  }
  return result;
}

const args = parseArgs();
if (!args.name) {
  console.error("Usage: node create.mjs <name> [--dir <path>] [--template <name>]");
  console.error("  name        Project name (will create <name>.tdproj directory)");
  console.error("  --dir       Parent directory for the project (default: current directory)");
  console.error(`  --template  Starter game: ${TEMPLATE_NAMES.join(" | ")} (default: classic)`);
  process.exit(1);
}

try {
  const result = createProject({
    name: args.name,
    parentDir: args.dir ?? process.cwd(),
    templateName: args.template
  });
  const { projectName, templateName, counts } = result;
  console.log(`Created ${projectName}/  (template: ${templateName})`);
  console.log(`  content/balance.json       — ${counts.missions} mission(s), ${counts.enemies} enemies, ${counts.towers} towers, ${counts.currencies} currenc(ies)`);
  console.log(`  content/world-map.json     — ${counts.missionNodes} mission node(s)`);
  console.log(`  maps/compiled/maps.json    — ${counts.maps} map(s)`);
  console.log("  build-targets.json         — web-pwa target");
  console.log();
  console.log("Next steps:");
  console.log(`  node packages/cli/bin/towerforge.mjs validate --project ${projectName}`);
  console.log(`  node packages/cli/bin/towerforge.mjs balance  --project ${projectName}`);
  console.log(`  node packages/cli/bin/towerforge.mjs studio   --project ${projectName}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
