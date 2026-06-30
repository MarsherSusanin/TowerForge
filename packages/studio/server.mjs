#!/usr/bin/env node
/**
 * Mycelium Studio server
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

// ── Project resolution ────────────────────────────────────────────────────────
// Shares the canonical resolver with the CLI loader so behavior stays in sync.

const PROJECT_DIR = resolveProjectDir(null, process.argv.slice(2));
const CONTENT_DIR = path.join(PROJECT_DIR, "content");
const MAPS_DIR = path.join(PROJECT_DIR, "maps", "compiled");
const MAPS_SRC_DIR = path.join(PROJECT_DIR, "maps", "src");
const SESSION_DIR = path.join(PROJECT_DIR, ".mycelium");
const MCP_JSON_PATH = path.join(PROJECT_DIR, ".mcp.json");
const MCP_SERVER_PATH = path.join(repoRoot, "packages", "mcp", "server.mjs");
const MCP_SERVER_KEY = "mycelium-constructor";
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
    "Content-Type":                "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control":               "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
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

  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // ── GET /api/project ───────────────────────────────────────────────────────
  if (req.method === "GET" && pathname === "/api/project") {
    try {
      return jsonResp(res, 200, loadProject());
    } catch (e) {
      return jsonResp(res, 500, { error: e.message });
    }
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

      const balanceKeys = ["enemies", "towers", "waveSets", "missions", "abilities", "constants", "defaultMissionId"];
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
        simSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
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
  console.log(`\n  Mycelium Studio  http://localhost:${PORT}`);
  console.log(`  Project: ${PROJECT_DIR}\n`);
  console.log("  Press Ctrl+C to stop.\n");
});
