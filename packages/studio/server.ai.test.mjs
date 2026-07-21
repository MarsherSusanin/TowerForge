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
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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
  const projectDir = tempProject();
  const child = spawn(process.execPath, [serverScript, "--project", projectDir], {
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
      resolve({ child, token, projectDir, ready: JSON.parse(readyLine) });
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

async function studioGet(studio, pathname) {
  return fetch(`http://127.0.0.1:${studio.ready.port}${pathname}`, {
    headers: { "x-towerforge-session": studio.token }
  });
}

describe("Studio AI provider adapters", () => {
  it("exposes release readiness without leaking the local project path", async () => {
    const studio = await startStudioServer();
    const response = await studioGet(studio, "/api/release-doctor");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.id)).toEqual(["validation", "maps", "identity", "content", "build_targets", "tile_coverage"]);
    expect(result).not.toHaveProperty("projectDir");
    expect(JSON.stringify(result)).not.toContain(studio.projectDir);
  }, 15_000);

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
      reasoning: "high",
      context: {
        activeTab: "enemies",
        project: { name: "Starter", defaultMissionId: "tutorial_01", dirty: false, projectDir: "/must/not/leave" },
        selection: { collection: "enemies", id: "basic_grunt" },
        validation: { errorCount: 0, warningCount: 0, issues: [] }
      },
      attachments: [{ name: "capture.png", mimeType: "image/png", data: PNG_1PX }],
      messages: [{ role: "user", content: "Inspect the project" }]
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/v1/messages");
    expect(requests[0].headers["x-api-key"]).toBe("anthropic-test-key");
    expect(requests[0].body.model).toBe("claude-sonnet-5");
    expect(requests[0].body.output_config).toEqual({ effort: "high" });
    expect(requests[0].body.messages[0].content).toContainEqual(expect.objectContaining({
      type: "image",
      source: expect.objectContaining({ type: "base64", media_type: "image/png" })
    }));
    const promptText = requests[0].body.messages[0].content.find((item) => item.type === "text").text;
    expect(promptText).toContain("TOWERFORGE_EDITOR_CONTEXT");
    expect(promptText).toContain("basic_grunt");
    expect(promptText).not.toContain("/must/not/leave");
    expect(requests[0].body.tools[0]).toHaveProperty("input_schema");
    expect(events).toContainEqual({ type: "text", text: "Anthropic ready" });
    expect(events.at(-1).messages.at(-1)).toEqual({ role: "assistant", content: "Anthropic ready" });
    expect(events.at(-1).messages[0]).toEqual({ role: "user", content: "Inspect the project" });
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
      reasoning: "high",
      mode: "act",
      attachments: [{ name: "reference.png", mimeType: "image/png", data: PNG_1PX }],
      messages: [{ role: "user", content: "Validate the project" }]
    });

    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe("/responses");
    expect(requests[0].headers.authorization).toBe("Bearer openai-test-key");
    expect(requests[0].body.store).toBe(false);
    expect(requests[0].body.reasoning).toEqual({ effort: "high" });
    expect(requests[0].body.input[0].content).toContainEqual(expect.objectContaining({
      type: "input_image",
      image_url: expect.stringMatching(/^data:image\/png;base64,/)
    }));
    expect(requests[0].body.tools[0]).toMatchObject({ type: "function", strict: false });
    const toolNames = requests[0].body.tools.map((tool) => tool.name);
    expect(toolNames).toContain("get_entity");
    expect(toolNames).toContain("upsert_entity");
    expect(toolNames).not.toContain("build_project");
    expect(toolNames).not.toContain("package_desktop");
    expect(requests[0].body.tools.find((tool) => tool.name === "get_entity").parameters.properties)
      .not.toHaveProperty("projectDir");
    expect(requests[1].body.input).toContainEqual(expect.objectContaining({
      type: "function_call_output",
      call_id: "call_validate"
    }));
    const observation = requests[1].body.input.find((item) => item.type === "function_call_output").output;
    expect(observation).not.toContain("projectDir");
    expect(observation).not.toContain(studio.projectDir);
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
            { id: "provider/tool-model", name: "Tool Model", context_length: 128000, supported_parameters: ["tools"], reasoning: { supported_efforts: ["low", "high"], default_effort: "low" }, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } },
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
    expect(catalog.models).toEqual([{
      id: "provider/tool-model",
      name: "Tool Model",
      contextLength: 128000,
      reasoningLevels: ["low", "high"],
      defaultReasoning: "low",
      inputModalities: ["text", "image"]
    }]);

    const events = await aiRequest(studio, {
      provider: "openrouter",
      apiKey: "openrouter-test-key",
      model: "provider/tool-model",
      reasoning: "high",
      attachments: [{ name: "map.png", mimeType: "image/png", data: PNG_1PX }],
      messages: [{ role: "user", content: "Inspect balance" }]
    });

    const chat = requests.find((request) => request.url === "/chat/completions");
    expect(chat.headers.authorization).toBe("Bearer openrouter-test-key");
    expect(chat.headers["x-openrouter-title"]).toBe("TowerForge");
    expect(chat.body.messages[0]).toMatchObject({ role: "system" });
    expect(chat.body.reasoning).toEqual({ effort: "high", exclude: true });
    expect(chat.body.messages[1].content).toContainEqual(expect.objectContaining({
      type: "image_url",
      image_url: expect.objectContaining({ url: expect.stringMatching(/^data:image\/png;base64,/) })
    }));
    expect(chat.body.tools[0]).toHaveProperty("function.parameters");
    expect(events).toContainEqual({ type: "text", text: "OpenRouter ready" });
  });

  it("rejects image data whose bytes do not match the declared MIME type", async () => {
    const studio = await startStudioServer();
    const events = await aiRequest(studio, {
      provider: "openai",
      apiKey: "openai-test-key",
      model: "gpt-5.6-terra",
      attachments: [{ name: "spoofed.png", mimeType: "image/png", data: Buffer.from("not a png").toString("base64") }],
      messages: [{ role: "user", content: "Inspect this" }]
    });
    expect(events).toContainEqual({ type: "error", error: expect.stringMatching(/does not match/) });
  });

  it("detects generic MCP writes and reports that Studio must reload", async () => {
    let calls = 0;
    const mock = await startMockServer(async (req, res) => {
      await readRequestJson(req);
      calls += 1;
      if (calls === 1) {
        return jsonResponse(res, {
          id: "resp_write",
          output: [{
            type: "function_call",
            id: "fc_write",
            call_id: "call_write",
            name: "upsert_entity",
            arguments: JSON.stringify({ collection: "enemies", id: "basic_grunt", value: { maxHp: 99 }, merge: true })
          }]
        });
      }
      return jsonResponse(res, {
        id: "resp_done",
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Updated" }] }]
      });
    });
    const studio = await startStudioServer({ OPENAI_BASE_URL: mock.baseUrl });
    const events = await aiRequest(studio, {
      provider: "openai",
      apiKey: "openai-test-key",
      model: "gpt-5.6-terra",
      mode: "act",
      messages: [{ role: "user", content: "Set the selected enemy HP to 99" }]
    });

    expect(events.at(-1)).toMatchObject({ type: "done", appliedPatch: true });
    const balance = JSON.parse(fs.readFileSync(path.join(studio.projectDir, "content", "balance.json"), "utf8"));
    expect(balance.enemies.basic_grunt.maxHp).toBe(99);
  });

  it("refuses a write proposed outside Act mode even if a provider ignores its tool list", async () => {
    let calls = 0;
    const mock = await startMockServer(async (req, res) => {
      const body = await readRequestJson(req);
      calls += 1;
      if (calls === 1) {
        expect(body.tools.map((tool) => tool.name)).not.toContain("upsert_entity");
        return jsonResponse(res, {
          id: "resp_forbidden_write",
          output: [{
            type: "function_call",
            id: "fc_forbidden",
            call_id: "call_forbidden",
            name: "upsert_entity",
            arguments: JSON.stringify({ collection: "enemies", id: "basic_grunt", value: { maxHp: 777 }, merge: true })
          }]
        });
      }
      return jsonResponse(res, {
        id: "resp_done",
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Write was unavailable" }] }]
      });
    });
    const studio = await startStudioServer({ OPENAI_BASE_URL: mock.baseUrl });
    const before = JSON.parse(fs.readFileSync(path.join(studio.projectDir, "content", "balance.json"), "utf8"));
    const events = await aiRequest(studio, {
      provider: "openai",
      apiKey: "openai-test-key",
      model: "gpt-5.6-terra",
      mode: "ask",
      messages: [{ role: "user", content: "Change the enemy" }]
    });
    const after = JSON.parse(fs.readFileSync(path.join(studio.projectDir, "content", "balance.json"), "utf8"));

    expect(events).toContainEqual(expect.objectContaining({ type: "tool_result", name: "upsert_entity", ok: false }));
    expect(events.at(-1)).toMatchObject({ type: "done", mode: "ask", appliedPatch: false });
    expect(after.enemies.basic_grunt.maxHp).toBe(before.enemies.basic_grunt.maxHp);
  });
});
