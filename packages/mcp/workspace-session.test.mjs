import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertProjectWithinRoots,
  createWorkspaceSession,
  sanitizeWorkspaceResult,
  workspaceToolDefinitions
} from "./workspace-session.mjs";

const temporaryDirectories = [];

function temporaryWorkspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-workspace-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createProject(directory, name) {
  const project = path.join(directory, `${name}.tdproj`);
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "project.json"), "{}\n");
  return project;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("workspace-bound MCP sessions", () => {
  it("discovers only real projects below shared roots and auto-selects a single project", () => {
    const root = temporaryWorkspace();
    const project = createProject(path.join(root, "games"), "demo");
    fs.mkdirSync(path.join(root, "ignored.tdproj"));
    fs.writeFileSync(path.join(root, "ignored.tdproj", "not-project.json"), "{}\n");

    const session = createWorkspaceSession();
    const summary = session.updateRoots([{ uri: pathToFileURL(root).href }]);

    expect(summary.projects).toEqual([expect.objectContaining({ label: "demo", selected: true })]);
    expect(session.selectedProjectDir).toBe(fs.realpathSync(project));
    expect(assertProjectWithinRoots(project, session.allowedRoots)).toBe(fs.realpathSync(project));
  });

  it("requires an opaque discovered id when several projects exist", () => {
    const root = temporaryWorkspace();
    createProject(root, "one");
    createProject(root, "two");
    const session = createWorkspaceSession();
    const summary = session.updateRoots([{ uri: pathToFileURL(root).href }]);

    expect(session.selectedProjectDir).toBeNull();
    expect(() => session.select("/tmp/one.tdproj")).toThrow(/Invalid workspace project id/);
    const selected = session.select(summary.projects[1].id);
    expect(selected.selectedProjectId).toBe(summary.projects[1].id);
  });

  it("does not discover projects whose authored tree contains a symlink", () => {
    const root = temporaryWorkspace();
    const project = createProject(root, "linked");
    fs.mkdirSync(path.join(project, "content"));
    fs.symlinkSync(path.join(root, "outside.json"), path.join(project, "content", "balance.json"));
    fs.writeFileSync(path.join(root, "outside.json"), "{}\n");

    const session = createWorkspaceSession();
    const summary = session.updateRoots([{ uri: pathToFileURL(root).href }]);
    expect(summary.projects).toEqual([]);
    expect(() => assertProjectWithinRoots(project, session.allowedRoots)).toThrow(/outside the filesystem roots/);
  });

  it("removes projectDir from public schemas and redacts local paths from results", () => {
    const tools = workspaceToolDefinitions([{
      name: "example",
      inputSchema: {
        type: "object",
        properties: { projectDir: { type: "string" }, id: { type: "string" } },
        required: ["projectDir", "id"]
      }
    }]);
    expect(tools.find((tool) => tool.name === "example").inputSchema).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"]
    });

    const result = sanitizeWorkspaceResult({
      projectDir: "/Users/private/demo.tdproj",
      outputPath: "/Users/private/demo.tdproj/build/game",
      externalPath: "/Users/private/secret.txt"
    }, { projectDir: "/Users/private/demo.tdproj", roots: ["/Users/private/demo.tdproj"] });
    expect(result).toEqual({ outputPath: "./build/game", externalPath: "<local-path>" });
  });
});
