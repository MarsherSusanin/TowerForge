import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { restorePackedExecutable } from "../../cli/lib/packed-executable.mjs";
import { AI_TOOL_NAMES } from "./ai-tool-policy.mjs";

const RUNTIME_PROVIDERS = new Set(["codex", "claude-code"]);
const MODEL_ID_RE = /^[A-Za-z0-9~][A-Za-z0-9._:/~+@-]{0,199}$/;
const MAX_RPC_LINE_BYTES = 2 * 1024 * 1024;
const MAX_RUNTIME_OUTPUT_BYTES = 64 * 1024;
const MAX_TOOL_RESULT_CHARS = 24_000;
const RPC_TIMEOUT_MS = 30_000;
const TURN_TIMEOUT_MS = 10 * 60_000;
const AUTH_URL_HOSTS = new Set(["auth.openai.com", "chatgpt.com", "platform.openai.com"]);
const PASSTHROUGH_ENV = [
  "USER", "LOGNAME", "PATH", "LANG", "LC_ALL", "SHELL",
  "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR",
  "SSL_CERT_FILE", "SSL_CERT_DIR"
];

export const AGENT_RUNTIME_TOOL_NAMES = AI_TOOL_NAMES;

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* Windows and managed filesystems may ignore POSIX modes. */ }
}

function safeString(value, max = 400) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export function redactRuntimeText(value, { projectDir = "", maxLength = 800 } = {}) {
  let text = String(value || "");
  text = text
    .replace(/\b(Authorization|access[_ -]?token|refresh[_ -]?token)\s*[:=]?\s*(?:Bearer\s+)?[^\s,;]+/gi, "$1 [redacted]")
    .replace(/\b(?:sk|sess|oauth|token)-[A-Za-z0-9._~-]{12,}\b/gi, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]");
  if (projectDir) text = text.split(projectDir).join("<project>");
  const home = os.homedir();
  if (home) text = text.split(home).join("~");
  return text.slice(0, maxLength);
}

export function isAllowedRuntimeAuthUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && AUTH_URL_HOSTS.has(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function runtimeChildEnv(kind, configDir, source = process.env) {
  const env = {};
  for (const key of PASSTHROUGH_ENV) {
    if (typeof source[key] === "string" && source[key]) env[key] = source[key];
  }
  if (process.platform === "win32") {
    env.USERPROFILE = configDir;
    env.APPDATA = path.join(configDir, "AppData", "Roaming");
    env.LOCALAPPDATA = path.join(configDir, "AppData", "Local");
  } else {
    env.HOME = configDir;
  }
  env.NO_PROXY = "127.0.0.1,localhost";
  env.no_proxy = env.NO_PROXY;
  if (kind === "codex") {
    env.CODEX_HOME = configDir;
  } else {
    env.CLAUDE_CONFIG_DIR = configDir;
    env.CLAUDE_AGENT_SDK_CLIENT_APP = "towerforge-studio/0.1.0";
    env.DISABLE_TELEMETRY = "1";
    env.DISABLE_AUTOUPDATER = "1";
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  }
  return env;
}

function runtimeBaseDir(source = process.env) {
  const configured = source["TOWERFORGE_USER_DATA_DIR"];
  if (configured && path.isAbsolute(configured)) return path.join(configured, "agent-runtimes");
  return path.join(os.homedir(), ".towerforge", "agent-runtimes");
}

function executableOverride(name) {
  const value = process.env[name];
  if (!value) return null;
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path.`);
  if (!fs.existsSync(value)) throw new Error(`${name} does not exist.`);
  return value;
}

function codexLaunch(repoRoot) {
  const override = executableOverride("TOWERFORGE_CODEX_BIN");
  if (override) {
    return /\.(?:c?js|mjs)$/i.test(override)
      ? { command: process.execPath, prefixArgs: [override] }
      : { command: override, prefixArgs: [] };
  }
  const wrapper = path.join(repoRoot, "node_modules", "@openai", "codex", "bin", "codex.js");
  if (fs.existsSync(wrapper)) return { command: process.execPath, prefixArgs: [wrapper] };
  return { command: "codex", prefixArgs: [] };
}

function claudeExecutable(repoRoot, destinationDir) {
  const override = executableOverride("TOWERFORGE_CLAUDE_BIN");
  if (override) return override;
  const platform = process.platform;
  const arch = process.arch;
  const suffix = platform === "win32" ? ".exe" : "";
  const packageName = `claude-agent-sdk-${platform}-${arch}`;
  const candidate = path.join(repoRoot, "node_modules", "@anthropic-ai", packageName, `claude${suffix}`);
  if (fs.existsSync(candidate)) return candidate;
  const packed = `${candidate}.towerforge-packed`;
  return fs.existsSync(packed) ? restorePackedExecutable(packed, destinationDir) : null;
}

function writeCodexConfig(configDir) {
  ensurePrivateDir(configDir);
  const configPath = path.join(configDir, "config.toml");
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, 'cli_auth_credentials_store = "keyring"\n\n[analytics]\nenabled = false\n', { mode: 0o600 });
  }
}

function appendBounded(current, chunk) {
  const next = current + String(chunk);
  return next.length > MAX_RUNTIME_OUTPUT_BYTES ? next.slice(-MAX_RUNTIME_OUTPUT_BYTES) : next;
}

function runRuntimeCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stdout, stderr });
    };
    child.stdout?.on("data", (chunk) => { stdout = appendBounded(stdout, chunk); });
    child.stderr?.on("data", (chunk) => { stderr = appendBounded(stderr, chunk); });
    child.once("error", (error) => finish({ code: 127, error }));
    child.once("close", (code) => finish({ code: code ?? 1 }));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ code: 124, error: new Error("Runtime command timed out.") });
    }, timeoutMs);
  });
}

class JsonLineRpcClient {
  constructor({ launch, cwd, env, projectDir }) {
    this.launch = launch;
    this.cwd = cwd;
    this.env = env;
    this.projectDir = projectDir;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.serverRequestHandler = null;
    this.startPromise = null;
    this.stderr = "";
  }

  async start() {
    if (this.child && !this.child.killed) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#start();
    try { await this.startPromise; }
    finally { this.startPromise = null; }
  }

  async #start() {
    const args = [...this.launch.prefixArgs, "app-server", "--listen", "stdio://"];
    const child = spawn(this.launch.command, args, {
      cwd: this.cwd,
      env: this.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    this.stderr = "";
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_RPC_LINE_BYTES) {
        this.#failAll(new Error("Codex App Server sent an oversized message."));
        child.kill("SIGTERM");
        return;
      }
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try { this.#handleMessage(JSON.parse(line)); }
        catch { /* Malformed runtime output is ignored and never reflected to the browser. */ }
      }
    });
    child.stderr.on("data", (chunk) => { this.stderr = appendBounded(this.stderr, chunk); });
    child.once("error", (error) => this.#failAll(error));
    child.once("close", () => {
      if (this.child === child) this.child = null;
      this.#failAll(new Error("Codex App Server stopped unexpectedly."));
    });

    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    await this.request("initialize", {
      clientInfo: { name: "towerforge_studio", title: "TowerForge Studio", version: "0.1.0" },
      capabilities: { experimentalApi: true }
    });
    this.notify("initialized", {});
  }

  #write(message) {
    if (!this.child?.stdin?.writable) throw new Error("Codex App Server is unavailable.");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  notify(method, params = {}) {
    this.#write({ method, params });
  }

  request(method, params = {}, timeoutMs = RPC_TIMEOUT_MS) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server request timed out: ${method}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.#write({ id, method, params }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  onNotification(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async #handleMessage(message) {
    if (message && Object.hasOwn(message, "id") && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(redactRuntimeText(message.error.message || "Codex App Server request failed.", { projectDir: this.projectDir })));
      else pending.resolve(message.result);
      return;
    }
    if (message && Object.hasOwn(message, "id") && message.method) {
      try {
        if (!this.serverRequestHandler) throw new Error("Runtime request is not supported.");
        const result = await this.serverRequestHandler(message.method, message.params || {});
        this.#write({ id: message.id, result });
      } catch (error) {
        this.#write({ id: message.id, error: { code: -32000, message: redactRuntimeText(error?.message || error, { projectDir: this.projectDir }) } });
      }
      return;
    }
    if (message?.method) {
      for (const listener of this.listeners) listener(message.method, message.params || {});
    }
  }

  #failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    const child = this.child;
    this.child = null;
    this.#failAll(new Error("Codex App Server closed."));
    if (!child || child.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, 2_000);
      child.once("close", finish);
      child.once("error", finish);
      child.kill("SIGTERM");
    });
  }
}

function jsonSchemaValue(schema = {}) {
  if (!schema || typeof schema !== "object") return z.unknown();
  let value;
  if (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every((item) => typeof item === "string")) {
    value = z.enum(schema.enum);
  } else if (schema.type === "string") value = z.string();
  else if (schema.type === "number") value = z.number().finite();
  else if (schema.type === "integer") value = z.number().int();
  else if (schema.type === "boolean") value = z.boolean();
  else if (schema.type === "array") value = z.array(jsonSchemaValue(schema.items || {}));
  else if (schema.type === "object" || schema.properties) {
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const shape = {};
    for (const [key, child] of Object.entries(schema.properties || {})) {
      const childValue = jsonSchemaValue(child);
      shape[key] = required.has(key) ? childValue : childValue.optional();
    }
    value = z.object(shape);
    if (schema.additionalProperties !== false) value = value.passthrough();
  } else value = z.unknown();
  return schema.description ? value.describe(schema.description) : value;
}

export function jsonSchemaToZodShape(schema = {}) {
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const shape = {};
  for (const [key, child] of Object.entries(schema.properties || {})) {
    const value = jsonSchemaValue(child);
    shape[key] = required.has(key) ? value : value.optional();
  }
  return shape;
}

function historyPrompt(history) {
  return history
    .map((message) => `${message.role === "assistant" ? "ASSISTANT" : "USER"}: ${safeString(message.content, 50_000)}`)
    .join("\n\n");
}

function normalizedReasoningLevels(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => safeString(item?.reasoningEffort ?? item, 20)).filter(Boolean))];
}

function parseClaudeStatus(output) {
  let value = null;
  try { value = JSON.parse(output); } catch { /* Older runtimes can return plain text. */ }
  const connected = Boolean(value?.loggedIn ?? value?.authenticated ?? /logged in|authenticated/i.test(output));
  const method = safeString(value?.authMethod || value?.auth_method || value?.credentialSource, 80);
  const subscription = safeString(value?.subscriptionType || value?.subscription_type || value?.plan, 80);
  return { connected, method: method || (connected ? "claude.ai" : null), subscription: subscription || null };
}

export class AgentRuntimeBridge {
  constructor({ projectDir, repoRoot, tools, callTool, systemPrompt, summarizeToolResult, writeTools, claudeSdkLoader } = {}) {
    this.projectDir = projectDir;
    this.repoRoot = repoRoot;
    this.systemPrompt = systemPrompt;
    this.callTool = callTool;
    this.summarizeToolResult = summarizeToolResult;
    this.writeTools = writeTools;
    this.claudeSdkLoader = claudeSdkLoader || (() => import("@anthropic-ai/claude-agent-sdk"));
    this.toolMap = new Map((tools || []).filter((tool) => AGENT_RUNTIME_TOOL_NAMES.includes(tool.name)).map((tool) => [tool.name, tool]));
    this.baseDir = runtimeBaseDir();
    this.codexHome = path.join(this.baseDir, "codex");
    this.claudeHome = path.join(this.baseDir, "claude");
    this.workspace = path.join(this.baseDir, "workspace");
    this.codex = null;
    this.codexTurns = new Map();
    this.claudeLogin = null;
    this.activeAborts = new Set();
  }

  #prepareRuntime(provider) {
    ensurePrivateDir(this.baseDir);
    ensurePrivateDir(this.workspace);
    if (provider === "codex") writeCodexConfig(this.codexHome);
    else ensurePrivateDir(this.claudeHome);
  }

  #provider(value) {
    const provider = String(value || "").trim().toLowerCase();
    if (!RUNTIME_PROVIDERS.has(provider)) throw new Error("Unsupported account runtime.");
    return provider;
  }

  #claudeExecutable() {
    return claudeExecutable(this.repoRoot, path.join(this.baseDir, "bin"));
  }

  async #codexClient() {
    this.#prepareRuntime("codex");
    if (!this.codex) {
      this.codex = new JsonLineRpcClient({
        launch: codexLaunch(this.repoRoot),
        cwd: this.workspace,
        env: runtimeChildEnv("codex", this.codexHome),
        projectDir: this.projectDir
      });
      this.codex.serverRequestHandler = (method, params) => this.#handleCodexRequest(method, params);
    }
    await this.codex.start();
    return this.codex;
  }

  async status(value) {
    const provider = this.#provider(value);
    try {
      if (provider === "codex") {
        const client = await this.#codexClient();
        const result = await client.request("account/read", { refreshToken: false });
        const account = result?.account;
        return {
          provider,
          available: true,
          connected: account?.type === "chatgpt",
          method: account?.type === "chatgpt" ? "ChatGPT OAuth" : null,
          subscription: safeString(account?.planType, 80) || null
        };
      }
      const executable = this.#claudeExecutable();
      if (!executable) return { provider, available: false, connected: false, error: "Claude Code runtime is not installed." };
      this.#prepareRuntime("claude-code");
      const result = await runRuntimeCommand(executable, ["auth", "status", "--json"], {
        cwd: this.workspace,
        env: runtimeChildEnv("claude", this.claudeHome),
        timeoutMs: 10_000
      });
      const status = parseClaudeStatus(result.stdout);
      return { provider, available: result.code !== 127, ...status };
    } catch (error) {
      return { provider, available: false, connected: false, error: redactRuntimeText(error?.message || error, { projectDir: this.projectDir }) };
    }
  }

  async models(value) {
    const provider = this.#provider(value);
    if (provider === "codex") {
      const client = await this.#codexClient();
      const result = await client.request("model/list", { limit: 100, includeHidden: false });
      const models = (Array.isArray(result?.data) ? result.data : [])
        .map((entry) => {
          const id = safeString(entry?.model || entry?.id, 200);
          if (!MODEL_ID_RE.test(id)) return null;
          return {
            id,
            label: safeString(entry?.displayName, 120) || id,
            description: safeString(entry?.description, 300) || null,
            reasoningLevels: normalizedReasoningLevels(entry?.supportedReasoningEfforts),
            defaultReasoning: safeString(entry?.defaultReasoningEffort, 20) || null,
            inputModalities: Array.isArray(entry?.inputModalities) ? entry.inputModalities.filter((item) => item === "text" || item === "image") : ["text", "image"],
            isDefault: Boolean(entry?.isDefault)
          };
        })
        .filter(Boolean);
      return { provider, models };
    }

    const executable = this.#claudeExecutable();
    if (!executable) throw new Error("Claude Code runtime is not installed.");
    this.#prepareRuntime("claude-code");
    const sdk = await this.claudeSdkLoader();
    const query = sdk.query({
      prompt: "",
      options: this.#claudeBaseOptions(executable)
    });
    try {
      const entries = await query.supportedModels();
      const models = (Array.isArray(entries) ? entries : [])
        .map((entry) => {
          const id = safeString(entry?.value, 200);
          if (!MODEL_ID_RE.test(id)) return null;
          return {
            id,
            label: safeString(entry?.displayName, 120) || id,
            description: safeString(entry?.description, 300) || null,
            reasoningLevels: Array.isArray(entry?.supportedEffortLevels) ? entry.supportedEffortLevels.filter((item) => typeof item === "string") : [],
            defaultReasoning: entry?.supportsEffort ? "high" : null,
            inputModalities: ["text", "image"],
            isDefault: id === "sonnet"
          };
        })
        .filter(Boolean);
      return { provider, models };
    } finally {
      query.close();
    }
  }

  async connect(value) {
    const provider = this.#provider(value);
    if (provider === "codex") {
      const client = await this.#codexClient();
      const result = await client.request("account/login/start", {
        type: "chatgpt",
        appBrand: "codex",
        useHostedLoginSuccessPage: true
      });
      if (result?.type !== "chatgpt" || !isAllowedRuntimeAuthUrl(result.authUrl)) {
        throw new Error("Codex returned an invalid authentication URL.");
      }
      return { provider, started: true, authUrl: result.authUrl };
    }

    const executable = this.#claudeExecutable();
    if (!executable) throw new Error("Claude Code runtime is not installed.");
    this.#prepareRuntime("claude-code");
    if (this.claudeLogin && this.claudeLogin.exitCode === null) return { provider, started: true };
    const child = spawn(executable, ["auth", "login"], {
      cwd: this.workspace,
      env: runtimeChildEnv("claude", this.claudeHome),
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"]
    });
    this.claudeLogin = child;
    child.once("close", () => { if (this.claudeLogin === child) this.claudeLogin = null; });
    child.once("error", () => { if (this.claudeLogin === child) this.claudeLogin = null; });
    return { provider, started: true };
  }

  async disconnect(value) {
    const provider = this.#provider(value);
    if (provider === "codex") {
      const client = await this.#codexClient();
      await client.request("account/logout", {});
      return { provider, connected: false };
    }
    const executable = this.#claudeExecutable();
    if (!executable) throw new Error("Claude Code runtime is not installed.");
    this.#prepareRuntime("claude-code");
    const result = await runRuntimeCommand(executable, ["auth", "logout"], {
      cwd: this.workspace,
      env: runtimeChildEnv("claude", this.claudeHome),
      timeoutMs: 20_000
    });
    if (result.code !== 0) throw new Error("Claude Code could not sign out.");
    return { provider, connected: false };
  }

  async #executeTool(name, input, send, allowedToolNames = null) {
    if (!this.toolMap.has(name) || (allowedToolNames && !allowedToolNames.has(name))) {
      throw new Error("Tool is not allowed by TowerForge in this mode.");
    }
    const id = `${name}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const safeInput = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    send({ type: "tool_call", id, name, input: safeInput });
    try {
      const result = await this.callTool(name, { ...safeInput, projectDir: this.projectDir }, { defaultProjectDir: this.projectDir });
      const appliedPatch = this.writeTools.has(name) && result?.written !== false;
      const raw = JSON.stringify(result);
      const sanitizedText = redactRuntimeText(raw, {
        projectDir: this.projectDir,
        maxLength: raw.length + 1
      });
      let sanitized = result;
      try { sanitized = JSON.parse(sanitizedText); } catch { /* Keep the original shape only if serialization itself was invalid. */ }
      const serialized = JSON.stringify(sanitized).slice(0, MAX_TOOL_RESULT_CHARS);
      send({ type: "tool_result", id, name, ok: true, summary: this.summarizeToolResult(name, sanitized) });
      return { result: sanitized, serialized, appliedPatch };
    } catch (error) {
      const message = redactRuntimeText(error?.message || error, { projectDir: this.projectDir });
      send({ type: "tool_result", id, name, ok: false, summary: { error: message } });
      return { result: { error: message }, serialized: JSON.stringify({ error: message }), appliedPatch: false, isError: true };
    }
  }

  async #handleCodexRequest(method, params) {
    if (method !== "item/tool/call") throw new Error("TowerForge declines unsupported runtime requests.");
    const context = this.codexTurns.get(params.threadId);
    if (!context || params.namespace !== "towerforge" || !this.toolMap.has(params.tool)) {
      throw new Error("TowerForge declined an out-of-scope tool call.");
    }
    const executed = await this.#executeTool(params.tool, params.arguments, context.send, context.allowedToolNames);
    context.appliedPatch ||= executed.appliedPatch;
    return {
      success: !executed.isError,
      contentItems: [{ type: "inputText", text: executed.serialized }]
    };
  }

  async runChat({ provider: value, model, reasoning, attachments = [], history, send, signal, allowedToolNames }) {
    const provider = this.#provider(value);
    const allowed = new Set((allowedToolNames ?? [...this.toolMap.keys()]).filter((name) => this.toolMap.has(name)));
    if (provider === "codex") return this.#runCodexChat({ model, reasoning, attachments, history, send, signal, allowedToolNames: allowed });
    return this.#runClaudeChat({ model, reasoning, attachments, history, send, signal, allowedToolNames: allowed });
  }

  #codexAttachmentInputs(attachments) {
    if (!attachments.length) return { inputs: [], cleanup: () => {} };
    const dir = fs.mkdtempSync(path.join(this.workspace, "turn-attachments-"));
    try { fs.chmodSync(dir, 0o700); } catch { /* best effort on non-POSIX filesystems */ }
    const extensions = { "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp" };
    const inputs = attachments.map((attachment, index) => {
      const filePath = path.join(dir, `image-${index + 1}${extensions[attachment.mimeType] || ".img"}`);
      fs.writeFileSync(filePath, Buffer.from(attachment.data, "base64"), { mode: 0o600 });
      return { type: "localImage", path: filePath };
    });
    return { inputs, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  }

  async #runCodexChat({ model, reasoning, attachments, history, send, signal, allowedToolNames }) {
    const client = await this.#codexClient();
    const dynamicTools = [{
      type: "namespace",
      name: "towerforge",
      description: "Validated TowerForge project inspection, simulation, and authoring tools.",
      tools: [...this.toolMap.values()].filter((entry) => allowedToolNames.has(entry.name)).map((entry) => ({
        type: "function",
        name: entry.name,
        description: entry.description,
        inputSchema: entry.inputSchema,
        deferLoading: false
      }))
    }];
    const params = {
      baseInstructions: this.systemPrompt,
      developerInstructions: "Use only the towerforge dynamic tools. Do not use shell, filesystem, web, plugins, skills, or MCP. The working directory is intentionally isolated.",
      cwd: this.workspace,
      sandbox: "read-only",
      approvalPolicy: "never",
      ephemeral: true,
      dynamicTools
    };
    if (model && model !== "default") params.model = model;
    const started = await client.request("thread/start", params);
    const threadId = started?.thread?.id;
    if (!threadId) throw new Error("Codex App Server did not create a thread.");
    const context = { send, appliedPatch: false, assistantText: [], allowedToolNames };
    this.codexTurns.set(threadId, context);
    let turnId = null;

    const materialized = this.#codexAttachmentInputs(attachments);
    try {
      let stop = () => {};
      let abort = () => {};
      const resultPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Codex turn timed out.")), TURN_TIMEOUT_MS);
        stop = client.onNotification((method, notification) => {
          if (notification.threadId !== threadId) return;
          if (method === "item/agentMessage/delta" && notification.delta) {
            context.assistantText.push(notification.delta);
            send({ type: "text", text: notification.delta });
          }
          if (method === "turn/completed") {
            clearTimeout(timer);
            stop();
            if (notification.turn?.status === "failed") reject(new Error("Codex could not complete the turn."));
            else resolve(notification.turn || {});
          }
        });
        abort = () => {
          clearTimeout(timer);
          stop();
          if (turnId) client.request("turn/interrupt", { threadId, turnId }).catch(() => {});
          reject(new DOMException("Stopped", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
      });
      try {
        let turn;
        try {
          turn = await client.request("turn/start", {
            threadId,
            input: [{ type: "text", text: historyPrompt(history), text_elements: [] }, ...materialized.inputs],
            cwd: this.workspace,
            ...(reasoning ? { effort: reasoning } : {}),
            approvalPolicy: "never",
            sandboxPolicy: {
              type: "readOnly",
              access: {
                type: "restricted",
                includePlatformDefaults: true,
                readableRoots: [this.workspace]
              }
            }
          });
        } catch (error) {
          abort();
          await resultPromise.catch(() => {});
          throw error;
        }
        turnId = turn?.turn?.id || null;
        const result = await resultPromise;
        return { assistantText: context.assistantText, appliedPatch: context.appliedPatch, runtimeResult: result };
      } finally {
        stop();
        signal?.removeEventListener("abort", abort);
      }
    } finally {
      materialized.cleanup();
      this.codexTurns.delete(threadId);
    }
  }

  #claudeBaseOptions(executable) {
    return {
      cwd: this.workspace,
      env: runtimeChildEnv("claude", this.claudeHome),
      pathToClaudeCodeExecutable: executable,
      tools: [],
      disallowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch", "Task", "NotebookEdit", "Skill"],
      strictMcpConfig: true,
      settingSources: [],
      skills: [],
      plugins: [],
      persistSession: false
    };
  }

  async #runClaudeChat({ model, reasoning, attachments, history, send, signal, allowedToolNames }) {
    const executable = this.#claudeExecutable();
    if (!executable) throw new Error("Claude Code runtime is not installed.");
    this.#prepareRuntime("claude-code");
    const sdk = await this.claudeSdkLoader();
    const allowedNames = new Set([...allowedToolNames].map((name) => `mcp__towerforge__${name}`));
    const state = { appliedPatch: false };
    const sdkTools = [...this.toolMap.values()].filter((entry) => allowedToolNames.has(entry.name)).map((entry) => sdk.tool(
      entry.name,
      entry.description,
      jsonSchemaToZodShape(entry.inputSchema),
      async (input) => {
        const executed = await this.#executeTool(entry.name, input, send, allowedToolNames);
        state.appliedPatch ||= executed.appliedPatch;
        return { content: [{ type: "text", text: executed.serialized }], isError: Boolean(executed.isError) };
      },
      { alwaysLoad: true }
    ));
    const server = sdk.createSdkMcpServer({
      name: "towerforge",
      version: "0.1.0",
      instructions: "Use these validated tools for all TowerForge project reads and writes.",
      tools: sdkTools,
      alwaysLoad: true
    });
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    signal?.addEventListener("abort", abort, { once: true });
    this.activeAborts.add(abortController);
    const assistantText = [];
    try {
      const promptText = historyPrompt(history);
      const prompt = attachments.length ? (async function* () {
        yield {
          type: "user",
          message: {
            role: "user",
            content: [
              { type: "text", text: promptText },
              ...attachments.map((attachment) => ({
                type: "image",
                source: { type: "base64", media_type: attachment.mimeType, data: attachment.data }
              }))
            ]
          },
          parent_tool_use_id: null
        };
      })() : promptText;
      const stream = sdk.query({
        prompt,
        options: {
          ...this.#claudeBaseOptions(executable),
          abortController,
          model: model && model !== "default" ? model : undefined,
          effort: reasoning || undefined,
          systemPrompt: this.systemPrompt,
          allowedTools: [...allowedNames],
          canUseTool: async (toolName, input) => allowedNames.has(toolName)
            ? { behavior: "allow", updatedInput: input }
            : { behavior: "deny", message: "TowerForge only permits its validated in-process tools.", interrupt: true },
          mcpServers: { towerforge: server },
          maxTurns: 16,
          includePartialMessages: false
        }
      });
      for await (const message of stream) {
        if (message?.type === "assistant") {
          if (message.error) throw new Error(`Claude Code: ${message.error}.`);
          for (const block of Array.isArray(message.message?.content) ? message.message.content : []) {
            if (block?.type === "text" && block.text) {
              assistantText.push(block.text);
              send({ type: "text", text: block.text });
            }
          }
        }
        if (message?.type === "result" && message.is_error) {
          throw new Error("Claude Code could not complete the turn.");
        }
      }
      return { assistantText, appliedPatch: state.appliedPatch };
    } finally {
      signal?.removeEventListener("abort", abort);
      this.activeAborts.delete(abortController);
    }
  }

  close() {
    const codexClose = this.codex?.close() ?? Promise.resolve();
    this.codex = null;
    this.claudeLogin?.kill("SIGTERM");
    this.claudeLogin = null;
    for (const controller of this.activeAborts) controller.abort();
    this.activeAborts.clear();
    return codexClose;
  }
}

export function createAgentRuntimeBridge(options) {
  return new AgentRuntimeBridge(options);
}
