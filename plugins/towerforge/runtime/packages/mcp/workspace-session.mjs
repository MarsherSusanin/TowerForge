import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_PROJECTS = 32;
const MAX_SCANNED_DIRECTORIES = 2_000;
const MAX_PROJECT_ENTRIES = 20_000;
const MAX_DEPTH = 4;
const IGNORED_DIRECTORIES = new Set([
  ".git", ".towerforge", "build", "coverage", "dist", "node_modules", "out", "target"
]);

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function canonicalDirectory(candidate) {
  try {
    const stat = fs.lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    return fs.realpathSync(candidate);
  } catch {
    return null;
  }
}

function rootFromUri(root) {
  if (!root || typeof root.uri !== "string" || !root.uri.startsWith("file://")) return null;
  try {
    return canonicalDirectory(fileURLToPath(root.uri));
  } catch {
    return null;
  }
}

function isProjectDirectory(candidate) {
  if (!candidate.endsWith(".tdproj")) return false;
  try {
    const marker = fs.lstatSync(path.join(candidate, "project.json"));
    return marker.isFile() && !marker.isSymbolicLink() && projectTreeIsSymlinkFree(candidate);
  } catch {
    return false;
  }
}

function projectTreeIsSymlinkFree(projectDir) {
  const queue = [projectDir];
  let visited = 0;
  while (queue.length) {
    const directory = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_PROJECT_ENTRIES) return false;
      if (entry.isSymbolicLink()) return false;
      if (!entry.isDirectory()) continue;
      if (IGNORED_DIRECTORIES.has(entry.name) || ["desktop", "mobile", "web"].includes(entry.name)) continue;
      queue.push(path.join(directory, entry.name));
    }
  }
  return true;
}

function discoverUnderRoot(root, rootIndex) {
  const projects = [];
  const queue = [{ directory: root, depth: 0 }];
  let scanned = 0;

  while (queue.length && projects.length < MAX_PROJECTS && scanned < MAX_SCANNED_DIRECTORIES) {
    const current = queue.shift();
    scanned += 1;
    if (isProjectDirectory(current.directory)) {
      const relative = path.relative(root, current.directory) || ".";
      projects.push({
        id: `root${rootIndex}:${relative.split(path.sep).join("/")}`,
        label: path.basename(current.directory, ".tdproj"),
        relativePath: relative.split(path.sep).join("/"),
        directory: current.directory,
        root
      });
      continue;
    }
    if (current.depth >= MAX_DEPTH) continue;

    let entries;
    try {
      entries = fs.readdirSync(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || IGNORED_DIRECTORIES.has(entry.name)) continue;
      const child = path.join(current.directory, entry.name);
      const canonical = canonicalDirectory(child);
      if (canonical && isInside(root, canonical)) queue.push({ directory: canonical, depth: current.depth + 1 });
    }
  }
  return projects;
}

export function createWorkspaceSession() {
  let roots = [];
  let projects = [];
  let selectedProjectId = null;

  return {
    updateRoots(rawRoots) {
      const seen = new Set();
      roots = (Array.isArray(rawRoots) ? rawRoots : [])
        .map(rootFromUri)
        .filter((root) => root && !seen.has(root) && seen.add(root));
      projects = roots.flatMap((root, index) => discoverUnderRoot(root, index)).slice(0, MAX_PROJECTS);
      if (!projects.some((project) => project.id === selectedProjectId)) selectedProjectId = null;
      if (!selectedProjectId && projects.length === 1) selectedProjectId = projects[0].id;
      return this.summary();
    },
    select(projectId) {
      if (typeof projectId !== "string" || !/^root\d+:(?:\.|[^\\]+)$/.test(projectId) || projectId.includes("..")) {
        throw new Error("Invalid workspace project id. Call list_workspace_projects and use an id it returned.");
      }
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!project) throw new Error("That project is not available in the current workspace roots.");
      selectedProjectId = project.id;
      return this.summary();
    },
    summary() {
      return {
        rootsAvailable: roots.length > 0,
        selectedProjectId,
        projects: projects.map(({ id, label, relativePath }) => ({ id, label, relativePath, selected: id === selectedProjectId }))
      };
    },
    get selectedProjectDir() {
      return projects.find((project) => project.id === selectedProjectId)?.directory ?? null;
    },
    get allowedRoots() {
      return [...roots];
    }
  };
}

export const WORKSPACE_TOOLS = [
  {
    name: "list_workspace_projects",
    description: "List TowerForge .tdproj directories inside the filesystem roots explicitly shared by the current Codex workspace. Paths outside those roots are never searched.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    riskClass: "compute_only",
    sideEffect: "none"
  },
  {
    name: "select_workspace_project",
    description: "Select one project returned by list_workspace_projects for subsequent TowerForge tools. This changes only the current MCP session.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string", description: "Opaque project id returned by list_workspace_projects." } },
      required: ["projectId"],
      additionalProperties: false
    },
    riskClass: "session_only",
    sideEffect: "changes the active project for this local MCP session"
  }
];

export function workspaceToolDefinitions(tools) {
  return [
    ...WORKSPACE_TOOLS,
    ...tools.map((tool) => {
      const copy = structuredClone(tool);
      if (copy.inputSchema?.properties) delete copy.inputSchema.properties.projectDir;
      if (Array.isArray(copy.inputSchema?.required)) {
        copy.inputSchema.required = copy.inputSchema.required.filter((field) => field !== "projectDir");
      }
      return copy;
    })
  ];
}

export function sanitizeWorkspaceResult(value, options = {}) {
  const projectDir = options.projectDir ?? null;
  const sensitiveRoots = [...(options.roots ?? []), ...(options.sensitiveRoots ?? [])]
    .filter((entry) => typeof entry === "string" && entry)
    .sort((a, b) => b.length - a.length);

  const sanitizeString = (input) => {
    let result = input;
    for (const root of sensitiveRoots) {
      result = result.split(root).join(root === projectDir ? "." : "<local-root>");
    }
    if (path.isAbsolute(result) || /^[A-Za-z]:[\\/]/.test(result)) {
      if (projectDir && isInside(projectDir, path.resolve(result))) {
        return path.relative(projectDir, path.resolve(result)).split(path.sep).join("/") || ".";
      }
      return "<local-path>";
    }
    return result;
  };

  const visit = (input) => {
    if (typeof input === "string") return sanitizeString(input);
    if (Array.isArray(input)) return input.map(visit);
    if (!input || typeof input !== "object") return input;
    const output = {};
    for (const [key, item] of Object.entries(input)) {
      if (key === "projectDir") continue;
      output[key] = visit(item);
    }
    return output;
  };
  return visit(value);
}

export function assertProjectWithinRoots(projectDir, roots) {
  const canonical = canonicalDirectory(projectDir);
  if (!canonical || !roots.some((root) => isInside(root, canonical)) || !isProjectDirectory(canonical)) {
    throw new Error("The active project is outside the filesystem roots shared with this MCP session.");
  }
  return canonical;
}
