import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProject, TEMPLATE_NAMES } from "./create-project.mjs";

describe("createProject", () => {
  it.each(TEMPLATE_NAMES)("creates a valid %s project scaffold", (templateName) => {
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-create-"));
    const result = createProject({ name: `game_${templateName}`, parentDir, templateName });

    expect(result.templateName).toBe(templateName);
    expect(fs.existsSync(path.join(result.projectDir, "project.json"))).toBe(true);
    expect(fs.existsSync(path.join(result.projectDir, "content", "balance.json"))).toBe(true);
    expect(fs.existsSync(path.join(result.projectDir, "maps", "compiled", "maps.json"))).toBe(true);
    expect(fs.existsSync(path.join(result.projectDir, "AGENTS.md"))).toBe(true);
  });

  it("rejects invalid names and traversal attempts", () => {
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-create-"));
    expect(() => createProject({ name: "../outside", parentDir })).toThrow("Invalid project name");
    expect(() => createProject({ name: "folder/game", parentDir })).toThrow("Invalid project name");
  });

  it("does not overwrite an existing project", () => {
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-create-"));
    createProject({ name: "existing", parentDir });
    expect(() => createProject({ name: "existing", parentDir })).toThrow("Directory already exists");
  });
});
