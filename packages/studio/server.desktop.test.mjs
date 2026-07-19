import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const serverScript = path.join(repoRoot, "packages", "studio", "server.mjs");
const starterProject = path.join(repoRoot, "examples", "starter.tdproj");
const children = new Set();

afterEach(() => {
  for (const child of children) child.kill("SIGTERM");
  children.clear();
});

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-project-"));
  const projectDir = path.join(dir, "starter.tdproj");
  fs.cpSync(starterProject, projectDir, {
    recursive: true,
    filter: (entry) => !entry.includes(`${path.sep}.towerforge${path.sep}`)
  });
  return projectDir;
}

function startDesktopServer() {
  const projectDir = tempProject();
  const token = "test-desktop-token";
  const child = spawn(process.execPath, [serverScript, "--project", projectDir], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: "0",
      TOWERFORGE_DESKTOP: "1",
      TOWERFORGE_SESSION_TOKEN: token
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.add(child);

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for server. stdout=${stdout} stderr=${stderr}`)), 10000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      for (const line of stdout.split("\n")) {
        if (!line.includes("towerforge-studio-ready")) continue;
        clearTimeout(timer);
        resolve({ child, token, ready: JSON.parse(line) });
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("exit", (code) => reject(new Error(`Server exited with ${code}. stdout=${stdout} stderr=${stderr}`)));
  });
}

describe("Studio desktop server mode", () => {
  it("supports dynamic ports and health checks", async () => {
    const { ready } = await startDesktopServer();
    expect(ready.port).toBeGreaterThan(0);

    const response = await fetch(`http://127.0.0.1:${ready.port}/api/health`);
    expect(response.status).toBe(200);
    const health = await response.json();
    expect(health.ok).toBe(true);
    expect(health.desktop).toBe(true);
    expect(health.port).toBe(ready.port);
    expect(health).not.toHaveProperty("projectDir");
    expect(ready).not.toHaveProperty("projectDir");
  });

  it("rejects desktop API calls without the session token", async () => {
    const { ready, token } = await startDesktopServer();

    const missing = await fetch(`http://127.0.0.1:${ready.port}/api/project`);
    expect(missing.status).toBe(403);

    const wrong = await fetch(`http://127.0.0.1:${ready.port}/api/project`, {
      headers: { "x-towerforge-session": "wrong" }
    });
    expect(wrong.status).toBe(403);

    const crossOrigin = await fetch(`http://127.0.0.1:${ready.port}/api/project`, {
      headers: {
        "origin": "http://evil.example",
        "x-towerforge-session": token
      }
    });
    expect(crossOrigin.status).toBe(403);
  });

  it("accepts desktop API calls with header or cookie session", async () => {
    const { ready, token } = await startDesktopServer();

    const headerAuth = await fetch(`http://127.0.0.1:${ready.port}/api/project`, {
      headers: { "x-towerforge-session": token }
    });
    expect(headerAuth.status).toBe(200);

    const index = await fetch(`http://127.0.0.1:${ready.port}/?desktopToken=${token}`);
    expect(index.status).toBe(200);
    const cookie = index.headers.get("set-cookie");
    expect(cookie).toContain("tf_session=");

    const cookieAuth = await fetch(`http://127.0.0.1:${ready.port}/api/project`, {
      headers: { cookie }
    });
    expect(cookieAuth.status).toBe(200);
  });
});
