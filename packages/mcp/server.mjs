#!/usr/bin/env node
/**
 * TowerForge AI MCP server.
 *
 * A zero-dependency Model Context Protocol server (JSON-RPC 2.0 over newline-delimited stdio)
 * that exposes the .tdproj constructor toolset — validate, simulate, compile maps, build, inspect,
 * and patch balance — to any MCP-capable AI agent.
 *
 * Usage:
 *   node server.mjs [--project <path>]
 *   PROJECT_DIR=<path> node server.mjs
 *
 * IMPORTANT: stdout is the protocol channel — only JSON-RPC messages are written there.
 * Diagnostics go to stderr.
 */
import process from "node:process";
import readline from "node:readline";
import { resolveProjectDir } from "../cli/lib/project-loader.mjs";
import { TOOLS, callTool } from "./tools.mjs";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "towerforge-ai", version: "0.1.0" };
const defaultProjectDir = resolveProjectDir(null, process.argv.slice(2));

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}
function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleMessage(message) {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO
      });
      return;

    case "notifications/initialized":
    case "initialized":
      return; // notification, no response

    case "ping":
      if (isRequest) reply(id, {});
      return;

    case "tools/list":
      reply(id, { tools: TOOLS });
      return;

    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};
      try {
        const result = await callTool(name, args, { defaultProjectDir });
        reply(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (error) {
        reply(id, { content: [{ type: "text", text: String(error?.message ?? error) }], isError: true });
      }
      return;
    }

    default:
      if (isRequest) replyError(id, -32601, `Method not found: ${method}`);
  }
}

let stdinClosed = false;
const pending = new Set();

function drainAndExit() {
  if (stdinClosed && pending.size === 0) {
    process.exit(0);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return; // ignore non-JSON noise
  }
  const task = handleMessage(message)
    .catch((error) => {
      if (message && message.id !== undefined && message.id !== null) {
        replyError(message.id, -32603, String(error?.message ?? error));
      }
    })
    .finally(() => {
      pending.delete(task);
      drainAndExit();
    });
  pending.add(task);
});
rl.on("close", () => {
  stdinClosed = true;
  drainAndExit();
});

process.stderr.write(`TowerForge AI MCP server ready.\n  Project: ${defaultProjectDir}\n  Tools: ${TOOLS.map((t) => t.name).join(", ")}\n`);
