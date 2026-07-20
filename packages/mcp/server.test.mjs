import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(dir, "server.mjs");
const STARTER = path.resolve(dir, "../../examples/starter.tdproj");

/** Run one stdio session: write raw NDJSON lines, close stdin, and collect every response frame
 *  (the server exits once stdin closes and in-flight work drains, so no timers are needed). */
function runSession(rawLines) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER, "--project", STARTER]);
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("error", reject);
    child.on("close", () => {
      try {
        resolve(out.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)));
      } catch (error) {
        reject(new Error(`Server emitted a non-JSON stdout frame: ${error.message}\n${out}`));
      }
    });
    child.stdin.write(rawLines.join("\n") + "\n");
    child.stdin.end();
  });
}

describe("mcp server JSON-RPC protocol (review fix #7)", () => {
  it("negotiates protocolVersion, answers parse/batch errors with id:null, and never replies to notifications", async () => {
    const frames = await runSession([
      // Unsupported version must be countered with ours, not echoed back.
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "9999-01-01" } }),
      // Non-JSON noise: JSON-RPC says respond with a -32700 parse error, id null.
      "{this is not json",
      // Batch arrays are unsupported: say so instead of silently dropping (a client would hang).
      JSON.stringify([{ jsonrpc: "2.0", id: 2, method: "ping" }]),
      // Notification-form request (no id): must produce NO response frame at all — replying used
      // to emit a malformed id-less frame (JSON.stringify drops the undefined id).
      JSON.stringify({ jsonrpc: "2.0", method: "tools/list" }),
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" })
    ]);

    // Every emitted frame is well-formed: it carries an explicit id (possibly null), never omits it.
    for (const frame of frames) {
      expect(Object.prototype.hasOwnProperty.call(frame, "id"), JSON.stringify(frame)).toBe(true);
    }

    const init = frames.find((f) => f.id === 1);
    expect(init.result.protocolVersion).toBe("2024-11-05"); // negotiated, not echoed
    expect(init.result.instructions).toContain("universal pipeline");
    expect(init.result.instructions).toContain("TowerScript");

    const nullIdErrors = frames.filter((f) => f.id === null);
    expect(nullIdErrors.some((f) => f.error?.code === -32700)).toBe(true); // parse error
    expect(nullIdErrors.some((f) => f.error?.code === -32600)).toBe(true); // batch rejected

    expect(frames.find((f) => f.id === 3)).toBeTruthy(); // ping answered
    // The notification-form tools/list produced nothing: no frame carries a tools listing.
    expect(frames.some((f) => Array.isArray(f.result?.tools))).toBe(false);
    expect(frames).toHaveLength(4); // init + 2 null-id errors + pong, nothing else
  });

  it("echoes a supported protocolVersion back unchanged", async () => {
    const frames = await runSession([
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } })
    ]);
    expect(frames.find((f) => f.id === 1).result.protocolVersion).toBe("2024-11-05");
  });
});
