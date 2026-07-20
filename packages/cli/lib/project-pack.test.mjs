import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportProjectPack, importProjectPack, inspectProjectPack } from "./project-pack.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
let tempDir;

beforeEach(() => { tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-pack-")); });
afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

describe(".tdpack project exchange", () => {
  it("exports, verifies, and imports a validation-clean project", async () => {
    const packPath = path.join(tempDir, "starter.tdpack");
    const exported = await exportProjectPack(STARTER, packPath);
    expect(exported.sha256).toMatch(/^[a-f0-9]{64}$/);
    const inspected = inspectProjectPack(packPath);
    expect(inspected.entries.map((entry) => entry.path)).toContain("content/balance.json");
    expect(inspected.entries.map((entry) => entry.path)).toContain("scripts/gameplay/starter-gameplay.tower.json");
    expect(inspected.entries.some((entry) => entry.path.startsWith(".towerforge/"))).toBe(false);
    const imported = await importProjectPack(packPath, tempDir, { name: "roundtrip" });
    expect(imported.projectDir).toBe(path.join(tempDir, "roundtrip.tdproj"));
    expect(JSON.parse(fs.readFileSync(path.join(imported.projectDir, "project.json"), "utf8")).name).toBe("Starter Tower Defense");
  });

  it("rejects a tampered entry and leaves no destination", async () => {
    const packPath = path.join(tempDir, "starter.tdpack");
    await exportProjectPack(STARTER, packPath);
    const bytes = fs.readFileSync(packPath);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    fs.writeFileSync(packPath, bytes);
    expect(() => inspectProjectPack(packPath)).toThrow(/Invalid .tdpack|verification/);
    await expect(importProjectPack(packPath, tempDir, { name: "tampered" })).rejects.toThrow();
    expect(fs.existsSync(path.join(tempDir, "tampered.tdproj"))).toBe(false);
  });

  it("never overwrites an existing project directory", async () => {
    const packPath = path.join(tempDir, "starter.tdpack");
    await exportProjectPack(STARTER, packPath);
    fs.mkdirSync(path.join(tempDir, "existing.tdproj"));
    await expect(importProjectPack(packPath, tempDir, { name: "existing" })).rejects.toThrow(/already exists/);
  });

  it("derives a filesystem-safe default name from the project title", async () => {
    const packPath = path.join(tempDir, "starter.tdpack");
    await exportProjectPack(STARTER, packPath);
    const imported = await importProjectPack(packPath, tempDir);
    expect(path.basename(imported.projectDir)).toBe("starter-tower-defense.tdproj");
  });
});
