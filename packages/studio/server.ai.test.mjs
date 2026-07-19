import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const serverScript = path.join(repoRoot, "packages", "studio", "server.mjs");
const starterProject = path.join(repoRoot, "examples", "starter.tdproj");
const children = new Set();
const mockServers = new Set();
const tempRoots = new Set();

afterEach(async () => {
  for (const child of children) child.kill("SIGTERM");
  children.clear();
  await Promise.all([...mockServers].map((server) => new Promise((resolve) => server.close(resolve))));
  mockServers.clear();
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
  tempRoots.clear();
});

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-ai-project-"));
  tempRoots.add(root);
  const projectDir = path.join(root, "starter.tdproj");
  fs.cpSync(starterProject, projectDir, {
    recursive: true,
    filter: (entry) => !entry.includes(`${path.sep}.towerforge${path.sep}`)
  });
  return projectDir;
}

async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function jsonResponse(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function startMockServer(handler) {
  const server = http.createServer(handler);
  mockServers.add(server);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function startStudioServer(extraEnv = {}) {
  const token = "test-ai-designer-token";
  const child = spawn(process.execPath, [serverScript, "--project", tempProject()], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: "0",
      TOWERFORGE_DESKTOP: "1",
      TOWERFORGE_SESSION_TOKEN: token,
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.add(child);

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for Studio. stdout=${stdout} stderr=${stderr}`)), 10_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const readyLine = stdout.split("\n").find((line) => line.includes("towerforge-studio-ready"));
      if (!readyLine) return;
      clearTimeout(timer);
      resolve({ child, token, ready: JSON.parse(readyLine) });
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Studio exited with ${code}. stdout=${stdout} stderr=${stderr}`));
    });
  });
}

async function aiRequest(studio, body) {
  const response = await fetch(`http://127.0.0.1:${studio.ready.port}/api/ai/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-towerforge-session": studio.token
    },
    body: JSON.stringify(body)
  });
  expect(response.status).toBe(200);
  return (await response.text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("Studio AI provider adapters", () => {
  it("calls the current Anthropic Messages contract", async () => {
    const requests = [];
    const mock = await startMockServer(async (req, res) => {
      requests.push({ url: req.url, headers: req.headers, body: await readRequestJson(req) });
      jsonResponse(res, {
        content: [{ type: "text", text: "Anthropic ready" }],
        stop_reason: "end_turn"
      });
    });
    const studio = await startStudioServer({ ANTHROPIC_BASE_URL: mock.baseUrl });

    const events = await aiRequest(studio, {
      provider: "anthropic",
      apiKey: "anthropic-test-key",
      model: "claude-sonnet-5",
      messages: [{ role: "user", content: "Inspect the project" }]
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/v1/messages");
    expect(requests[0].headers["x-api-key"]).toBe("anthropic-test-key");
    expect(requests[0].body.model).toBe("claude-sonnet-5");
    expect(requests[0].body.tools[0]).toHaveProperty("input_schema");
    expect(events).toContainEqual({ type: "text", text: "Anthropic ready" });
    expect(events.at(-1).messages.at(-1)).toEqual({ role: "assistant", content: "Anthropic ready" });
  });

  it("runs an OpenAI Responses function call and returns its output", async () => {
    const requests = [];
    const mock = await startMockServer(async (req, res) => {
      const body = await readRequestJson(req);
      requests.push({ url: req.url, headers: req.headers, body });
      if (requests.length === 1) {
        return jsonResponse(res, {
          id: "resp_tool",
          output: [{
            type: "function_call",
            id: "fc_validate",
            call_id: "call_validate",
            name: "validate_project",
            arguments: "{}"
          }]
        });
      }
      return jsonResponse(res, {
        id: "resp_final",
        output: [{
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "OpenAI ready" }]
        }]
      });
    });
    const studio = await startStudioServer({ OPENAI_BASE_URL: mock.baseUrl });

    const events = await aiRequest(studio, {
      provider: "openai",
      apiKey: "openai-test-key",
      model: "gpt-5.6-terra",
      messages: [{ role: "user", content: "Validate the project" }]
    });

    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe("/responses");
    expect(requests[0].headers.authorization).toBe("Bearer openai-test-key");
    expect(requests[0].body.store).toBe(false);
    expect(requests[0].body.tools[0]).toMatchObject({ type: "function", strict: false });
    expect(requests[1].body.input).toContainEqual(expect.objectContaining({
      type: "function_call_output",
      call_id: "call_validate"
    }));
    expect(events.some((event) => event.type === "tool_result" && event.ok)).toBe(true);
    expect(events).toContainEqual({ type: "text", text: "OpenAI ready" });
  });

  it("loads OpenRouter tool models and uses Chat Completions", async () => {
    const requests = [];
    const mock = await startMockServer(async (req, res) => {
      if (req.method === "GET" && req.url.startsWith("/models")) {
        requests.push({ url: req.url, headers: req.headers });
        return jsonResponse(res, {
          data: [
            { id: "provider/tool-model", name: "Tool Model", context_length: 128000, supported_parameters: ["tools"], architecture: { output_modalities: ["text"] } },
            { id: "provider/image-model", name: "Image Model", supported_parameters: ["tools"], architecture: { output_modalities: ["image"] } },
            { id: "provider/no-tools", name: "No Tools", supported_parameters: ["temperature"], architecture: { output_modalities: ["text"] } }
          ]
        });
      }
      const body = await readRequestJson(req);
      requests.push({ url: req.url, headers: req.headers, body });
      return jsonResponse(res, {
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: "OpenRouter ready" } }]
      });
    });
    const studio = await startStudioServer({ OPENROUTER_BASE_URL: mock.baseUrl });

    const catalogResponse = await fetch(`http://127.0.0.1:${studio.ready.port}/api/ai/models?provider=openrouter`, {
      headers: { "x-towerforge-session": studio.token }
    });
    expect(catalogResponse.status).toBe(200);
    const catalog = await catalogResponse.json();
    expect(catalog.models).toEqual([{ id: "provider/tool-model", name: "Tool Model", contextLength: 128000 }]);

    const events = await aiRequest(studio, {
      provider: "openrouter",
      apiKey: "openrouter-test-key",
      model: "provider/tool-model",
      messages: [{ role: "user", content: "Inspect balance" }]
    });

    const chat = requests.find((request) => request.url === "/chat/completions");
    expect(chat.headers.authorization).toBe("Bearer openrouter-test-key");
    expect(chat.headers["x-openrouter-title"]).toBe("TowerForge");
    expect(chat.body.messages[0]).toMatchObject({ role: "system" });
    expect(chat.body.tools[0]).toHaveProperty("function.parameters");
    expect(events).toContainEqual({ type: "text", text: "OpenRouter ready" });
  });
});
