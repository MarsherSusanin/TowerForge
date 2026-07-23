#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "plugins", "towerforge");
const server = path.join(plugin, "runtime", "packages", "mcp", "server.mjs");
const child = spawn(process.execPath, [server], {
  cwd: plugin,
  env: {
    PATH: process.env.PATH,
    TOWERFORGE_RUNTIME_ROOT: "./runtime",
    TOWERFORGE_BUNDLED_RUNTIME: "1",
    TOWERFORGE_MCP_WORKSPACE_BOUND: "1"
  },
  stdio: ["pipe", "pipe", "pipe"]
});

let stderr = "";
let completed = false;
const timeout = setTimeout(() => finish(new Error(`Plugin smoke timed out.\n${stderr}`)), 20_000);
child.stderr.on("data", (chunk) => { stderr += chunk; });

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function fail(message) {
  finish(new Error(`${message}\n${stderr}`));
}

function finish(error) {
  if (completed) return;
  completed = true;
  clearTimeout(timeout);
  child.stdin.end();
  if (error) {
    child.kill();
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

function textResult(frame) {
  const text = frame.result?.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error(`Missing text tool result: ${JSON.stringify(frame)}`);
  return JSON.parse(text);
}

const rl = readline.createInterface({ input: child.stdout });
rl.on("line", (line) => {
  let frame;
  try { frame = JSON.parse(line); }
  catch { fail(`Plugin emitted non-JSON stdout: ${line}`); return; }

  if (frame.id === 1) {
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return;
  }
  if (frame.method === "roots/list") {
    send({ jsonrpc: "2.0", id: frame.id, result: { roots: [{ uri: pathToFileURL(root).href, name: "TowerForge" }] } });
    setTimeout(() => send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }), 20);
    return;
  }
  if (frame.id === 2) {
    const validate = frame.result?.tools?.find((tool) => tool.name === "validate_project");
    if (!validate || Object.hasOwn(validate.inputSchema?.properties ?? {}, "projectDir")) {
      fail("Workspace-bound tool schemas must not expose projectDir.");
      return;
    }
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_workspace_projects", arguments: {} } });
    return;
  }
  if (frame.id === 3) {
    let summary;
    try { summary = textResult(frame); }
    catch (error) { fail(error.message); return; }
    if (summary.projects?.length !== 1 || !summary.selectedProjectId) {
      fail(`Expected one auto-selected project, got ${JSON.stringify(summary)}`);
      return;
    }
    send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "validate_project", arguments: { projectDir: "/tmp/not-allowed.tdproj" } } });
    return;
  }
  if (frame.id === 4) {
    const text = frame.result?.content?.[0]?.text ?? "";
    if (!frame.result?.isError || !text.includes("projectDir is not accepted") || text.includes(root)) {
      fail(`Injected projectDir was not rejected safely: ${JSON.stringify(frame)}`);
      return;
    }
    send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "validate_project", arguments: {} } });
    return;
  }
  if (frame.id === 5) {
    let validation;
    try { validation = textResult(frame); }
    catch (error) { fail(error.message); return; }
    const serialized = JSON.stringify(validation);
    if (!validation.ok || serialized.includes(root) || Object.hasOwn(validation, "projectDir")) {
      fail(`Bundled validation failed or leaked a local path: ${serialized}`);
      return;
    }
    const descriptor = `<?xml version="1.0" encoding="UTF-8"?>
      <tileset version="1.10" name="road" tilewidth="32" tileheight="32" tilecount="1" columns="1">
        <image source="road.png" width="32" height="32"/>
        <wangsets><wangset name="Road" type="edge">
          <wangcolor name="Path" color="#808080" tile="0" probability="1">
            <properties>
              <property name="towerforge.terrainId" value="path"/>
              <property name="walkable" type="bool" value="true"/>
              <property name="connectGroup" value="road"/>
              <property name="connectionSource" value="pathRoutes"/>
            </properties>
          </wangcolor>
          <wangtile tileid="0" wangid="1,0,1,0,0,0,0,0"/>
        </wangset></wangsets>
      </tileset>`;
    send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "preview_tileset_import",
        arguments: { descriptor, sourceName: "road.tsx", topology: "square" }
      }
    });
    return;
  }
  if (frame.id === 6) {
    let imported;
    try { imported = textResult(frame); }
    catch (error) { fail(error.message); return; }
    const signature = imported.preview?.tileSet?.materials?.path?.signatures?.["edge:3"];
    const serialized = JSON.stringify(imported);
    if (frame.result?.isError || !Array.isArray(signature) || serialized.includes(root)) {
      fail(`Bundled TSX import failed or leaked a local path: ${serialized}`);
      return;
    }
    process.stdout.write("Codex plugin MCP smoke passed.\n");
    finish();
  }
});

child.on("error", (error) => fail(`Plugin process failed: ${error.message}`));
child.on("close", (code) => {
  if (!completed && code !== 0) fail(`Plugin exited with code ${code}.`);
});

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: { roots: { listChanged: true } },
    clientInfo: { name: "towerforge-plugin-smoke", version: "1.0.0" }
  }
});
