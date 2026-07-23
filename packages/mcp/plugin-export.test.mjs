import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exportPluginRepository } from "../../scripts/export-codex-plugin-repository.mjs";
import { verifyReleaseTree } from "../../distribution/codex-plugin/scripts/verify-release.mjs";

const outputs = [];
afterEach(() => {
  for (const output of outputs.splice(0)) fs.rmSync(output, { recursive: true, force: true });
});

describe("Codex plugin repository exporter", () => {
  it("produces a complete checksummed mirror tied to one source commit", () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-plugin-export-"));
    outputs.push(output);
    const sourceCommit = "a".repeat(40);
    const result = exportPluginRepository({ outputDirectory: output, sourceCommit, checkClean: false });

    expect(result.manifest.sourceCommit).toBe(sourceCommit);
    expect(result.manifest.files.length).toBeGreaterThan(100);
    expect(fs.existsSync(path.join(output, ".agents", "plugins", "marketplace.json"))).toBe(true);
    expect(fs.existsSync(path.join(output, "plugins", "towerforge", "runtime", "packages", "mcp", "server.mjs"))).toBe(true);
    expect(fs.readFileSync(path.join(output, "README.md"), "utf8")).toContain(sourceCommit);
    expect(verifyReleaseTree(output)).toEqual(expect.objectContaining({ ok: true, sourceCommit }));

    fs.appendFileSync(path.join(output, "plugins", "towerforge", "README.md"), "tampered\n");
    expect(() => verifyReleaseTree(output)).toThrow(/mismatch/);
  });

  it("refuses to replace a directory inside the canonical source tree", () => {
    expect(() => exportPluginRepository({
      outputDirectory: path.resolve("dist/plugin-export"),
      sourceCommit: "b".repeat(40),
      checkClean: false
    })).toThrow(/outside the TowerForge source tree/);
  });
});
