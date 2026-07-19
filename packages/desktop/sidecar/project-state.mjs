import fs from "node:fs";
import path from "node:path";

const STATE_FILE = "desktop-state.json";
const MAX_RECENT_PROJECTS = 10;

export function desktopStatePath(userDataDir) {
  return path.join(userDataDir, STATE_FILE);
}

export function readDesktopState(userDataDir) {
  try {
    return JSON.parse(fs.readFileSync(desktopStatePath(userDataDir), "utf8"));
  } catch {
    return {};
  }
}

export function writeDesktopState(userDataDir, state) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(desktopStatePath(userDataDir), JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function isProjectDir(projectDir) {
  return typeof projectDir === "string" && fs.existsSync(path.join(projectDir, "project.json"));
}

export function normalizeRecentProjectDirs(projectDirs, max = MAX_RECENT_PROJECTS) {
  const seen = new Set();
  const result = [];
  for (const entry of Array.isArray(projectDirs) ? projectDirs : []) {
    if (typeof entry !== "string") continue;
    const projectDir = path.resolve(entry);
    if (seen.has(projectDir) || !isProjectDir(projectDir)) continue;
    seen.add(projectDir);
    result.push(projectDir);
    if (result.length >= max) break;
  }
  return result;
}

export function recordRecentProject(userDataDir, projectDir) {
  const resolved = path.resolve(projectDir);
  const state = readDesktopState(userDataDir);
  const recentProjectDirs = normalizeRecentProjectDirs([
    resolved,
    ...(state.recentProjectDirs ?? [])
  ]);
  const next = { ...state, lastProjectDir: resolved, recentProjectDirs };
  writeDesktopState(userDataDir, next);
  return next;
}

export function clearRecentProjects(userDataDir) {
  const state = readDesktopState(userDataDir);
  const next = { ...state, recentProjectDirs: [] };
  writeDesktopState(userDataDir, next);
  return next;
}

export function ensureStarterProject({ runtimeRoot, userDataDir }) {
  const source = path.join(runtimeRoot, "examples", "starter.tdproj");
  const target = path.join(userDataDir, "projects", "starter.tdproj");
  if (!fs.existsSync(path.join(target, "project.json"))) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, {
      recursive: true,
      filter: (entry) => {
        const name = path.basename(entry);
        return name !== ".towerforge" && name !== "dist" && name !== "mobile" && name !== "desktop";
      }
    });
  }
  return target;
}

export function resolveDesktopProject({ explicitProjectDir, runtimeRoot, userDataDir }) {
  if (!userDataDir) {
    throw new Error("TOWERFORGE_USER_DATA_DIR is required in desktop mode.");
  }
  fs.mkdirSync(userDataDir, { recursive: true });

  if (explicitProjectDir) {
    const projectDir = path.resolve(explicitProjectDir);
    recordRecentProject(userDataDir, projectDir);
    return projectDir;
  }

  const state = readDesktopState(userDataDir);
  if (isProjectDir(state.lastProjectDir)) {
    recordRecentProject(userDataDir, state.lastProjectDir);
    return path.resolve(state.lastProjectDir);
  }

  const starter = ensureStarterProject({ runtimeRoot, userDataDir });
  recordRecentProject(userDataDir, starter);
  return starter;
}
