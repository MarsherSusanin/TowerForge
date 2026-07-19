import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AgentRuntimeBridge,
  isAllowedRuntimeAuthUrl,
  jsonSchemaToZodShape,
  redactRuntimeText,
  runtimeChildEnv
} from "./agent-runtime.mjs";

const tempRoots = new Set();
const originalEnv = {
  data: process.env.TOWERFORGE_USER_DATA_DIR,
  codex: process.env.TOWERFORGE_CODEX_BIN
};

afterEach(() => {
  if (originalEnv.data === undefined) delete process.env.TOWERFORGE_USER_DATA_DIR;
  else process.env.TOWERFORGE_USER_DATA_DIR = originalEnv.data;
  if (originalEnv.codex === undefined) delete process.env.TOWERFORGE_CODEX_BIN;
  else process.env.TOWERFORGE_CODEX_BIN = originalEnv.codex;
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
  tempRoots.clear();
});

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-agent-runtime-"));
  tempRoots.add(root);
  return root;
}

function bridgeOptions(root, overrides = {}) {
  return {
    projectDir: path.join(root, "game.tdproj"),
    repoRoot: path.resolve(import.meta.dirname, "../../.."),
    tools: [{
      name: "validate_project",
      description: "Validate the current project.",
      inputSchema: { type: "object", properties: { projectDir: { type: "string" } }, additionalProperties: false }
    }],
    callTool: async (_name, input) => ({ ok: true, projectDir: input.projectDir }),
    systemPrompt: "Use TowerForge tools.",
    summarizeToolResult: (_name, result) => result,
    writeTools: new Set(),
    ...overrides
  };
}

describe("agent runtime security boundaries", () => {
  it("passes only a narrow environment and strips provider secrets and proxy credentials", () => {
    const env = runtimeChildEnv("codex", "/private/config", {
      HOME: "/home/designer",
      PATH: "/usr/bin",
      OPENAI_API_KEY: "sk-secret",
      ANTHROPIC_API_KEY: "sk-ant-secret",
      HTTPS_PROXY: "https://user:password@proxy.example",
      AWS_SECRET_ACCESS_KEY: "secret"
    });
    expect(env).toMatchObject({ PATH: "/usr/bin", CODEX_HOME: "/private/config" });
    if (process.platform === "win32") expect(env.USERPROFILE).toBe("/private/config");
    else expect(env.HOME).toBe("/private/config");
    expect(env.HOME).not.toBe("/home/designer");
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("HTTPS_PROXY");
    expect(env).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
  });

  it("redacts credentials and accepts only explicit HTTPS OAuth hosts", () => {
    expect(redactRuntimeText("Authorization: Bearer eyJabc.def.ghi at /tmp/game", { projectDir: "/tmp/game" }))
      .toBe("Authorization [redacted] at <project>");
    expect(isAllowedRuntimeAuthUrl("https://auth.openai.com/oauth/authorize?client_id=x")).toBe(true);
    expect(isAllowedRuntimeAuthUrl("https://auth.openai.com.evil.example/oauth")).toBe(false);
    expect(isAllowedRuntimeAuthUrl("http://auth.openai.com/oauth")).toBe(false);
    expect(isAllowedRuntimeAuthUrl("file:///tmp/token")).toBe(false);
  });

  it("preserves required fields and enums when translating tool schemas for Claude", async () => {
    const shape = jsonSchemaToZodShape({
      type: "object",
      properties: { field: { type: "string", enum: ["hp", "speed"] }, value: { type: "number" } },
      required: ["field", "value"]
    });
    const schema = (await import("zod")).z.object(shape);
    expect(schema.parse({ field: "hp", value: 3 })).toEqual({ field: "hp", value: 3 });
    expect(() => schema.parse({ field: "other", value: 3 })).toThrow();
    expect(() => schema.parse({ field: "hp" })).toThrow();
  });
});

describe("Codex App Server adapter", () => {
  it("uses an ephemeral isolated thread and executes only allowlisted dynamic tools", async () => {
    const root = tempRoot();
    const fakeCodex = path.join(root, "fake-codex.mjs");
    fs.writeFileSync(fakeCodex, `
      import readline from "node:readline";
      const rl = readline.createInterface({ input: process.stdin });
      const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "initialize") return send({ id: msg.id, result: { userAgent: "fake" } });
        if (msg.method === "account/read") return send({ id: msg.id, result: { account: { type: "chatgpt", planType: "plus", email: null }, requiresOpenaiAuth: true } });
        if (msg.method === "account/login/start") return send({ id: msg.id, result: { type: "chatgpt", loginId: "login-1", authUrl: "https://auth.openai.com/oauth/authorize?client_id=test" } });
        if (msg.method === "thread/start") {
          if (msg.params.cwd.includes("game.tdproj") || msg.params.sandbox !== "read-only" || !msg.params.ephemeral || msg.params.dynamicTools?.[0]?.name !== "towerforge") process.exit(9);
          return send({ id: msg.id, result: { thread: { id: "thread-1" } } });
        }
        if (msg.method === "turn/start") {
          const policy = msg.params.sandboxPolicy;
          if (msg.params.approvalPolicy !== "never" || policy?.type !== "readOnly" || policy?.access?.type !== "restricted" || policy?.access?.readableRoots?.length !== 1 || policy.access.readableRoots[0] !== msg.params.cwd) process.exit(10);
          send({ id: msg.id, result: { turn: { id: "turn-1", status: "inProgress", items: [] } } });
          return send({ id: 900, method: "item/tool/call", params: { threadId: "thread-1", turnId: "turn-1", callId: "call-1", namespace: "towerforge", tool: "validate_project", arguments: { projectDir: "/outside/project" } } });
        }
        if (msg.id === 900 && msg.result) {
          send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "Project is valid." } });
          return send({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", items: [] } } });
        }
      });
    `, "utf8");
    process.env.TOWERFORGE_USER_DATA_DIR = path.join(root, "user-data");
    process.env.TOWERFORGE_CODEX_BIN = fakeCodex;
    const calls = [];
    const bridge = new AgentRuntimeBridge(bridgeOptions(root, {
      callTool: async (name, input) => { calls.push({ name, input }); return { ok: true }; }
    }));

    try {
      await expect(bridge.status("codex")).resolves.toMatchObject({ available: true, connected: true, subscription: "plus" });
      await expect(bridge.connect("codex")).resolves.toMatchObject({ authUrl: expect.stringContaining("auth.openai.com") });
      const events = [];
      const result = await bridge.runChat({
        provider: "codex",
        model: "default",
        history: [{ role: "user", content: "Validate" }],
        send: (event) => events.push(event),
        signal: new AbortController().signal
      });
      expect(calls).toEqual([{ name: "validate_project", input: { projectDir: path.join(root, "game.tdproj") } }]);
      expect(events).toContainEqual({ type: "text", text: "Project is valid." });
      expect(result.assistantText.join("")).toBe("Project is valid.");
    } finally {
      bridge.close();
    }
  });
});

describe("Claude Agent SDK adapter", () => {
  it("disables built-in tools, persistence, settings, and denies out-of-scope calls", async () => {
    const root = tempRoot();
    process.env.TOWERFORGE_USER_DATA_DIR = path.join(root, "user-data");
    let capturedOptions;
    const fakeSdk = {
      tool: (name, _description, _shape, handler) => ({ name, handler }),
      createSdkMcpServer: ({ tools }) => ({ type: "sdk", name: "towerforge", instance: { tools } }),
      query: ({ options }) => {
        capturedOptions = options;
        return (async function* () {
          const selected = options.mcpServers.towerforge.instance.tools.find((tool) => tool.name === "validate_project");
          await selected.handler({ projectDir: "/outside/project" });
          yield { type: "assistant", message: { content: [{ type: "text", text: "Claude validated it." }] } };
          yield { type: "result", subtype: "success", is_error: false };
        })();
      }
    };
    const calls = [];
    const bridge = new AgentRuntimeBridge(bridgeOptions(root, {
      callTool: async (name, input) => { calls.push({ name, input }); return { ok: true }; },
      claudeSdkLoader: async () => fakeSdk
    }));

    try {
      const events = [];
      await bridge.runChat({
        provider: "claude-code",
        model: "sonnet",
        history: [{ role: "user", content: "Validate" }],
        send: (event) => events.push(event),
        signal: new AbortController().signal
      });
      expect(calls[0].input.projectDir).toBe(path.join(root, "game.tdproj"));
      expect(capturedOptions.tools).toEqual([]);
      expect(capturedOptions.settingSources).toEqual([]);
      expect(capturedOptions.persistSession).toBe(false);
      await expect(capturedOptions.canUseTool("Read", { file_path: "/etc/passwd" })).resolves.toMatchObject({ behavior: "deny", interrupt: true });
      await expect(capturedOptions.canUseTool("mcp__towerforge__validate_project", {})).resolves.toMatchObject({ behavior: "allow" });
      expect(events).toContainEqual({ type: "text", text: "Claude validated it." });
    } finally {
      bridge.close();
    }
  });
});
