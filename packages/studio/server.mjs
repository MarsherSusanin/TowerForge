#!/usr/bin/env node
/**
 * TowerForge Editor server
 * Pure Node.js, no external dependencies.
 *
 * Usage:
 *   node server.mjs [--project <path>]
 *   PROJECT_DIR=<path> node server.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  loadEngine,
  loadProjectFiles,
  projectSummary,
  resolveProjectDir,
  runBalanceSweepForProject,
  runMissionSmoke,
  validateProjectDir
} from "../cli/lib/project-loader.mjs";
import { importProjectAsset } from "../cli/lib/assets.mjs";
import { compileMapSources, writeCompiledMaps, writeMapSource } from "../cli/lib/map-compiler.mjs";
import { normalizeVisuals } from "../cli/lib/project-schema.mjs";
import { agentClientConfigs, writeProjectClientConfig } from "../cli/lib/agent-connect.mjs";
import { writeRunTrace } from "../cli/lib/trace.mjs";
import { TOOLS, callTool } from "../mcp/tools.mjs";
import { createAgentRuntimeBridge } from "./lib/agent-runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(process.env["TOWERFORGE_RUNTIME_ROOT"] || path.resolve(__dirname, "../.."));
const DESKTOP_MODE = process.env["TOWERFORGE_DESKTOP"] === "1";
const DESKTOP_SESSION_TOKEN = process.env["TOWERFORGE_SESSION_TOKEN"] || "";

// ── Project resolution ────────────────────────────────────────────────────────
// Shares the canonical resolver with the CLI loader so behavior stays in sync.

const PROJECT_DIR = resolveProjectDir(null, process.argv.slice(2));
const CONTENT_DIR = path.join(PROJECT_DIR, "content");
const MAPS_DIR = path.join(PROJECT_DIR, "maps", "compiled");
const MAPS_SRC_DIR = path.join(PROJECT_DIR, "maps", "src");
const SESSION_DIR = path.join(PROJECT_DIR, ".towerforge");
const MCP_JSON_PATH = path.join(PROJECT_DIR, ".mcp.json");
const MCP_SERVER_PATH = path.join(repoRoot, "packages", "mcp", "server.mjs");
const MCP_SERVER_KEY = "towerforge-ai";
const PORT = parseInt(process.env["PORT"] ?? "5174", 10);
let ACTIVE_PORT = Number.isFinite(PORT) ? PORT : 5174;
const PUBLIC_DIR = path.join(repoRoot, "packages", "studio", "public");

function loadAppInfo() {
  try {
    const packageInfo = readJson(path.join(repoRoot, "package.json"));
    const repository = typeof packageInfo.repository === "string" ? packageInfo.repository : packageInfo.repository?.url;
    return {
      name: "TowerForge Studio",
      version: packageInfo.version || "0.1.0",
      studioName: packageInfo.towerforge?.studioName || "Lindforge Studios",
      sourceUrl: String(repository || "https://github.com/MarsherSusanin/TowerForge").replace(/^git\+/, "").replace(/\.git$/, ""),
      siteUrl: packageInfo.homepage || "https://lindforge.com",
      telegramUrl: packageInfo.towerforge?.telegram || "https://t.me/lindforge"
    };
  } catch {
    return {
      name: "TowerForge Studio",
      version: "0.1.0",
      studioName: "Lindforge Studios",
      sourceUrl: "https://github.com/MarsherSusanin/TowerForge",
      siteUrl: "https://lindforge.com",
      telegramUrl: "https://t.me/lindforge"
    };
  }
}

// ── File helpers ──────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonAtomic(filePath, data) {
  const tmp = filePath + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

/** Content-hash guard: SHA-256 of the raw file bytes. */
function fileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

/** Combined hash across all mutable content files. */
function projectHash() {
  const files = listMutableProjectFiles();
  const h = createHash("sha256");
  for (const f of files) {
    try { h.update(f + ":"); h.update(fs.readFileSync(f)); h.update(";"); }
    catch { h.update(f + ":missing;"); }
  }
  return h.digest("hex").slice(0, 20);
}

function listMutableProjectFiles() {
  const files = [
    path.join(PROJECT_DIR, "project.json"),
    path.join(CONTENT_DIR, "balance.json"),
    path.join(CONTENT_DIR, "visuals.json"),
    path.join(MAPS_DIR, "maps.json"),
    path.join(CONTENT_DIR, "world-map.json"),
    path.join(PROJECT_DIR, "build-targets.json"),
  ];
  if (fs.existsSync(MAPS_SRC_DIR)) {
    for (const entry of fs.readdirSync(MAPS_SRC_DIR, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".tmj")) files.push(path.join(MAPS_SRC_DIR, entry.name));
    }
  }
  return files.sort();
}

function backupFile(filePath) {
  ensureDir(SESSION_DIR);
  const dest = path.join(SESSION_DIR, path.basename(filePath) + ".bak");
  try { fs.copyFileSync(filePath, dest); } catch { /* ignore */ }
}

// ── Project loader ────────────────────────────────────────────────────────────

function loadProject() {
  return {
    ...projectSummary(loadProjectFiles(PROJECT_DIR)),
    contentHash: projectHash(),
  };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function serveStatic(res, filePath, extraHeaders = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js":   "text/javascript; charset=utf-8",
    ".mjs":  "text/javascript; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".ico":  "image/x-icon",
    ".png":  "image/png",
    ".svg":  "image/svg+xml",
  };
  const ct = types[ext] ?? "application/octet-stream";
  const securityHeaders = ext === ".html" ? {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "X-Content-Type-Options": "nosniff"
  } : {};
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": ct, "Cache-Control": "no-store", ...securityHeaders, ...extraHeaders });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

function jsonResp(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type":  "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

// ── Origin/Host guard ─────────────────────────────────────────────────────────
// This server binds 127.0.0.1 and writes project files on POST, so any web page open in the
// same browser could otherwise drive it via a blind fetch() (classic drive-by-localhost /
// DNS-rebinding). Since the Studio UI only ever calls itself with same-origin relative fetch()
// paths (see public/app.js apiGet/apiPost), it needs no cross-origin support at all: reject
// anything whose Host doesn't name this exact server, and — when a browser sends one — whose
// Origin doesn't match either. No CORS headers are issued because no cross-origin caller is legitimate.
function isAllowedAuthority(value) {
  return value === `localhost:${ACTIVE_PORT}` || value === `127.0.0.1:${ACTIVE_PORT}`;
}

function originAllowed(req) {
  if (!isAllowedAuthority(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true; // non-browser client (curl, scripts) with no Origin header
  return origin === `http://localhost:${ACTIVE_PORT}` || origin === `http://127.0.0.1:${ACTIVE_PORT}`;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function desktopSessionAllowed(req) {
  if (!DESKTOP_MODE) return true;
  if (!DESKTOP_SESSION_TOKEN) return false;
  if (req.headers["x-towerforge-session"] === DESKTOP_SESSION_TOKEN) return true;
  return parseCookies(req.headers.cookie).tf_session === DESKTOP_SESSION_TOKEN;
}

function desktopSessionCookie() {
  return `tf_session=${encodeURIComponent(DESKTOP_SESSION_TOKEN)}; HttpOnly; SameSite=Strict; Path=/`;
}

const MAX_BODY_BYTES = 16 * 1024 * 1024; // cap request bodies so a runaway client can't exhaust memory

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error("Request body too large.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

/** Run a Node script without blocking the HTTP event loop. */
function runNodeScript(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: repoRoot });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ status: 1, stdout, stderr: error.message }));
    child.on("close", (code) => resolve({ status: code ?? 1, stdout, stderr }));
  });
}

// ── AI co-designer ──────────────────────────────────────────────────────────
// A Studio chat panel that drives the same tool surface the MCP exposes (author → simulate →
// diagnose → patch → re-simulate). Provider keys are passed per request and used only
// transiently here — never written to disk. Every tool runs against THIS server's project.

const AI_PROVIDERS = Object.freeze({
  anthropic: { label: "Anthropic", defaultModel: "claude-sonnet-5", auth: "apiKey" },
  openai: { label: "OpenAI", defaultModel: "gpt-5.6-terra", auth: "apiKey" },
  openrouter: { label: "OpenRouter", defaultModel: "openrouter/auto", auth: "apiKey" },
  codex: { label: "Codex (ChatGPT)", defaultModel: "default", auth: "runtime" },
  "claude-code": { label: "Claude Code", defaultModel: "sonnet", auth: "runtime" }
});
const AI_MAX_STEPS = 16;
const AI_MAX_HISTORY_MESSAGES = 40;
const AI_MAX_MESSAGE_CHARS = 50_000;
const AI_MODEL_ID_RE = /^[A-Za-z0-9~][A-Za-z0-9._:/~+@-]{0,199}$/;
const AI_SYSTEM_PROMPT = `You are the TowerForge AI co-designer, embedded in the TowerForge Editor. You help a game designer build and balance a hex tower-defense game by calling tools that inspect, simulate, diagnose, and patch the project on disk.

Loop you should run when asked to balance or improve a mission:
1. get_project_summary / list_missions to understand the content.
2. If you're about to author a NEW tower or enemy, call describe_schema first — attack kinds are a closed, engine-implemented set; get the exact required fields right on the first attempt instead of iterating against validate_project errors. For a NEW ability: the id space is open — a custom ability needs no engine code, just declare "effects" (see describe_schema's abilityEffects: damage, status) on it; only fall back to a bare path_water/strike/freeze preset id when no effects are declared.
3. balance_report to diagnose (win-rate, surviving core HP, tower usage, advisor flags like unwinnable/trivial/dominant-tower/weak-tower).
4. Prefer granular validated tools (set_enemy_stat, add_wave_group, upsert_tower, bind_sprite) or dry_run_balance_patch before apply_validated_patch. The engine is content-id-agnostic and deterministic — tune numbers, never assume specific ids.
5. balance_report again to verify, and iterate until the target is met (default: every mission winnable, win-rate roughly 50–85%, not trivial).
6. validate_project before finishing; report what you changed and why.

Rules: keep patches small and explain each one. Currencies are author-defined (coins is primary). Do not invent tools. When done, give a short summary of the changes and the resulting balance.`;

/** Map the MCP tool registry to Anthropic tool definitions. */
function anthropicToolDefs() {
  return TOOLS.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }));
}

/** Map the MCP tool registry to OpenAI-compatible function definitions. */
function openAiToolDefs() {
  return TOOLS.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false
  }));
}

/** OpenRouter uses the Chat Completions function wrapper. */
function openRouterToolDefs() {
  return openAiToolDefs().map(({ name, description, parameters }) => ({
    type: "function",
    function: { name, description, parameters }
  }));
}

// Overridable for local proxies / tests; defaults to each provider's public API.
const ANTHROPIC_BASE_URL = (process.env["ANTHROPIC_BASE_URL"] || "https://api.anthropic.com").replace(/\/$/, "");
const OPENAI_BASE_URL = (process.env["OPENAI_BASE_URL"] || "https://api.openai.com/v1").replace(/\/$/, "");
const OPENROUTER_BASE_URL = (process.env["OPENROUTER_BASE_URL"] || "https://openrouter.ai/api/v1").replace(/\/$/, "");

const AI_PROVIDER_TIMEOUT_MS = 120_000;
const OPENROUTER_CATALOG_TIMEOUT_MS = 15_000;
const OPENROUTER_CATALOG_TTL_MS = 10 * 60_000;
const AI_WRITE_TOOLS = new Set(["apply_balance_patch", "apply_validated_patch", "set_enemy_stat", "upsert_tower", "add_wave_group", "bind_sprite", "compile_maps"]);
let openRouterCatalogCache = { expiresAt: 0, models: [] };

function providerConfig(provider) {
  return AI_PROVIDERS[provider] ?? null;
}

function textFromAiContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && (part.type === "text" || part.type === "output_text"))
    .map((part) => String(part.text ?? ""))
    .filter(Boolean)
    .join("\n");
}

/** Keep browser history provider-neutral so changing providers starts from a safe text contract. */
function normalizeAiHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .slice(-AI_MAX_HISTORY_MESSAGES)
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: textFromAiContent(message.content).slice(0, AI_MAX_MESSAGE_CHARS)
    }))
    .filter((message) => message.content.trim());
}

async function providerJsonRequest({ providerLabel, url, headers, body, signal, timeoutMs = AI_PROVIDER_TIMEOUT_MS }) {
  const ctrl = new AbortController();
  const forwardAbort = () => ctrl.abort(signal?.reason);
  const timer = setTimeout(() => ctrl.abort(new Error(`${providerLabel} request timed out.`)), timeoutMs);
  if (signal) {
    if (signal.aborted) forwardAbort();
    else signal.addEventListener("abort", forwardAbort, { once: true });
  }

  let response;
  try {
    response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }

  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try { detail = JSON.parse(text)?.error?.message ?? JSON.parse(text)?.error ?? text; } catch { /* keep raw */ }
    throw new Error(`${providerLabel} API ${response.status}: ${String(detail).slice(0, 400)}`);
  }
  try { return JSON.parse(text); }
  catch { throw new Error(`${providerLabel} API returned invalid JSON.`); }
}

/** One non-streaming call to the Anthropic Messages API (zero-dep, uses global fetch). */
async function anthropicMessages({ apiKey, model, system, tools, messages, signal }) {
  return providerJsonRequest({
    providerLabel: "Anthropic",
    url: `${ANTHROPIC_BASE_URL}/v1/messages`,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: { model, max_tokens: 4096, system, tools, messages },
    signal
  });
}

/** One non-streaming call to OpenAI's Responses API. */
async function openAiResponse({ apiKey, model, input, signal }) {
  return providerJsonRequest({
    providerLabel: "OpenAI",
    url: `${OPENAI_BASE_URL}/responses`,
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`
    },
    body: {
      model,
      instructions: AI_SYSTEM_PROMPT,
      input,
      tools: openAiToolDefs(),
      max_output_tokens: 8192,
      parallel_tool_calls: true,
      store: false,
      include: ["reasoning.encrypted_content"]
    },
    signal
  });
}

/** One non-streaming call to OpenRouter's OpenAI-compatible Chat Completions API. */
async function openRouterCompletion({ apiKey, model, messages, signal }) {
  return providerJsonRequest({
    providerLabel: "OpenRouter",
    url: `${OPENROUTER_BASE_URL}/chat/completions`,
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
      "x-openrouter-title": "TowerForge"
    },
    body: {
      model,
      messages,
      tools: openRouterToolDefs(),
      parallel_tool_calls: true,
      max_tokens: 4096
    },
    signal
  });
}

async function openRouterModels() {
  if (openRouterCatalogCache.expiresAt > Date.now() && openRouterCatalogCache.models.length) {
    return openRouterCatalogCache.models;
  }
  const url = new URL(`${OPENROUTER_BASE_URL}/models`);
  url.searchParams.set("supported_parameters", "tools");
  url.searchParams.set("sort", "top-weekly");
  url.searchParams.set("limit", "200");
  const payload = await providerJsonRequest({
    providerLabel: "OpenRouter",
    url,
    headers: { "accept": "application/json" },
    timeoutMs: OPENROUTER_CATALOG_TIMEOUT_MS
  });
  const models = (Array.isArray(payload?.data) ? payload.data : [])
    .filter((model) => typeof model?.id === "string" && AI_MODEL_ID_RE.test(model.id))
    .filter((model) => !Array.isArray(model?.supported_parameters) || model.supported_parameters.includes("tools"))
    .filter((model) => !Array.isArray(model?.architecture?.output_modalities) || model.architecture.output_modalities.includes("text"))
    .map((model) => ({
      id: model.id,
      name: typeof model.name === "string" && model.name.trim() ? model.name.trim() : model.id,
      contextLength: Number.isFinite(model.context_length) ? model.context_length : null
    }));
  openRouterCatalogCache = { expiresAt: Date.now() + OPENROUTER_CATALOG_TTL_MS, models };
  return models;
}

/** Compact a tool result for the live transcript (avoid dumping huge objects to the UI). */
function summarizeToolResult(name, result) {
  if (!result || typeof result !== "object") return { value: result };
  if (name === "balance_report" && result.summary) return { summary: result.summary, missions: (result.missions ?? []).map((m) => ({ id: m.missionId, winRate: m.winRate, flags: m.flags })) };
  if (name === "validate_project" || result.validation) {
    const v = result.validation ?? result;
    return { ok: v.ok, errorCount: v.errorCount, warningCount: v.warningCount, applied: result.applied };
  }
  if (name === "simulate_mission") return { outcome: result.outcome, coreHp: result.coreHp, events: result.events };
  if (name === "get_project_summary") return { counts: result.counts, defaultMissionId: result.defaultMissionId };
  if (name === "list_missions") return { missions: (result.missions ?? []).map((m) => m.id) };
  const keys = Object.keys(result);
  return keys.length > 12 ? { keys } : result;
}

const agentRuntime = createAgentRuntimeBridge({
  projectDir: PROJECT_DIR,
  repoRoot,
  tools: TOOLS,
  callTool,
  systemPrompt: AI_SYSTEM_PROMPT,
  summarizeToolResult,
  writeTools: AI_WRITE_TOOLS
});

function parseToolArguments(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return {};
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Tool arguments must be a JSON object.");
  return parsed;
}

async function executeAiTools(send, toolUses) {
  const executions = [];
  let appliedPatch = false;
  for (const [index, use] of toolUses.entries()) {
    const id = String(use.id || `tool-${index}`);
    const name = String(use.name || "");
    let input = {};
    let result;
    let isError = false;
    let announced = false;
    try {
      input = parseToolArguments(use.input);
      send({ type: "tool_call", id, name, input });
      announced = true;
      result = await callTool(name, { ...input, projectDir: PROJECT_DIR }, { defaultProjectDir: PROJECT_DIR });
      if (AI_WRITE_TOOLS.has(name) && result?.written !== false) appliedPatch = true;
    } catch (error) {
      if (!announced) send({ type: "tool_call", id, name: name || "invalid_tool", input: {} });
      result = { error: error instanceof Error ? error.message : String(error) };
      isError = true;
    }
    send({ type: "tool_result", id, name, ok: !isError, summary: summarizeToolResult(name, result) });
    executions.push({
      id,
      name,
      result,
      isError,
      serialized: JSON.stringify(result).slice(0, 24_000)
    });
  }
  return { executions, appliedPatch };
}

async function runAnthropicAgent({ send, apiKey, model, history, signal }) {
  const convo = history.map((message) => ({ ...message }));
  const assistantText = [];
  let appliedPatch = false;
  for (let step = 0; step < AI_MAX_STEPS; step++) {
    const reply = await anthropicMessages({
      apiKey,
      model,
      system: AI_SYSTEM_PROMPT,
      tools: anthropicToolDefs(),
      messages: convo,
      signal
    });
    const content = Array.isArray(reply?.content) ? reply.content : [];
    convo.push({ role: "assistant", content });
    for (const block of content) {
      if (block?.type === "text" && block.text) {
        assistantText.push(block.text);
        send({ type: "text", text: block.text });
      }
    }
    const toolUses = content
      .filter((block) => block?.type === "tool_use")
      .map((block) => ({ id: block.id, name: block.name, input: block.input }));
    if (!toolUses.length) return { assistantText, appliedPatch };

    const executed = await executeAiTools(send, toolUses);
    appliedPatch ||= executed.appliedPatch;
    convo.push({
      role: "user",
      content: executed.executions.map((item) => ({
        type: "tool_result",
        tool_use_id: item.id,
        content: item.serialized,
        is_error: item.isError
      }))
    });
  }
  return { assistantText, appliedPatch, reachedLimit: true };
}

function openAiResponseText(output) {
  const texts = [];
  for (const item of Array.isArray(output) ? output : []) {
    if (item?.type !== "message") continue;
    const text = textFromAiContent(item.content);
    if (text) texts.push(text);
  }
  return texts;
}

async function runOpenAiAgent({ send, apiKey, model, history, signal }) {
  const input = history.map((message) => ({ ...message }));
  const assistantText = [];
  let appliedPatch = false;
  for (let step = 0; step < AI_MAX_STEPS; step++) {
    const reply = await openAiResponse({ apiKey, model, input, signal });
    const output = Array.isArray(reply?.output) ? reply.output : [];
    for (const text of openAiResponseText(output)) {
      assistantText.push(text);
      send({ type: "text", text });
    }
    const toolUses = output
      .filter((item) => item?.type === "function_call")
      .map((item) => ({ id: item.call_id || item.id, name: item.name, input: item.arguments }));
    input.push(...output);
    if (!toolUses.length) return { assistantText, appliedPatch };

    const executed = await executeAiTools(send, toolUses);
    appliedPatch ||= executed.appliedPatch;
    input.push(...executed.executions.map((item) => ({
      type: "function_call_output",
      call_id: item.id,
      output: item.serialized
    })));
  }
  return { assistantText, appliedPatch, reachedLimit: true };
}

async function runOpenRouterAgent({ send, apiKey, model, history, signal }) {
  const messages = [{ role: "system", content: AI_SYSTEM_PROMPT }, ...history.map((message) => ({ ...message }))];
  const assistantText = [];
  let appliedPatch = false;
  for (let step = 0; step < AI_MAX_STEPS; step++) {
    const reply = await openRouterCompletion({ apiKey, model, messages, signal });
    const choice = reply?.choices?.[0];
    const message = choice?.message;
    if (!message || typeof message !== "object") throw new Error("OpenRouter API returned no assistant message.");
    messages.push(message);
    const text = textFromAiContent(message.content);
    if (text) {
      assistantText.push(text);
      send({ type: "text", text });
    }
    const toolUses = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
      .filter((item) => item?.type === "function" && item.function?.name)
      .map((item) => ({ id: item.id, name: item.function.name, input: item.function.arguments }));
    if (!toolUses.length) return { assistantText, appliedPatch };

    const executed = await executeAiTools(send, toolUses);
    appliedPatch ||= executed.appliedPatch;
    messages.push(...executed.executions.map((item) => ({
      role: "tool",
      tool_call_id: item.id,
      content: item.serialized
    })));
  }
  return { assistantText, appliedPatch, reachedLimit: true };
}

/** Run the agentic loop, streaming newline-delimited JSON events to the client. */
async function runAiChat(res, body) {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store"
  });
  const send = (event) => { try { res.write(JSON.stringify(event) + "\n"); } catch { /* client gone */ } };

  const provider = typeof body?.provider === "string" ? body.provider.trim().toLowerCase() : "anthropic";
  const config = providerConfig(provider);
  if (!config) { send({ type: "error", error: "Unsupported AI provider." }); return res.end(); }
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  if (config.auth === "apiKey" && !apiKey) { send({ type: "error", error: `Missing ${config.label} API key.` }); return res.end(); }
  const requestedModel = typeof body?.model === "string" ? body.model.trim() : "";
  const model = requestedModel || config.defaultModel;
  if (!AI_MODEL_ID_RE.test(model)) { send({ type: "error", error: "Invalid AI model ID." }); return res.end(); }
  const history = normalizeAiHistory(body?.messages);
  if (history.length === 0) { send({ type: "error", error: "No messages provided." }); return res.end(); }

  // Abort the loop if the client disconnects (closes the EventStream / navigates away).
  const aborter = new AbortController();
  res.on("close", () => aborter.abort());

  let result = { assistantText: [], appliedPatch: false };
  try {
    const args = { send, apiKey, model, history, signal: aborter.signal };
    if (config.auth === "runtime") result = await agentRuntime.runChat({ provider, model, history, send, signal: aborter.signal });
    else if (provider === "openai") result = await runOpenAiAgent(args);
    else if (provider === "openrouter") result = await runOpenRouterAgent(args);
    else result = await runAnthropicAgent(args);
    if (result.reachedLimit) {
      const limitText = "_(Reached the step limit — ask me to continue if needed.)_";
      result.assistantText.push(limitText);
      send({ type: "text", text: limitText });
    }
    send({ type: "final" });
  } catch (error) {
    if (!aborter.signal.aborted) send({ type: "error", error: error instanceof Error ? error.message : String(error) });
  }
  const assistantMessage = result.assistantText.filter(Boolean).join("\n");
  const messages = assistantMessage ? [...history, { role: "assistant", content: assistantMessage }] : history;
  send({ type: "done", provider, model, messages, appliedPatch: result.appliedPatch });
  res.end();
}

// ── MCP integration ─────────────────────────────────────────────────────────
// A single project-root .mcp.json entry lets any MCP-capable agent run the constructor tools.

/**
 * Read .mcp.json, distinguishing "absent" (safe to create) from "present but unparseable"
 * (must NOT be overwritten — it likely holds the user's other server entries).
 */
function readMcpConfig() {
  if (!fs.existsSync(MCP_JSON_PATH)) {
    return { exists: false, valid: true, data: { mcpServers: {} } };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(MCP_JSON_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object") return { exists: true, valid: false, data: null };
    return { exists: true, valid: true, data: parsed };
  } catch {
    return { exists: true, valid: false, data: null };
  }
}

function mcpServerEntry() {
  return { command: process.execPath, args: [MCP_SERVER_PATH, "--project", PROJECT_DIR] };
}

function mcpState() {
  const { valid, data } = readMcpConfig();
  const enabled = Boolean(valid && data?.mcpServers && data.mcpServers[MCP_SERVER_KEY]);
  return {
    enabled,
    parseError: !valid,
    projectDir: PROJECT_DIR,
    serverPath: MCP_SERVER_PATH,
    mcpJsonPath: MCP_JSON_PATH,
    serverKey: MCP_SERVER_KEY,
    config: { mcpServers: { [MCP_SERVER_KEY]: mcpServerEntry() } },
    // Per-client connection snippets (Claude Code, Codex, Claude Desktop, Cursor, VS Code) — the
    // Settings panel renders these so any agent can be connected without leaving Studio.
    clients: agentClientConfigs(PROJECT_DIR, MCP_SERVER_PATH)
  };
}

function setMcpEnabled(enabled) {
  const current = readMcpConfig();
  if (current.exists && !current.valid) {
    // Refuse to clobber a file we cannot parse — preserves any foreign server entries.
    throw new Error(`Existing ${MCP_JSON_PATH} is not valid JSON. Fix or remove it before toggling MCP.`);
  }
  const config = current.data ?? { mcpServers: {} };
  config.mcpServers ??= {};
  if (enabled) {
    config.mcpServers[MCP_SERVER_KEY] = mcpServerEntry();
    writeJsonAtomic(MCP_JSON_PATH, config);
  } else {
    delete config.mcpServers[MCP_SERVER_KEY];
    if (Object.keys(config.mcpServers).length === 0 && Object.keys(config).length === 1) {
      // Nothing left but our (now-empty) mcpServers — remove the file entirely.
      try { fs.rmSync(MCP_JSON_PATH, { force: true }); } catch { /* ignore */ }
    } else {
      writeJsonAtomic(MCP_JSON_PATH, config);
    }
  }
  return mcpState();
}

// ── Request handler ───────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url      = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (!originAllowed(req)) {
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Forbidden: this server only accepts requests from the TowerForge Editor page itself." }));
    return;
  }
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && pathname === "/api/health") {
    return jsonResp(res, 200, {
      ok: true,
      desktop: DESKTOP_MODE,
      port: ACTIVE_PORT
    });
  }

  if (
    DESKTOP_MODE &&
    req.method === "GET" &&
    (pathname === "/" || pathname === "/index.html") &&
    url.searchParams.get("desktopToken") === DESKTOP_SESSION_TOKEN
  ) {
    return serveStatic(res, path.join(PUBLIC_DIR, "index.html"), { "Set-Cookie": desktopSessionCookie() });
  }

  if (!desktopSessionAllowed(req)) {
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Forbidden: missing or invalid TowerForge desktop session." }));
    return;
  }

  // ── GET /api/project ───────────────────────────────────────────────────────
  if (req.method === "GET" && pathname === "/api/app-info") {
    return jsonResp(res, 200, loadAppInfo());
  }

  if (req.method === "GET" && pathname === "/api/project") {
    try {
      return jsonResp(res, 200, loadProject());
    } catch (e) {
      return jsonResp(res, 500, { error: e.message });
    }
  }

  // GET /api/ai/models - live OpenRouter tool-capable model catalog.
  if (req.method === "GET" && pathname === "/api/ai/models") {
    if (url.searchParams.get("provider") !== "openrouter") {
      return jsonResp(res, 400, { error: "Only the OpenRouter live model catalog is supported." });
    }
    try {
      return jsonResp(res, 200, { provider: "openrouter", models: await openRouterModels() });
    } catch (error) {
      return jsonResp(res, 502, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  // Account runtimes own their OAuth credentials. These endpoints expose only safe status and
  // start/logout actions; tokens and credential files never cross into Studio or the WebView.
  if (req.method === "GET" && pathname === "/api/ai/runtime/status") {
    try {
      return jsonResp(res, 200, await agentRuntime.status(url.searchParams.get("provider")));
    } catch (error) {
      return jsonResp(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (req.method === "POST" && pathname === "/api/ai/runtime/connect") {
    let body;
    try { body = await readBody(req); }
    catch { return jsonResp(res, 400, { error: "Invalid JSON body" }); }
    try {
      return jsonResp(res, 200, await agentRuntime.connect(body?.provider));
    } catch (error) {
      return jsonResp(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (req.method === "POST" && pathname === "/api/ai/runtime/disconnect") {
    let body;
    try { body = await readBody(req); }
    catch { return jsonResp(res, 400, { error: "Invalid JSON body" }); }
    try {
      return jsonResp(res, 200, await agentRuntime.disconnect(body?.provider));
    } catch (error) {
      return jsonResp(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  // ── POST /api/ai/chat ─── streaming co-designer loop (NDJSON) ────────────────
  if (req.method === "POST" && pathname === "/api/ai/chat") {
    let body;
    try { body = await readBody(req); }
    catch { return jsonResp(res, 400, { error: "Invalid JSON body" }); }
    return runAiChat(res, body);
  }

  // ── POST /api/project/save ─────────────────────────────────────────────────
  if (req.method === "POST" && pathname === "/api/project/save") {
    let body;
    try { body = await readBody(req); }
    catch { return jsonResp(res, 400, { error: "Invalid JSON body" }); }

    const balancePath  = path.join(CONTENT_DIR, "balance.json");
    const worldMapPath = path.join(CONTENT_DIR, "world-map.json");
    const visualsPath = path.join(CONTENT_DIR, "visuals.json");
    const buildTargetsPath = path.join(PROJECT_DIR, "build-targets.json");

    // Conflict guard
    const clientHash = body.contentHash;
    const serverHash = projectHash();
    if (clientHash && clientHash !== serverHash) {
      return jsonResp(res, 409, {
        error: "Project changed on disk since last load. Reload the editor first.",
        serverHash,
      });
    }

    try {
      ensureDir(CONTENT_DIR);
      const balance      = fs.existsSync(balancePath)  ? readJson(balancePath)  : {};
      let balanceChanged = false;

      const balanceKeys = ["enemies", "towers", "waveSets", "missions", "abilities", "constants", "defaultMissionId", "currencies"];
      for (const key of balanceKeys) {
        if (body[key] !== undefined) { balance[key] = body[key]; balanceChanged = true; }
      }
      if (balanceChanged) { backupFile(balancePath); writeJsonAtomic(balancePath, balance); }

      if (body.worldMap !== undefined) {
        backupFile(worldMapPath);
        writeJsonAtomic(worldMapPath, body.worldMap);
      }

      if (body.visuals !== undefined) {
        backupFile(visualsPath);
        writeJsonAtomic(visualsPath, normalizeVisuals(body.visuals));
      }

      if (body.mapSources !== undefined) {
        for (const [sourceName, source] of Object.entries(body.mapSources)) {
          const sourcePath = path.join(MAPS_SRC_DIR, sourceName);
          backupFile(sourcePath);
          writeMapSource(PROJECT_DIR, sourceName, source);
        }
      }

      if (body.buildTargets !== undefined) {
        backupFile(buildTargetsPath);
        writeJsonAtomic(buildTargetsPath, body.buildTargets);
      }

      if (body.manifest !== undefined) {
        backupFile(path.join(PROJECT_DIR, "project.json"));
        writeJsonAtomic(path.join(PROJECT_DIR, "project.json"), body.manifest);
      }

      const response = { ok: true, newHash: projectHash() };
      writeRunTrace(PROJECT_DIR, {
        source: "studio",
        action: "save",
        status: "ok",
        changed: {
          balance: balanceChanged,
          worldMap: body.worldMap !== undefined,
          visuals: body.visuals !== undefined,
          mapSources: body.mapSources !== undefined,
          buildTargets: body.buildTargets !== undefined,
          manifest: body.manifest !== undefined
        }
      });
      return jsonResp(res, 200, response);
    } catch (e) {
      writeRunTrace(PROJECT_DIR, { source: "studio", action: "save", status: "error", error: e.message });
      return jsonResp(res, 500, { error: e.message });
    }
  }

  // ── GET /api/validate ──────────────────────────────────────────────────────
  if (req.method === "GET" && pathname === "/api/validate") {
    try {
      const { result } = await validateProjectDir(PROJECT_DIR);
      return jsonResp(res, 200, result);
    } catch (e) {
      return jsonResp(res, 500, { error: e.message });
    }
  }

  // ── GET /api/sim/:missionId ────────────────────────────────────────────────
  if (req.method === "GET" && pathname.startsWith("/api/sim/")) {
    const missionId = decodeURIComponent(pathname.slice("/api/sim/".length));
    try {
      const duration = Number(url.searchParams.get("duration") ?? 180);
      const result = await runMissionSmoke(PROJECT_DIR, missionId, Number.isFinite(duration) ? duration : 180);
      writeRunTrace(PROJECT_DIR, { source: "studio", action: "sim", status: "ok", missionId, outcome: result.outcome, coreHp: result.coreHp });
      return jsonResp(res, 200, result);
    } catch (e) {
      writeRunTrace(PROJECT_DIR, { source: "studio", action: "sim", status: "error", missionId, error: e.message });
      return jsonResp(res, 500, { error: e.message });
    }
  }

  // ── GET /api/balance ───────────────────────────────────────────────────────
  if (req.method === "GET" && pathname === "/api/balance") {
    try {
      const missionId = url.searchParams.get("mission");
      const seconds = Number(url.searchParams.get("seconds"));
      const report = await runBalanceSweepForProject(PROJECT_DIR, {
        missionIds: missionId ? [missionId] : [],
        simSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 1800) : undefined
      });
      writeRunTrace(PROJECT_DIR, { source: "studio", action: "balance", status: "ok", missions: report.summary.missions, flagged: report.summary.flagged });
      return jsonResp(res, 200, report);
    } catch (e) {
      writeRunTrace(PROJECT_DIR, { source: "studio", action: "balance", status: "error", error: e.message });
      return jsonResp(res, 500, { error: e.message });
    }
  }

  // ── POST /api/maps/compile ─────────────────────────────────────────────────
  if (req.method === "POST" && pathname === "/api/maps/preview") {
    let body;
    try { body = await readBody(req); }
    catch { return jsonResp(res, 400, { error: "Invalid JSON body" }); }
    if (!body.mapSources || typeof body.mapSources !== "object" || Array.isArray(body.mapSources)) {
      return jsonResp(res, 400, { error: "mapSources must be an object." });
    }
    const result = compileMapSources(body.mapSources);
    if (!result.ok) return jsonResp(res, 422, result);
    return jsonResp(res, 200, { ok: true, maps: result.maps, issues: result.issues });
  }

  if (req.method === "POST" && pathname === "/api/maps/compile") {
    try {
      const files = loadProjectFiles(PROJECT_DIR);
      const result = compileMapSources(files.mapSources ?? {});
      if (!result.ok) {
        writeRunTrace(PROJECT_DIR, { source: "studio", action: "maps:compile", status: "error", issues: result.issues });
        return jsonResp(res, 422, result);
      }
      const outFile = writeCompiledMaps(PROJECT_DIR, result.maps);
      const response = { ok: true, outFile, maps: result.maps, issues: result.issues, newHash: projectHash() };
      writeRunTrace(PROJECT_DIR, { source: "studio", action: "maps:compile", status: "ok", mapCount: Object.keys(result.maps).length });
      return jsonResp(res, 200, response);
    } catch (e) {
      writeRunTrace(PROJECT_DIR, { source: "studio", action: "maps:compile", status: "error", error: e.message });
      return jsonResp(res, 500, { error: e.message });
    }
  }

  // ── POST /api/assets/import ────────────────────────────────────────────────
  if (req.method === "POST" && pathname === "/api/assets/import") {
    let body;
    try { body = await readBody(req); }
    catch { return jsonResp(res, 400, { error: "Invalid JSON body" }); }
    try {
      const files = loadProjectFiles(PROJECT_DIR);
      const result = importProjectAsset(PROJECT_DIR, files.visuals, body);
      const visualsPath = path.join(CONTENT_DIR, "visuals.json");
      backupFile(visualsPath);
      writeJsonAtomic(visualsPath, normalizeVisuals(result.visuals));
      const response = { ok: true, ...result, newHash: projectHash() };
      writeRunTrace(PROJECT_DIR, { source: "studio", action: "asset:import", status: "ok", asset: result.asset });
      return jsonResp(res, 200, response);
    } catch (e) {
      writeRunTrace(PROJECT_DIR, { source: "studio", action: "asset:import", status: "error", error: e.message });
      return jsonResp(res, 500, { error: e.message });
    }
  }

  // ── GET /api/mcp ───────────────────────────────────────────────────────────
  if (req.method === "GET" && pathname === "/api/mcp") {
    try {
      return jsonResp(res, 200, mcpState());
    } catch (e) {
      return jsonResp(res, 500, { error: e.message });
    }
  }

  // ── POST /api/mcp ──────────────────────────────────────────────────────────
  if (req.method === "POST" && pathname === "/api/mcp") {
    let body;
    try { body = await readBody(req); }
    catch { return jsonResp(res, 400, { error: "Invalid JSON body" }); }
    try {
      const state = setMcpEnabled(Boolean(body.enabled));
      writeRunTrace(PROJECT_DIR, { source: "studio", action: "mcp:toggle", status: "ok", enabled: state.enabled });
      return jsonResp(res, 200, { ok: true, ...state });
    } catch (e) {
      writeRunTrace(PROJECT_DIR, { source: "studio", action: "mcp:toggle", status: "error", error: e.message });
      return jsonResp(res, 500, { error: e.message });
    }
  }

  // ── POST /api/mcp/connect-client — write a project-scoped client config ─────
  // Only project-scoped targets (.mcp.json / .cursor/mcp.json / .vscode/mcp.json) are writable;
  // user-scoped configs (Codex, Claude Desktop) stay copy-paste by design — the library refuses
  // them, so this endpoint can never touch files outside PROJECT_DIR.
  if (req.method === "POST" && pathname === "/api/mcp/connect-client") {
    let body;
    try { body = await readBody(req); }
    catch { return jsonResp(res, 400, { error: "Invalid JSON body" }); }
    try {
      const written = writeProjectClientConfig(PROJECT_DIR, String(body.clientId ?? ""), MCP_SERVER_PATH);
      writeRunTrace(PROJECT_DIR, { source: "studio", action: "mcp:connect-client", status: "ok", clientId: body.clientId });
      return jsonResp(res, 200, { ok: true, ...written, state: mcpState() });
    } catch (e) {
      writeRunTrace(PROJECT_DIR, { source: "studio", action: "mcp:connect-client", status: "error", error: e.message });
      return jsonResp(res, 400, { error: e.message });
    }
  }

  // ── POST /api/build/:targetId ──────────────────────────────────────────────
  if (req.method === "POST" && pathname.startsWith("/api/build")) {
    const targetId = pathname === "/api/build" ? "" : decodeURIComponent(pathname.slice("/api/build/".length));
    const args = [path.join(repoRoot, "packages", "cli", "build.mjs"), "--project", PROJECT_DIR];
    if (targetId) args.push("--target", targetId);
    const result = await runNodeScript(args);
    if (result.status !== 0) {
      writeRunTrace(PROJECT_DIR, { source: "studio", action: "build", status: "error", targetId, error: (result.stderr || result.stdout || "Build failed").trim() });
      return jsonResp(res, 500, {
        ok: false,
        error: (result.stderr || result.stdout || "Build failed").trim()
      });
    }
    writeRunTrace(PROJECT_DIR, { source: "studio", action: "build", status: "ok", targetId });
    return jsonResp(res, 200, {
      ok: true,
      targetId,
      output: (result.stdout || "").trim()
    });
  }

  // ── POST /api/package/:targetId ─── wrap the web build into a native app (mobile/desktop) ───────
  if (req.method === "POST" && pathname.startsWith("/api/package")) {
    const targetId = pathname === "/api/package" ? "" : decodeURIComponent(pathname.slice("/api/package/".length));
    let body = {};
    try { body = await readBody(req); } catch { body = {}; }
    const kind = body?.kind === "desktop" ? "desktop" : "mobile";
    const args = [path.join(repoRoot, "packages", "cli", "package.mjs"), "--project", PROJECT_DIR, "--kind", kind, "--json"];
    if (targetId) args.push("--target", targetId);
    const result = await runNodeScript(args);
    let payload;
    try { payload = JSON.parse(result.stdout); } catch { payload = null; }
    if (result.status !== 0 || !payload?.ok) {
      const error = payload?.error || (result.stderr || result.stdout || "Packaging failed").trim();
      writeRunTrace(PROJECT_DIR, { source: "studio", action: "package", status: "error", targetId, error });
      return jsonResp(res, 500, { ok: false, error });
    }
    writeRunTrace(PROJECT_DIR, { source: "studio", action: "package", status: "ok", targetId });
    return jsonResp(res, 200, payload);
  }

  // ── Static files ───────────────────────────────────────────────────────────
  if (req.method === "GET") {
    if (pathname === "/" || pathname === "/index.html") {
      if (DESKTOP_MODE && url.searchParams.get("desktopToken") === DESKTOP_SESSION_TOKEN) {
        return serveStatic(res, path.join(PUBLIC_DIR, "index.html"), { "Set-Cookie": desktopSessionCookie() });
      }
      return serveStatic(res, path.join(PUBLIC_DIR, "index.html"));
    }
    if (pathname.startsWith("/renderer/")) {
      const rendererPath = path.join(repoRoot, "packages", "renderer", "src", path.normalize(pathname.slice("/renderer/".length)).replace(/^(\.\.[/\\])+/, ""));
      if (rendererPath.startsWith(path.join(repoRoot, "packages", "renderer", "src")) && fs.existsSync(rendererPath)) {
        return serveStatic(res, rendererPath);
      }
    }
    if (pathname.startsWith("/engine/")) {
      // Serve the compiled engine so the in-editor playtest can import it in the browser.
      const engineDir = path.join(repoRoot, "packages", "engine", "dist");
      const enginePath = path.join(engineDir, path.normalize(pathname.slice("/engine/".length)).replace(/^(\.\.[/\\])+/, ""));
      if (enginePath.startsWith(engineDir) && fs.existsSync(enginePath)) {
        return serveStatic(res, enginePath);
      }
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Engine not built yet. Try again in a moment.");
      return;
    }
    if (pathname.startsWith("/project-file/")) {
      // Read-only access to project asset files (e.g. sprite thumbnails), confined to PROJECT_DIR.
      const rel = decodeURIComponent(pathname.slice("/project-file/".length));
      const filePath = path.join(PROJECT_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
      const relCheck = path.relative(PROJECT_DIR, filePath);
      if (!relCheck.startsWith("..") && !path.isAbsolute(relCheck) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return serveStatic(res, filePath);
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    // Serve any file from public/ (prevent path traversal)
    const safe = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ""));
    if (safe.startsWith(PUBLIC_DIR) && fs.existsSync(safe)) {
      return serveStatic(res, safe);
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

// ── Boot ──────────────────────────────────────────────────────────────────────

ensureDir(SESSION_DIR);

// Warm the compiled engine in the background so the in-editor playtest can import /engine/* immediately.
loadEngine().catch(() => { /* surfaced later via the /engine/ 503 path */ });

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${PORT} already in use. Use PORT=<n> to override.\n`);
  } else {
    console.error("Server error:", err.message);
  }
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object") ACTIVE_PORT = address.port;
  if (DESKTOP_MODE) {
    console.log(JSON.stringify({
      type: "towerforge-studio-ready",
      url: `http://127.0.0.1:${ACTIVE_PORT}`,
      port: ACTIVE_PORT
    }));
    return;
  }
  console.log(`\n  TowerForge Editor  http://localhost:${ACTIVE_PORT}`);
  console.log(`  Project: ${PROJECT_DIR}\n`);
  console.log("  Press Ctrl+C to stop.\n");
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    agentRuntime.close();
    const forceExit = setTimeout(() => process.exit(0), 1_000);
    server.close(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
    server.closeAllConnections?.();
  });
}
