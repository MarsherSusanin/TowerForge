import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearRecentProjects,
  normalizeRecentProjectDirs,
  readDesktopState,
  recordRecentProject,
  resolveDesktopProject
} from "./project-state.mjs";

function makeRuntimeRoot() {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-runtime-"));
  const starter = path.join(runtimeRoot, "examples", "starter.tdproj");
  fs.mkdirSync(starter, { recursive: true });
  fs.writeFileSync(path.join(starter, "project.json"), JSON.stringify({ name: "Starter" }), "utf8");
  fs.mkdirSync(path.join(starter, ".towerforge"), { recursive: true });
  fs.writeFileSync(path.join(starter, ".towerforge", "session.json"), "{}", "utf8");
  return runtimeRoot;
}

describe("desktop project state", () => {
  it("copies starter project on first run without copying local session state", () => {
    const runtimeRoot = makeRuntimeRoot();
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-user-"));

    const projectDir = resolveDesktopProject({ runtimeRoot, userDataDir });

    expect(projectDir).toBe(path.join(userDataDir, "projects", "starter.tdproj"));
    expect(fs.existsSync(path.join(projectDir, "project.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".towerforge"))).toBe(false);
  });

  it("does not overwrite an existing user starter project", () => {
    const runtimeRoot = makeRuntimeRoot();
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-user-"));

    const first = resolveDesktopProject({ runtimeRoot, userDataDir });
    fs.writeFileSync(path.join(first, "project.json"), JSON.stringify({ name: "User Edit" }), "utf8");
    const second = resolveDesktopProject({ runtimeRoot, userDataDir });

    expect(second).toBe(first);
    expect(JSON.parse(fs.readFileSync(path.join(second, "project.json"), "utf8")).name).toBe("User Edit");
  });

  it("persists an explicitly opened project as the next desktop project", () => {
    const runtimeRoot = makeRuntimeRoot();
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-user-"));
    const explicitProjectDir = path.join(userDataDir, "custom.tdproj");
    fs.mkdirSync(explicitProjectDir, { recursive: true });
    fs.writeFileSync(path.join(explicitProjectDir, "project.json"), "{}", "utf8");

    expect(resolveDesktopProject({ explicitProjectDir, runtimeRoot, userDataDir })).toBe(explicitProjectDir);
    expect(resolveDesktopProject({ runtimeRoot, userDataDir })).toBe(explicitProjectDir);
    expect(readDesktopState(userDataDir).recentProjectDirs).toEqual([explicitProjectDir]);
  });

  it("deduplicates, prunes, and limits recent projects", () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-user-"));
    const projects = Array.from({ length: 12 }, (_, index) => {
      const projectDir = path.join(userDataDir, `game-${index}.tdproj`);
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, "project.json"), "{}", "utf8");
      return projectDir;
    });
    const missing = path.join(userDataDir, "missing.tdproj");

    expect(normalizeRecentProjectDirs([projects[0], missing, projects[0], ...projects.slice(1)])).toEqual(projects.slice(0, 10));
  });

  it("records most-recent-first and clears only the recent list", () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-user-"));
    const first = path.join(userDataDir, "first.tdproj");
    const second = path.join(userDataDir, "second.tdproj");
    for (const projectDir of [first, second]) {
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, "project.json"), "{}", "utf8");
    }

    recordRecentProject(userDataDir, first);
    recordRecentProject(userDataDir, second);
    recordRecentProject(userDataDir, first);
    expect(readDesktopState(userDataDir).recentProjectDirs).toEqual([first, second]);

    clearRecentProjects(userDataDir);
    expect(readDesktopState(userDataDir)).toMatchObject({ lastProjectDir: first, recentProjectDirs: [] });
  });
});
