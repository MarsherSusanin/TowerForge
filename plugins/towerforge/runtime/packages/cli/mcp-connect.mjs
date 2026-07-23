// mcp-connect.mjs — configurator: connect AI-agent clients (Claude Code, Codex, Claude Desktop,
// Cursor, VS Code) to this project's MCP server.
// Usage: node mcp-connect.mjs [--project <path>] [--client <id>] [--write] [--json]
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveProjectDir } from "./lib/project-loader.mjs";
import { agentClientConfigs, connectCodexUser, writeProjectClientConfig } from "./lib/agent-connect.mjs";
import { parseJsonFlag, printJson } from "./lib/trace.mjs";

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(cliDir, "../mcp/server.mjs");

function parseArgs() {
  const raw = process.argv.slice(2);
  const result = { projectDir: null, client: null, write: false, json: parseJsonFlag(raw) };
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === "--project" && raw[i + 1]) { result.projectDir = raw[i + 1]; i += 1; }
    else if (raw[i] === "--client" && raw[i + 1]) { result.client = raw[i + 1]; i += 1; }
    else if (raw[i] === "--write") { result.write = true; }
    else if (!result.projectDir && !raw[i].startsWith("--")) { result.projectDir = raw[i]; } // bare positional project path
  }
  return result;
}

const args = parseArgs();
const PROJECT_DIR = resolveProjectDir(args.projectDir, []);

try {
  const clients = agentClientConfigs(PROJECT_DIR, SERVER_PATH);
  const selected = args.client ? clients.filter((c) => c.id === args.client) : clients;
  if (args.client && selected.length === 0) {
    throw new Error(`Unknown client "${args.client}". Available: ${clients.map((c) => c.id).join(", ")}.`);
  }

  if (args.write) {
    if (!args.client) throw new Error("--write requires --client <id>.");
    if (args.client === "codex") {
      // Codex is user-scoped: the explicit CLI flag is the consent to touch ~/.codex. Installs the
      // MCP entry (append-only, idempotent) AND the /towerforge slash-command prompt.
      const result = connectCodexUser(PROJECT_DIR, SERVER_PATH);
      if (args.json) printJson({ ok: true, projectDir: PROJECT_DIR, ...result });
      else {
        console.log(result.alreadyConnected
          ? `  ✓ ${result.configPath} already has the towerforge entry (left untouched).`
          : `  ✓ Added MCP entry to ${result.configPath}`);
        console.log(`  ✓ Installed ${result.promptPath} — use ${result.slashCommand} inside Codex.`);
      }
      process.exit(0);
    }
    const written = writeProjectClientConfig(PROJECT_DIR, args.client, SERVER_PATH);
    if (args.json) printJson({ ok: true, projectDir: PROJECT_DIR, ...written });
    else console.log(`  ✓ Wrote ${written.filePath} (server key: ${written.serverKey})`);
    process.exit(0);
  }

  if (args.json) {
    printJson({ ok: true, projectDir: PROJECT_DIR, serverPath: SERVER_PATH, clients: selected });
  } else {
    console.log(`\n  Connect an AI agent to this project's MCP server (${PROJECT_DIR}):\n`);
    for (const client of selected) {
      console.log(`  ── ${client.label} — ${client.file}`);
      console.log(`     ${client.how}`);
      if (client.writable) console.log(`     One-shot: towerforge mcp:connect --client ${client.id} --write`);
      console.log(client.snippet.split("\n").map((line) => "     " + line).join("\n"));
      console.log("");
    }
  }
} catch (error) {
  if (args.json) printJson({ ok: false, projectDir: PROJECT_DIR, error: error.message });
  else console.error(`  ✗ ${error.message}`);
  process.exit(1);
}
