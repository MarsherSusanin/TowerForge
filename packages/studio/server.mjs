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
import { writeRunTrace } from "../cli/lib/trace.mjs";
import { TOOLS, callTool } from "../mcp/tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

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
const PUBLIC_DIR = path.join(__dirname, "public");

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

function serveStatic(res, filePath) {
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
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": ct, "Cache-Control": "no-store" });
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
  return value === `localhost:${PORT}` || value === `127.0.0.1:${PORT}`;
}

function originAllowed(req) {
  if (!isAllowedAuthority(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true; // non-browser client (curl, scripts) with no Origin header
  return origin === `http://localhost:${PORT}` || origin === `http://127.0.0.1:${PORT}`;
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
// diagnose → patch → re-simulate). The user's Anthropic API key is passed per request and used
// only transiently here — never written to disk. Every tool runs against THIS server's project.

const AI_DEFAULT_MODEL = "claude-sonnet-4-6";
const AI_MAX_STEPS = 16;
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
function aiToolDefs() {
  return TOOLS.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }));
}

// Overridable for local proxies / tests; defaults to the real Anthropic API.
const ANTHROPIC_BASE_URL = (process.env["ANTHROPIC_BASE_URL"] || "https://api.anthropic.com").replace(/\/$/, "");

const ANTHROPIC_TIMEOUT_MS = 120_000;
const AI_WRITE_TOOLS = new Set(["apply_balance_patch", "apply_validated_patch", "set_enemy_stat", "upsert_tower", "add_wave_group", "bind_sprite", "compile_maps"]);

/** One non-streaming call to the Anthropic Messages API (zero-dep, uses global fetch). */
async function anthropicMessages({ apiKey, model, system, tools, messages, signal }) {
  // Bound the call: abort on timeout OR when the client disconnects (signal), so a hung upstream
  // never parks the loop or leaks the open response.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("Anthropic request timed out.")), ANTHROPIC_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  let response;
  try {
    response = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({ model: model || AI_DEFAULT_MODEL, max_tokens: 4096, system, tools, messages }),
      signal: ctrl.signal
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try { detail = JSON.parse(text)?.error?.message ?? text; } catch { /* keep raw */ }
    throw new Error(`Anthropic API ${response.status}: ${String(detail).slice(0, 400)}`);
  }
  return JSON.parse(text);
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

/** Run the agentic loop, streaming newline-delimited JSON events to the client. */
async function runAiChat(res, body) {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store"
  });
  const send = (event) => { try { res.write(JSON.stringify(event) + "\n"); } catch { /* client gone */ } };

  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) { send({ type: "error", error: "Missing Anthropic API key." }); return res.end(); }
  const model = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : AI_DEFAULT_MODEL;
  const convo = Array.isArray(body?.messages) ? body.messages.slice() : [];
  if (convo.length === 0) { send({ type: "error", error: "No messages provided." }); return res.end(); }

  // Abort the loop if the client disconnects (closes the EventStream / navigates away).
  const aborter = new AbortController();
  res.on("close", () => aborter.abort());

  const tools = aiToolDefs();
  let appliedPatch = false;
  try {
    for (let step = 0; step < AI_MAX_STEPS; step++) {
      if (aborter.signal.aborted) break;
      const reply = await anthropicMessages({ apiKey, model, system: AI_SYSTEM_PROMPT, tools, messages: convo, signal: aborter.signal });
      convo.push({ role: "assistant", content: reply.content });
      for (const block of reply.content ?? []) {
        if (block.type === "text" && block.text) send({ type: "text", text: block.text });
      }
      if (reply.stop_reason !== "tool_use") { send({ type: "final" }); break; }

      const toolUses = (reply.content ?? []).filter((b) => b.type === "tool_use");
      const resultBlocks = [];
      for (const use of toolUses) {
        send({ type: "tool_call", id: use.id, name: use.name, input: use.input ?? {} });
        let result;
        let isError = false;
        try {
          // Force the project dir: the model must not be able to escape the server's project.
          result = await callTool(use.name, { ...(use.input ?? {}), projectDir: PROJECT_DIR }, { defaultProjectDir: PROJECT_DIR });
          if (AI_WRITE_TOOLS.has(use.name) && result?.written !== false) appliedPatch = true;
        } catch (error) {
          result = { error: error.message };
          isError = true;
        }
        send({ type: "tool_result", id: use.id, name: use.name, ok: !isError, summary: summarizeToolResult(use.name, result) });
        resultBlocks.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(result).slice(0, 24000), is_error: isError });
      }
      convo.push({ role: "user", content: resultBlocks });
      if (step === AI_MAX_STEPS - 1) send({ type: "text", text: "_(Reached the step limit — ask me to continue if needed.)_" });
    }
  } catch (error) {
    send({ type: "error", error: error.message });
  }
  send({ type: "done", messages: convo, appliedPatch });
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
    config: { mcpServers: { [MCP_SERVER_KEY]: mcpServerEntry() } }
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

  // ── GET /api/project ───────────────────────────────────────────────────────
  if (req.method === "GET" && pathname === "/api/project") {
    try {
      return jsonResp(res, 200, loadProject());
    } catch (e) {
      return jsonResp(res, 500, { error: e.message });
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
  console.log(`\n  TowerForge Editor  http://localhost:${PORT}`);
  console.log(`  Project: ${PROJECT_DIR}\n`);
  console.log("  Press Ctrl+C to stop.\n");
});
