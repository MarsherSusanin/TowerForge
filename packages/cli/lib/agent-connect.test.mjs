import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MCP_SERVER_KEY, agentClientConfigs, agentProjectGuide, connectCodexUser, writeProjectClientConfig } from "./agent-connect.mjs";

// A path with non-ASCII + a quote — the worst realistic case for every snippet format.
const SERVER = "/Users/тест/tower \"forge\"/packages/mcp/server.mjs";
let projectDir;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-агент-connect-"));
});
afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

describe("agent connect configurator", () => {
  it("covers the major clients and every snippet round-trips its format", () => {
    const clients = agentClientConfigs(projectDir, SERVER, "/usr/bin/node");
    const ids = clients.map((c) => c.id);
    for (const expected of ["claude-code", "claude-code-cli", "claude-code-plugin", "codex-plugin", "codex", "claude-desktop", "cursor", "vscode"]) {
      expect(ids).toContain(expected);
    }
    for (const client of clients) {
      expect(client.label).toBeTruthy();
      expect(client.how).toBeTruthy();
      expect(["project", "user"]).toContain(client.scope);
      // JSON snippets must parse and carry the server entry with the exact paths.
      if (client.snippet.trim().startsWith("{")) {
        const parsed = JSON.parse(client.snippet);
        const entry = (parsed.mcpServers ?? parsed.servers)[MCP_SERVER_KEY];
        expect(entry.args).toContain(SERVER);
        expect(entry.args).toContain(projectDir);
      }
    }
    // Only project-scoped clients are writable — never anything in the user's home.
    for (const client of clients) {
      expect(client.writable).toBe(client.scope === "project");
    }
  });

  it("escapes non-ASCII and quotes correctly in the Codex TOML block", () => {
    const [codex] = agentClientConfigs(projectDir, SERVER, "/usr/bin/node").filter((c) => c.id === "codex");
    expect(codex.snippet).toContain("[mcp_servers.towerforge_ai]"); // TOML-safe key (no dashes)
    expect(codex.snippet).toContain('command = "/usr/bin/node"');
    // The embedded quote in the path must arrive escaped, not raw (raw would break the TOML string).
    expect(codex.snippet).toContain('tower \\"forge\\"');
  });

  it("offers the workspace-bound Codex marketplace plugin as the preferred integration", () => {
    const [plugin] = agentClientConfigs(projectDir, SERVER, "/usr/bin/node").filter((client) => client.id === "codex-plugin");
    expect(plugin.snippet).toContain("Lindforge-Studios/towerforge-codex-plugin");
    expect(plugin.snippet).not.toContain("--sparse");
    expect(plugin.snippet).toContain("towerforge@towerforge");
    expect(plugin.how).toContain("workspace-bound");
  });

  it("writes project-scoped configs merge-preserving foreign entries", () => {
    // Pre-existing .cursor/mcp.json with someone else's server must survive.
    const cursorPath = path.join(projectDir, ".cursor", "mcp.json");
    fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
    fs.writeFileSync(cursorPath, JSON.stringify({ mcpServers: { other: { command: "x" } } }));

    const { filePath } = writeProjectClientConfig(projectDir, "cursor", SERVER, "/usr/bin/node");
    const written = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(written.mcpServers.other).toEqual({ command: "x" }); // foreign entry preserved
    expect(written.mcpServers[MCP_SERVER_KEY].args).toContain(projectDir);

    // VS Code uses the `servers` root key and type: stdio.
    const vs = writeProjectClientConfig(projectDir, "vscode", SERVER, "/usr/bin/node");
    const vsWritten = JSON.parse(fs.readFileSync(vs.filePath, "utf8"));
    expect(vsWritten.servers[MCP_SERVER_KEY].type).toBe("stdio");
  });

  it("refuses user-scoped clients and unparseable existing files", () => {
    expect(() => writeProjectClientConfig(projectDir, "codex", SERVER)).toThrow(/not project-scoped/);
    expect(() => writeProjectClientConfig(projectDir, "constructor", SERVER)).toThrow(/not project-scoped/);
    fs.writeFileSync(path.join(projectDir, ".mcp.json"), "{broken");
    expect(() => writeProjectClientConfig(projectDir, "claude-code", SERVER)).toThrow(/not valid JSON/);
  });

  it("connectCodexUser appends the TOML entry once (idempotent, append-only) and installs the /towerforge prompt", () => {
    const codexHome = path.join(projectDir, "fake-codex-home");
    // Pre-existing user config with foreign content that must survive byte-for-byte.
    fs.mkdirSync(codexHome, { recursive: true });
    const foreign = '# my settings\nmodel = "o4"\n\n[mcp_servers.other]\ncommand = "x"\n';
    fs.writeFileSync(path.join(codexHome, "config.toml"), foreign);

    const first = connectCodexUser(projectDir, SERVER, { codexHome, nodePath: "/usr/bin/node" });
    expect(first.configChanged).toBe(true);
    const toml = fs.readFileSync(first.configPath, "utf8");
    expect(toml.startsWith(foreign)).toBe(true); // append-only: foreign content untouched
    expect(toml).toContain("[mcp_servers.towerforge_ai]");
    expect(toml).toContain('tower \\"forge\\"'); // quotes in the path escaped, not raw

    // Prompt file exists and points at THIS project.
    const prompt = fs.readFileSync(first.promptPath, "utf8");
    expect(prompt).toContain(projectDir);
    expect(prompt).toContain("dry_run_balance_patch");

    // Second run: no duplicate TOML block.
    const second = connectCodexUser(projectDir, SERVER, { codexHome, nodePath: "/usr/bin/node" });
    expect(second.alreadyConnected).toBe(true);
    const again = fs.readFileSync(first.configPath, "utf8");
    expect(again.match(/\[mcp_servers\.towerforge_ai\]/g)).toHaveLength(1);
  });

  it("the repo's Claude Code plugin manifest is valid and points at the real MCP server", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const plugin = JSON.parse(fs.readFileSync(path.join(repoRoot, ".claude-plugin", "plugin.json"), "utf8"));
    expect(plugin.name).toBe("towerforge");
    const serverArg = plugin.mcpServers["towerforge-ai"].args[0];
    expect(serverArg).toContain("${CLAUDE_PLUGIN_ROOT}");
    // The path after the variable must resolve to a file that actually exists in the repo.
    expect(fs.existsSync(path.join(repoRoot, serverArg.replace("${CLAUDE_PLUGIN_ROOT}/", "")))).toBe(true);

    const market = JSON.parse(fs.readFileSync(path.join(repoRoot, ".claude-plugin", "marketplace.json"), "utf8"));
    expect(market.plugins.map((p) => p.name)).toContain("towerforge");
    // The bundled /towerforge command exists and teaches the loop.
    const cmd = fs.readFileSync(path.join(repoRoot, "commands", "towerforge.md"), "utf8");
    expect(cmd).toContain("dry_run_balance_patch");
    expect(cmd).toContain("$ARGUMENTS");
  });

  it("agentProjectGuide names the safe authoring loop tools", () => {
    const guide = agentProjectGuide("my-game");
    for (const tool of ["describe_schema", "dry_run_balance_patch", "explain_validation", "ifRevision", "simulate_mission"]) {
      expect(guide).toContain(tool);
    }
  });
});
