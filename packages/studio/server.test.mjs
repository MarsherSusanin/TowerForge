import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const PORT = 5197;
const BASE = `http://127.0.0.1:${PORT}`;

let projectDir;
let serverProcess;

beforeAll(async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-server-test-"));
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
  serverProcess = spawn(process.execPath, [path.join(repoRoot, "packages", "studio", "server.mjs"), "--project", projectDir], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "pipe"
  });
  await waitForHttp(`${BASE}/api/project`);
}, 30_000);

afterAll(async () => {
  if (serverProcess) {
    serverProcess.kill();
    await new Promise((resolve) => serverProcess.once("exit", resolve));
  }
  if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true });
});

// Regression coverage for the Origin/Host guard that closes the drive-by-localhost /
// DNS-rebinding hole: the studio server writes project files on POST and must reject any
// request whose Host/Origin doesn't name this exact server, with no wildcard CORS header.
describe("studio server origin/host guard", () => {
  it("serves a same-origin request normally", async () => {
    const res = await fetch(`${BASE}/api/project`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("serves public application metadata from the root package", async () => {
    const res = await fetch(`${BASE}/api/app-info`);
    const info = await res.json();
    expect(res.status).toBe(200);
    expect(info).toMatchObject({
      name: "TowerForge Studio",
      version: rootPackage.version,
      studioName: "Lindforge Studios",
      siteUrl: "https://lindforge.com",
      telegramUrl: "https://t.me/lindforge"
    });
    expect(info.sourceUrl).toBe("https://github.com/Lindforge-Studios/TowerForge");
  });

  it("allows a same-origin request that also sends a matching Origin header", async () => {
    const res = await fetch(`${BASE}/api/project`, { headers: { Origin: `http://127.0.0.1:${PORT}` } });
    expect(res.status).toBe(200);
  });

  it("rejects a forged Host header (DNS-rebinding simulation)", async () => {
    // fetch() refuses to let user code override the forbidden "Host" header, so a raw
    // http.request is needed to actually simulate a DNS-rebound request here.
    const { status, body } = await rawGet("/api/project", { Host: "evil.example.com" });
    expect(status).toBe(403);
    expect(JSON.parse(body).error).toMatch(/forbidden/i);
  });

  it("rejects a cross-origin Origin header even with a legitimate Host (drive-by simulation)", async () => {
    const res = await fetch(`${BASE}/api/project/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.example.com" },
      body: JSON.stringify({})
    });
    expect(res.status).toBe(403);
  });

  it("never issues a wildcard Access-Control-Allow-Origin header", async () => {
    const res = await fetch(`${BASE}/api/project`);
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("previews unsaved map sources without replacing compiled maps on disk", async () => {
    const project = await (await fetch(`${BASE}/api/project`)).json();
    const sources = structuredClone(project.mapSources);
    const source = sources["tutorial_map.tmj"];
    const nextPath = [{ q: 6, r: 0 }, { q: 6, r: 1 }, { q: 6, r: 2 }];
    source.properties.find((prop) => prop.name === "pathCenterline").value = JSON.stringify(nextPath);
    const compiledPath = path.join(projectDir, "maps", "compiled", "maps.json");
    const before = fs.readFileSync(compiledPath, "utf8");

    const response = await fetch(`${BASE}/api/maps/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapSources: sources })
    });
    const preview = await response.json();

    expect(response.status).toBe(200);
    expect(preview.maps.tutorial_map.pathCenterline).toEqual(nextPath);
    expect(preview.maps.tutorial_map.pathRoutes[0].pathCenterline).toEqual(nextPath);
    expect(fs.readFileSync(compiledPath, "utf8")).toBe(before);
  });
});

function rawGet(pathname, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: pathname, method: "GET", headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForHttp(url) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
