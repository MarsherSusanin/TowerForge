// agent-connect.mjs — one source of truth for connecting AI-agent clients to the TowerForge MCP
// server. Generates ready-to-use config snippets per client (Claude Code, Codex CLI, Claude
// Desktop, Cursor, VS Code) and can write the PROJECT-scoped ones in place. Consumed by both the
// `towerforge mcp:connect` CLI command and the Studio Settings panel, so the two never drift.
//
// Design notes:
// - "Plugin" is not a thing MCP clients need: every major client's native extension point for
//   external tools IS an MCP server entry. Claude Code auto-discovers a project-root `.mcp.json`;
//   Codex reads `~/.codex/config.toml`; Claude Desktop reads its own JSON; Cursor/VS Code read
//   project-local files. So the configurator's whole job is emitting the right entry per client.
// - We only ever WRITE files inside the project directory (`.mcp.json`, `.cursor/mcp.json`,
//   `.vscode/mcp.json`). User-scoped files (Codex/Claude Desktop) get copy-paste snippets instead —
//   silently editing files in the user's home directory is not this tool's call to make.
// - `process.execPath` (absolute node) is used instead of bare "node" so GUI clients that launch
//   servers without a login shell PATH (Claude Desktop, IDEs) still find the runtime.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const MCP_SERVER_KEY = "towerforge-ai";

function serverCommand(serverPath, projectDir, nodePath = process.execPath) {
  return { command: nodePath, args: [serverPath, "--project", projectDir] };
}

/** TOML basic strings share JSON's escape rules for the characters that matter here (backslash,
 *  quote), so JSON.stringify produces valid TOML string literals — including non-ASCII paths. */
function tomlString(value) {
  return JSON.stringify(value);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Every supported client with a ready snippet.
 * @returns {Array<{id, label, scope: "project"|"user", how, file, snippet, writable: boolean}>}
 */
export function agentClientConfigs(projectDir, serverPath, nodePath = process.execPath) {
  const entry = serverCommand(serverPath, projectDir, nodePath);
  const jsonBlock = (root) => JSON.stringify(root, null, 2);
  const claudeDesktopFile = process.platform === "darwin"
    ? "~/Library/Application Support/Claude/claude_desktop_config.json"
    : process.platform === "win32"
      ? "%APPDATA%\\Claude\\claude_desktop_config.json"
      : "~/.config/Claude/claude_desktop_config.json";

  return [
    {
      id: "claude-code",
      label: "Claude Code (project)",
      scope: "project",
      file: ".mcp.json",
      how: "Written to the project root — Claude Code auto-discovers .mcp.json when launched in this folder and offers to connect the server.",
      snippet: jsonBlock({ mcpServers: { [MCP_SERVER_KEY]: entry } }),
      writable: true
    },
    {
      id: "claude-code-cli",
      label: "Claude Code (user-wide, CLI)",
      scope: "user",
      file: "~/.claude.json (via CLI)",
      how: "One terminal command — connects the server for your whole user, not just this folder.",
      snippet: `claude mcp add ${MCP_SERVER_KEY} -- ${shellQuote(entry.command)} ${entry.args.map(shellQuote).join(" ")}`,
      writable: false
    },
    {
      id: "claude-code-plugin",
      label: "Claude Code (plugin, user-wide)",
      scope: "user",
      file: ".claude-plugin/ (this repo IS the plugin + marketplace)",
      how: "Two slash commands inside Claude Code — installs the MCP server AND the /towerforge authoring command for your whole user. Run `npm install` in the checkout once; the engine builds itself on first tool call.",
      snippet: [
        `/plugin marketplace add ${path.resolve(serverPath, "..", "..", "..")}`,
        "/plugin install towerforge@towerforge"
      ].join("\n"),
      writable: false
    },
    {
      id: "codex",
      label: "Codex CLI",
      scope: "user",
      file: "~/.codex/config.toml",
      how: "Append this block to ~/.codex/config.toml — or run `towerforge mcp:connect --client codex --write` to install it plus a /towerforge slash command in one step.",
      snippet: [
        `[mcp_servers.${MCP_SERVER_KEY.replace(/-/g, "_")}]`,
        `command = ${tomlString(entry.command)}`,
        `args = [${entry.args.map(tomlString).join(", ")}]`
      ].join("\n"),
      writable: false
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      scope: "user",
      file: claudeDesktopFile,
      how: `Merge into ${claudeDesktopFile} (combine with any existing mcpServers, then restart Claude Desktop).`,
      snippet: jsonBlock({ mcpServers: { [MCP_SERVER_KEY]: entry } }),
      writable: false
    },
    {
      id: "cursor",
      label: "Cursor (project)",
      scope: "project",
      file: ".cursor/mcp.json",
      how: "Written into the project — Cursor picks up .cursor/mcp.json automatically.",
      snippet: jsonBlock({ mcpServers: { [MCP_SERVER_KEY]: entry } }),
      writable: true
    },
    {
      id: "vscode",
      label: "VS Code / Copilot (project)",
      scope: "project",
      file: ".vscode/mcp.json",
      how: "Written into the project — VS Code reads .vscode/mcp.json (the `servers` format, type: stdio).",
      snippet: jsonBlock({ servers: { [MCP_SERVER_KEY]: { type: "stdio", ...entry } } }),
      writable: true
    }
  ];
}

/** Merge-preserving write of a PROJECT-scoped client config. Refuses user-scoped clients and an
 *  existing-but-unparseable target file (never clobbers something we can't read). */
export function writeProjectClientConfig(projectDir, clientId, serverPath, nodePath = process.execPath) {
  const entry = serverCommand(serverPath, projectDir, nodePath);
  const targets = {
    "claude-code": { rel: ".mcp.json", rootKey: "mcpServers", value: entry },
    cursor: { rel: path.join(".cursor", "mcp.json"), rootKey: "mcpServers", value: entry },
    vscode: { rel: path.join(".vscode", "mcp.json"), rootKey: "servers", value: { type: "stdio", ...entry } }
  };
  const target = Object.prototype.hasOwnProperty.call(targets, clientId) ? targets[clientId] : undefined;
  if (!target) {
    throw new Error(`Client "${clientId}" is not project-scoped — copy its snippet into the user-level config instead.`);
  }
  const filePath = path.join(projectDir, target.rel);
  let config = {};
  if (fs.existsSync(filePath)) {
    try {
      config = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      throw new Error(`${filePath} exists but is not valid JSON — fix or remove it first.`);
    }
  }
  config[target.rootKey] ??= {};
  config[target.rootKey][MCP_SERVER_KEY] = target.value;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
  return { filePath, serverKey: MCP_SERVER_KEY };
}

export function homeDirDisplay(value) {
  return value.replace(os.homedir(), "~");
}

// ── Codex native integration ─────────────────────────────────────────────────
// Codex has no plugin marketplace; its native extension points are (1) an MCP server entry in
// ~/.codex/config.toml, (2) custom prompt files in ~/.codex/prompts/*.md that become slash
// commands, and (3) a project AGENTS.md it reads automatically. connectCodexUser() installs the
// first two in one explicit, user-initiated step (`mcp:connect --client codex --write` — the CLI
// flag IS the consent to touch the user's home; Studio never calls this).

const CODEX_TOML_KEY = `mcp_servers.${MCP_SERVER_KEY.replace(/-/g, "_")}`;

/** The /towerforge slash command installed into ~/.codex/prompts — teaches Codex the safe
 *  authoring loop over the MCP tools without the user re-explaining it every session. */
export function codexPromptContent(projectDir) {
  return `# TowerForge game constructor

Work on the TowerForge tower-defense project at \`${projectDir}\` through the \`${MCP_SERVER_KEY}\` MCP tools (not by editing content JSON by hand).

The safe authoring loop:
1. \`describe_schema\` first — attack kinds, ability effects, and currency rules, so shapes are right on the first try.
2. \`get_project_summary\` / \`validate_project\` — current state plus \`revisions\` tokens.
3. Preview risky balance changes with \`dry_run_balance_patch\` (returns a leaf-level \`diff\`).
4. Write with the narrow tools (\`set_enemy_stat\`, \`upsert_tower\`, \`upsert_entity\`, \`add_wave_group\`, \`write_map\`, \`bind_sprite\`, \`bind_mission_music\`, \`import_asset\`, \`upsert_story_comic\`, \`set_battle_background\`) passing \`ifRevision\` from step 2 — a stale revision returns \`{conflict:true}\` instead of clobbering concurrent edits.
5. If validation fails, call \`explain_validation\` with the issue to get the constraint and a runnable example.
6. Check results with \`simulate_mission\` and \`balance_report\` before calling the work done.

$ARGUMENTS
`;
}

/** Idempotently connect Codex user-wide: append the MCP entry to config.toml (never rewriting
 *  existing content — append-only, and a no-op if our key is already present) and install the
 *  /towerforge prompt. `codexHome` is overridable for tests. */
export function connectCodexUser(projectDir, serverPath, options = {}) {
  const codexHome = options.codexHome ?? path.join(os.homedir(), ".codex");
  const nodePath = options.nodePath ?? process.execPath;
  const configPath = path.join(codexHome, "config.toml");
  const promptPath = path.join(codexHome, "prompts", "towerforge.md");
  const entry = serverCommand(serverPath, projectDir, nodePath);

  fs.mkdirSync(codexHome, { recursive: true });
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  let configChanged = false;
  if (!existing.includes(`[${CODEX_TOML_KEY}]`)) {
    const block = [
      "",
      `# Added by \`towerforge mcp:connect --client codex --write\``,
      `[${CODEX_TOML_KEY}]`,
      `command = ${tomlString(entry.command)}`,
      `args = [${entry.args.map(tomlString).join(", ")}]`,
      ""
    ].join("\n");
    fs.writeFileSync(configPath, existing + (existing && !existing.endsWith("\n") ? "\n" : "") + block, "utf8");
    configChanged = true;
  }

  fs.mkdirSync(path.dirname(promptPath), { recursive: true });
  fs.writeFileSync(promptPath, codexPromptContent(projectDir), "utf8");

  return {
    configPath,
    configChanged,
    alreadyConnected: !configChanged,
    promptPath,
    slashCommand: "/towerforge"
  };
}

/** AGENTS.md scaffolded into NEW projects (Codex, Claude Code, and most agent CLIs read it
 *  automatically) — makes every created project agent-ready without per-user setup. */
export function agentProjectGuide(projectName) {
  return `# ${projectName} — agent guide

This is a TowerForge tower-defense project (\`.tdproj\`). Author it through the TowerForge MCP
tools, not by hand-editing the content JSON — the tools validate before writing, back up, roll
back on failure, and guard concurrent edits with revision tokens.

## Connect (once)

\`\`\`sh
npx towerforge mcp:connect .            # print configs for Claude Code / Codex / Cursor / VS Code
npx towerforge mcp:connect . --client claude-code --write   # or one-shot into this project
\`\`\`

## Authoring loop

1. \`describe_schema\` — tower attack kinds, ability effects, currency rules (call before authoring).
2. \`get_project_summary\` / \`validate_project\` — state + \`revisions\` for optimistic concurrency.
3. \`dry_run_balance_patch\` — preview a change as a leaf-level diff before committing.
4. Narrow writes with \`ifRevision\`: \`set_enemy_stat\`, \`upsert_tower\`, \`upsert_entity\`,
   \`add_wave_group\`, \`write_map\`, \`bind_sprite\`, \`bind_mission_music\`, \`import_asset\`, \`upsert_story_comic\`, \`set_battle_background\`, \`delete_entity\` (reference-aware).
5. \`explain_validation\` — turn any validation error code into a constraint + runnable example.
6. \`simulate_mission\` + \`balance_report\` — verify the game still plays and stays winnable.

Human-facing editing happens in Studio: \`npx towerforge studio --project .\`
`;
}
