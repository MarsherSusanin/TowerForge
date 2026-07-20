import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("desktop packaged runtime", () => {
  it("loads bundled engine dist without requiring node_modules/typescript", () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-runtime-"));
    const engineDist = path.join(runtimeRoot, "packages", "engine", "dist");
    fs.mkdirSync(engineDist, { recursive: true });
    fs.writeFileSync(path.join(engineDist, "index.js"), "export const packagedProbe = 42;\n", "utf8");

    const result = spawnSync(process.execPath, [
      "--input-type=module",
      "-e",
      `
        const mod = await import("./packages/cli/lib/project-loader.mjs");
        const engine = await mod.loadEngine();
        console.log(JSON.stringify({ repoRoot: mod.repoRoot, packagedProbe: engine.packagedProbe }));
      `
    ], {
      cwd: path.resolve(import.meta.dirname, "../../.."),
      env: {
        ...process.env,
        TOWERFORGE_DESKTOP: "1",
        TOWERFORGE_BUNDLED_RUNTIME: "1",
        TOWERFORGE_RUNTIME_ROOT: runtimeRoot
      },
      encoding: "utf8"
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.repoRoot).toBe(runtimeRoot);
    expect(parsed.packagedProbe).toBe(42);
  });
});
