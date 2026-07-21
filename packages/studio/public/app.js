import { createCanvasRenderer } from "/renderer/index.mjs";
import { AUDIO_EVENTS } from "/renderer/audio.mjs";
import { LANGUAGES, getLanguage, initI18n, setLanguage } from "/i18n.js";

initI18n();

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const ICO = {
  plus:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  up:    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>`,
  down:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>`,
  copy:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  x:     `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  check: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  warn:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  err:   `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
};

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  project:              null,   // loaded project data
  dirty:                false,
  projectDirty:         false,
  scriptDirty:          false,
  contentHash:          null,
  activeTab:            "home",
  // Per-tab selections
  waveMissionId:        null,   // selected mission in wave editor
  selectedEnemyId:      null,
  selectedTowerId:      null,
  selectedMissionEdId:  null,
  selectedRegionId:     null,
  selectedNodeId:       null,   // missionId of selected node
  selectedMapSourceName: null,
  mapPaintMode:          "inspect",
  serverValidation:      null,
  activity:              [],
  workbenchTab:          "problems",
  balanceReportRevision: null,
  projectTree:          null,
  selectedProjectPath:  null,
  scriptSource:         "",
  scriptFileRevision:   null,
  scriptOriginalId:     null,
};

const STUDIO_TABS = [
  ["home", "Home"], ["waves", "Waves"], ["enemies", "Enemies"], ["towers", "Towers"],
  ["missions", "Missions"], ["worldmap", "World Map"], ["maps", "Maps"],
  ["playtest", "Playtest"], ["balance", "Balance"],
  ["scripts", "Scripts"], ["assets", "Assets"], ["settings", "Settings"], ["buildtargets", "Build Targets"]
];

const APP_INFO = {
  name: "TowerForge Studio",
  version: "0.1.0",
  studioName: "Lindforge Studios",
  sourceUrl: "https://github.com/Lindforge-Studios/TowerForge",
  siteUrl: "https://lindforge.com",
  telegramUrl: "https://t.me/lindforge"
};

const SCRIPT_UI = { collapsed: new Set(), selectedNode: null, loading: false };

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function deep(obj) { return JSON.parse(JSON.stringify(obj)); }
function n(v, step) {
  return (step && step < 1) ? parseFloat(v) || 0 : (parseInt(v) || 0);
}
function iconBtn(icon, title, extraClass = "") {
  return `<button class="btn-icon${extraClass ? " " + extraClass : ""}" title="${esc(title)}" aria-label="${esc(title)}">${ICO[icon]}</button>`;
}

function uniqueRecipeEntityId(collection, suggestedId) {
  const entities = S.project?.[collection] ?? {};
  const base = String(suggestedId || collection.slice(0, -1) || "entity")
    .toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "entity";
  if (!entities[base]) return base;
  let suffix = 2;
  while (entities[`${base}_${suffix}`]) suffix += 1;
  return `${base}_${suffix}`;
}

function duplicateStudioEntity(collection, sourceId) {
  const entities = S.project?.[collection];
  const source = entities?.[sourceId];
  if (!source) return null;
  const targetId = uniqueRecipeEntityId(collection, `${sourceId}_copy`);
  const duplicate = deep(source);
  duplicate.id = targetId;
  if (typeof duplicate.label === "string" && duplicate.label) duplicate.label = `${duplicate.label} Copy`;
  entities[targetId] = duplicate;
  if (collection === "enemies") { S.selectedEnemyId = targetId; renderEnemiesTab(); }
  if (collection === "towers") { S.selectedTowerId = targetId; renderTowersTab(); }
  if (collection === "missions") { S.selectedMissionEdId = targetId; renderMissionsTab(); }
  markDirty(true);
  recordActivity(`Duplicated ${collection.slice(0, -1)}`, "ok", `${sourceId} → ${targetId}`);
  return targetId;
}

function closeRecipePicker() {
  $("recipe-overlay")?.classList.add("hidden");
  const list = $("recipe-list");
  if (list) list.innerHTML = "";
}

async function openRecipePicker(collection) {
  const labels = { enemies: "enemy", towers: "tower", missions: "mission" };
  const singular = labels[collection];
  if (!singular) return;
  const overlay = $("recipe-overlay");
  const list = $("recipe-list");
  if (!overlay || !list) return;
  $("recipe-title").textContent = `Add ${singular}`;
  $("recipe-intro").textContent = `Start from a validated ${singular} archetype. Every field remains editable after creation.`;
  list.innerHTML = `<div class="workbench-empty">Loading recipes...</div>`;
  overlay.classList.remove("hidden");
  try {
    const result = await apiGet(`/api/recipes?collection=${encodeURIComponent(collection)}`);
    list.innerHTML = result.recipes.map((recipe, index) => `<button class="recipe-option" type="button" data-recipe-index="${index}">
      <strong>${esc(recipe.label)}</strong><span class="recipe-kind">${esc(recipe.entity?.attack?.kind ?? recipe.id)}</span>
      <p>${esc(recipe.description)}</p>
    </button>`).join("");
    list.querySelectorAll("[data-recipe-index]").forEach((button) => button.addEventListener("click", () => {
      const recipe = result.recipes[Number(button.dataset.recipeIndex)];
      const id = uniqueRecipeEntityId(collection, recipe.suggestedId);
      const entity = { ...deep(recipe.entity), id };
      S.project[collection] ??= {};
      S.project[collection][id] = entity;
      if (collection === "enemies") { S.selectedEnemyId = id; renderEnemiesTab(); }
      if (collection === "towers") { S.selectedTowerId = id; renderTowersTab(); }
      if (collection === "missions") { S.selectedMissionEdId = id; renderMissionsTab(); }
      markDirty(true);
      recordActivity(`Added ${singular}`, "ok", `${entity.label ?? id} from ${recipe.label} recipe`);
      closeRecipePicker();
    }));
    list.querySelector("button")?.focus();
  } catch (error) {
    closeRecipePicker();
    toast(`Could not load ${singular} recipes: ${error.message}`, "err");
  }
}

$("recipe-close")?.addEventListener("click", closeRecipePicker);
$("recipe-overlay")?.addEventListener("click", (event) => { if (event.target === $("recipe-overlay")) closeRecipePicker(); });

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = "ok") {
  const c = $("toast-container");
  const d = document.createElement("div");
  d.className = `toast ${type}`;
  const icons = { ok: ICO.check, warn: ICO.warn, err: ICO.err };
  d.innerHTML = `${icons[type] ?? ""}${esc(msg)}`;
  c.appendChild(d);
  requestAnimationFrame(() => d.classList.add("show"));
  setTimeout(() => { d.classList.remove("show"); setTimeout(() => d.remove(), 300); }, 4000);
}
function setStatus(msg) { const e = $("status-msg"); if (e) e.textContent = msg; }

function recordActivity(action, status = "ok", detail = "", meta = {}) {
  S.activity.unshift({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, timestamp: new Date().toISOString(), action, status, detail, ...meta });
  if (S.activity.length > 100) S.activity.length = 100;
  renderWorkbench();
}

function collectProblems() {
  const issues = [];
  for (const issue of S.clientIssues ?? []) issues.push({ ...issue, source: "live", severity: issue.severity === "warning" ? "warning" : "error" });
  for (const issue of S.serverValidation?.issues ?? []) {
    issues.push({
      ...issue,
      source: "validation",
      kind: issue.kind ?? issue.entityKind ?? null,
      entityId: issue.entityId ?? issue.id ?? null,
      severity: issue.severity === "warning" ? "warning" : "error"
    });
  }
  for (const mission of S.balanceReport?.missions ?? []) {
    for (const signal of missionBalanceSignals(mission)) issues.push({
      ...signal,
      source: "balance",
      kind: signal.entityId ? "tower" : "mission",
      entityId: signal.entityId ?? mission.missionId,
      severity: signal.severity === "error" ? "error" : "warning"
    });
  }
  for (const check of S.releaseDoctor?.checks ?? []) {
    if (check.severity === "ok") continue;
    issues.push({
      source: "release",
      code: check.id,
      message: `${check.label}: ${check.message}`,
      severity: check.severity === "error" ? "error" : "warning"
    });
  }
  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.source}:${issue.severity}:${issue.kind}:${issue.entityId}:${issue.code}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(issue.message);
  });
}

function renderWorkbench() {
  const body = $("workbench-body");
  if (!body) return;
  const problems = collectProblems();
  S.workbenchProblems = problems;
  if ($("workbench-problem-count")) $("workbench-problem-count").textContent = String(problems.length);
  if ($("workbench-activity-count")) $("workbench-activity-count").textContent = String(S.activity.length);
  for (const tab of ["problems", "activity"]) {
    const button = $(`workbench-tab-${tab}`);
    button?.classList.toggle("active", S.workbenchTab === tab);
    button?.setAttribute("aria-selected", String(S.workbenchTab === tab));
  }
  if (S.workbenchTab === "problems") {
    body.innerHTML = problems.length ? problems.map((issue, index) => {
      const canJump = Boolean(issue.kind && issue.entityId);
      const tag = canJump ? "button" : "div";
      const meta = [issue.source, issue.code, issue.kind && issue.entityId ? `${issue.kind}:${issue.entityId}` : null].filter(Boolean).join(" · ");
      return `<${tag} class="workbench-row ${esc(issue.severity)}"${canJump ? ` data-problem-index="${index}" type="button"` : ""}>${issue.severity === "error" ? ICO.err : ICO.warn}<span class="workbench-message">${esc(issue.message)}<span class="workbench-meta">${esc(meta)}</span></span><span></span></${tag}>`;
    }).join("") : `<div class="workbench-empty">No known problems.</div>`;
    return;
  }
  body.innerHTML = S.activity.length ? S.activity.map((item) => {
    const severity = item.status === "error" ? "error" : item.status === "warning" ? "warning" : "ok";
    const icon = severity === "error" ? ICO.err : severity === "warning" ? ICO.warn : ICO.check;
    return `<div class="workbench-row ${severity}">${icon}<span class="workbench-message">${esc(item.action)}${item.detail ? `<span class="workbench-meta">${esc(item.detail)}</span>` : ""}</span><time class="workbench-time">${esc(new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }))}</time></div>`;
  }).join("") : `<div class="workbench-empty">No activity in this session.</div>`;
}

function setWorkbench(open, tab = S.workbenchTab) {
  S.workbenchTab = tab === "activity" ? "activity" : "problems";
  document.documentElement.setAttribute("data-workbench", open ? "open" : "closed");
  $("workbench-drawer")?.setAttribute("aria-hidden", String(!open));
  $("btn-activity")?.setAttribute("aria-expanded", String(open));
  $("btn-activity")?.classList.toggle("active", open);
  renderWorkbench();
}

$("btn-activity")?.addEventListener("click", () => setWorkbench(document.documentElement.getAttribute("data-workbench") !== "open", "activity"));
$("workbench-close")?.addEventListener("click", () => setWorkbench(false));
$("workbench-tab-problems")?.addEventListener("click", () => setWorkbench(true, "problems"));
$("workbench-tab-activity")?.addEventListener("click", () => setWorkbench(true, "activity"));
$("workbench-body")?.addEventListener("click", (event) => {
  const row = event.target.closest?.("[data-problem-index]");
  if (!row) return;
  const issue = S.workbenchProblems?.[Number(row.dataset.problemIndex)];
  if (issue?.kind && issue?.entityId) jumpToEntity(issue.kind, issue.entityId);
});

function syncDirtyUi() {
  S.dirty = Boolean(S.projectDirty || S.scriptDirty);
  const badge = $("dirty-badge");
  const btn   = $("btn-save");
  if (badge) badge.classList.toggle("visible", S.dirty);
  if (btn) { btn.classList.toggle("dirty", S.dirty); btn.disabled = !S.dirty; }
  scheduleDesktopUiSync(500);
}

function markDirty(isDirty, skipHistory) {
  S.projectDirty = isDirty;
  syncDirtyUi();
  if (isDirty) {
    invalidateBalanceReport();
    if (!skipHistory) scheduleHistoryCommit();
    scheduleValidation();
    scheduleAutosave();
    PT.dirty = true; // unsaved edits should rebuild the live playtest on next open
  }
  scheduleDesktopUiSync(skipHistory ? 0 : 500);
}

function markScriptDirty(isDirty) {
  S.scriptDirty = isDirty;
  syncDirtyUi();
  if (isDirty) {
    invalidateBalanceReport();
    scheduleAutosave();
    PT.dirty = true;
  }
}

let passiveBalanceTimer = null;
let balanceRequestSerial = 0;

function balanceWarningCount(report = S.balanceReport) {
  return report?.missions?.reduce((count, mission) => count + (missionBalanceSignals(mission).length ? 1 : 0), 0) ?? 0;
}

function updateBalanceWarningUi() {
  const count = S.balanceReportRevision === S.contentHash ? balanceWarningCount() : 0;
  const badge = $("balance-warning-count");
  if (badge) {
    badge.textContent = String(count);
    badge.classList.toggle("hidden", count === 0);
    badge.title = count ? `${count} mission${count === 1 ? "" : "s"} need balance review` : "";
  }
  renderWorkbench();
}

function invalidateBalanceReport() {
  if (passiveBalanceTimer) clearTimeout(passiveBalanceTimer);
  passiveBalanceTimer = null;
  balanceRequestSerial += 1;
  if (!S.balanceReport) return;
  S.balanceReport = null;
  S.balanceReportRevision = null;
  updateBalanceWarningUi();
}

function schedulePassiveBalance(delay = 1200) {
  if (passiveBalanceTimer) clearTimeout(passiveBalanceTimer);
  if (S.dirty || !S.project || !S.contentHash) return;
  const revision = S.contentHash;
  const requestSerial = ++balanceRequestSerial;
  passiveBalanceTimer = setTimeout(async () => {
    passiveBalanceTimer = null;
    try {
      const report = await apiGet("/api/balance");
      if (requestSerial !== balanceRequestSerial || S.dirty || S.contentHash !== revision) return;
      S.balanceReport = report;
      S.balanceReportRevision = revision;
      updateBalanceWarningUi();
      if (S.activeTab === "missions") renderMissionsTab();
      if (S.activeTab === "balance") renderBalanceReport(report);
    } catch (error) {
      console.warn("Passive balance analysis unavailable:", error);
    }
  }, delay);
}

// ── API ───────────────────────────────────────────────────────────────────────
async function apiGet(path) {
  const r = await fetch(path);
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? `${r.status} ${r.statusText}`); }
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(path, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = new Error(d.error ?? `${r.status}`);
    Object.assign(error, d);
    throw error;
  }
  return d;
}

function updateAppInfoUi() {
  if ($("sidebar-version")) $("sidebar-version").textContent = `v${APP_INFO.version}`;
  const sidebarCopyright = document.querySelector(".sidebar-copyright");
  if (sidebarCopyright) sidebarCopyright.textContent = `© ${APP_INFO.studioName}`;
  if ($("about-version")) $("about-version").textContent = `Version ${APP_INFO.version}`;
  if ($("about-copyright-year")) $("about-copyright-year").textContent = String(new Date().getFullYear());
  if ($("about-studio-link")) $("about-studio-link").textContent = APP_INFO.studioName;
  const links = [
    ["about-source-link", APP_INFO.sourceUrl],
    ["about-site-link", APP_INFO.siteUrl],
    ["about-studio-link", APP_INFO.siteUrl],
    ["about-telegram-link", APP_INFO.telegramUrl]
  ];
  for (const [id, url] of links) if ($(id)) $(id).href = url;
}

async function loadAppInfo() {
  try { Object.assign(APP_INFO, await apiGet("/api/app-info")); }
  catch (error) { console.warn("App metadata unavailable:", error); }
  updateAppInfoUi();
}

// ── Load / Save ───────────────────────────────────────────────────────────────
async function load() {
  setStatus("Loading…");
  try {
    const data = await apiGet("/api/project");
    S.project = data;
    S.contentHash = data.contentHash;
    S.serverSnapshot = deep(data); // baseline for change review
    S.balanceReport = null; // stale once the project reloads
    S.balanceReportRevision = null;
    S.releaseDoctor = null; // readiness describes the saved revision only
    S.scriptDirty = false;
    S.projectTree = null;
    S.selectedProjectPath = null;
    S.scriptSource = "";
    S.scriptFileRevision = null;
    S.scriptOriginalId = null;
    markDirty(false);
    historyInit();
    PT.dirty = true; // force playtest to rebuild from the freshly loaded project
    const nameEl = $("project-name");
    if (nameEl) nameEl.textContent = data.manifest?.name ?? "Untitled";
    setStatus("Loaded");
    recordActivity("Project loaded", "ok", data.manifest?.name ?? "Untitled");
    renderActiveTab();
    scheduleDesktopUiSync();
    await maybeRecoverDraft();
    schedulePassiveBalance();
  } catch (e) {
    setStatus("Load error");
    recordActivity("Project load", "error", e.message);
    toast("Failed to load project: " + e.message, "err");
  }
}

async function save() {
  if (!S.dirty) return true;
  const btn = $("btn-save");
  if (btn) btn.disabled = true;
  setStatus("Saving…");
  try {
    if (S.projectDirty) {
      const body = {
        contentHash:      S.contentHash,
        enemies:          S.project.enemies,
        towers:           S.project.towers,
        waveSets:         S.project.waveSets,
        missions:         S.project.missions,
        abilities:        S.project.abilities,
        constants:        S.project.constants,
        currencies:       projCurrencies(),
        defaultMissionId: S.project.defaultMissionId,
        defaultDifficultyId: S.project.defaultDifficultyId,
        difficulties:     S.project.difficulties,
        metaProgression:  S.project.metaProgression,
        terrainTypes:     S.project.terrainTypes,
        worldMap:         S.project.worldMap,
        visuals:          S.project.visuals,
        storyComics:      S.project.storyComics,
        battleBackgrounds:S.project.battleBackgrounds,
        mapSources:       S.project.mapSources,
        manifest:         S.project.manifest,
        buildTargets:     S.project.buildTargets,
      };
      const res = await apiPost("/api/project/save", body);
      S.contentHash = res.newHash;
      S.projectDirty = false;
    }
    if (S.scriptDirty && !await saveActiveScript({ silent: true })) {
      syncDirtyUi();
      setStatus("Script error");
      return false;
    }
    S.serverSnapshot = deep(S.project); // saved state becomes the new baseline
    clearDraft();
    syncDirtyUi();
    setStatus("Saved");
    recordActivity("Project saved", "ok");
    toast("Project saved.", "ok");
    schedulePassiveBalance();
    return true;
  } catch (e) {
    if (e.message?.includes("changed on disk")) {
      toast("Conflict — file changed externally. Reload to re-sync.", "warn");
      setStatus("Conflict");
    } else {
      toast("Save failed: " + e.message, "err");
      setStatus("Save error");
    }
    recordActivity("Project save", "error", e.message);
    syncDirtyUi();
    return false;
  }
}

// ── Tab navigation ────────────────────────────────────────────────────────────
function switchTab(tab) {
  if (AI?.focusTimer) {
    clearTimeout(AI.focusTimer);
    AI.focusTimer = null;
  }
  if (tab !== "assets" && assetsMusicPreviewId && assetsAudio) {
    assetsAudio.selectMusic("");
    assetsMusicPreviewId = null;
  }
  S.activeTab = tab;
  document.querySelectorAll(".nav-tab").forEach(t =>
    t.classList.toggle("active", t.dataset.tab === tab));
  document.querySelectorAll(".nav-tab").forEach(t =>
    t.setAttribute("aria-selected", t.dataset.tab === tab ? "true" : "false"));
  document.querySelectorAll(".tab-panel").forEach(p =>
    p.classList.toggle("active", p.id === `tab-${tab}`));
  renderActiveTab();
  scheduleDesktopUiSync();
}

function renderActiveTab() {
  if (!S.project) return;
  const t = S.activeTab;
  if (t === "home")         renderHomeTab();
  else if (t === "waves")   renderWavesTab();
  else if (t === "enemies") renderEnemiesTab();
  else if (t === "towers")  renderTowersTab();
  else if (t === "missions") renderMissionsTab();
  else if (t === "worldmap") renderWorldMapTab();
  else if (t === "maps") renderMapsTab();
  else if (t === "playtest") renderPlaytestTab();
  else if (t === "balance") renderBalanceTab();
  else if (t === "scripts") renderScriptsTab();
  else if (t === "assets") renderAssetsTab();
  else if (t === "settings") renderSettingsTab();
  else if (t === "buildtargets") renderBuildTargetsTab();
  refreshValidationUI();
}

function homeWorkflowIcon(kind) {
  const icons = {
    author: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
    play: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    balance: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-7"/></svg>`,
    ai: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/><path d="M5 17l.8 2.2L8 20l-2.2.8L5 23l-.8-2.2L2 20l2.2-.8L5 17z"/></svg>`,
    ship: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>`
  };
  return icons[kind] ?? icons.author;
}

function renderHomeTab() {
  const body = $("project-home-body");
  if (!body || !S.project) return;
  const project = S.project;
  const counts = [
    ["Missions", Object.keys(project.missions ?? {}).length],
    ["Towers", Object.keys(project.towers ?? {}).length],
    ["Enemies", Object.keys(project.enemies ?? {}).length],
    ["Maps", Object.keys(project.maps ?? {}).length]
  ];
  const workflows = [
    ["author", "Author", "Build waves, enemies, towers, missions, and maps.", "navigate.waves", "Open"],
    ["play", "Playtest", "Run the selected mission and inspect deterministic events.", "project.playtest", "Play"],
    ["balance", "Balance", "Compare strategies, leaks, upgrades, and placement sensitivity.", "project.balance", "Analyze"],
    ["ai", "Collaborate", "Give a scoped Ask, Plan, or Act task to the connected AI.", "project.ai_designer", "AI Chat"],
    ["ship", "Ship", "Review targets and prepare browser or native game builds.", "navigate.buildtargets", "Configure"]
  ];
  const readiness = S.releaseDoctor?.checks ?? [];
  const workingCopy = {
    label: "Working copy",
    message: S.dirty ? "Unsaved edits are not included in Release Doctor." : "Saved files and the editor are in sync.",
    severity: S.dirty ? "warning" : "ok"
  };
  const checks = readiness.length
    ? [workingCopy, ...readiness]
    : [workingCopy, { label: "Release readiness", message: "Run Release Doctor to validate maps, identity, content, and build targets.", severity: "warning" }];
  const recent = S.activity.slice(0, 5);

  body.innerHTML = `
    <div class="home-identity">
      <div><h1>${esc(project.manifest?.name ?? "Untitled Project")}</h1><p>${esc(project.manifest?.description ?? `Default mission: ${project.defaultMissionId ?? "not set"}`)}</p></div>
      <div class="home-counts">${counts.map(([label, value]) => `<span class="home-count"><b>${value}</b>${esc(label)}</span>`).join("")}</div>
    </div>
    <section class="home-section" aria-labelledby="home-workflow-title">
      <div class="home-section-head"><h3 id="home-workflow-title">Workflow</h3><span class="home-section-note">One project · deterministic runtime</span></div>
      ${workflows.map(([kind, title, description, command, action]) => `<div class="home-workflow-row"><span class="home-workflow-icon" aria-hidden="true">${homeWorkflowIcon(kind)}</span><span class="home-workflow-main"><strong>${esc(title)}</strong><span>${esc(description)}</span></span><button class="btn btn-outline" type="button" data-home-command="${esc(command)}">${esc(action)}</button></div>`).join("")}
    </section>
    <section class="home-section" aria-labelledby="home-readiness-title">
      <div class="home-section-head"><h3 id="home-readiness-title">Production Readiness</h3>${S.releaseDoctor ? `<span class="home-section-note">Saved revision checked</span>` : ""}</div>
      ${checks.map((check) => `<div class="home-check-row"><span class="home-workflow-icon ${esc(check.severity)}" aria-hidden="true">${check.severity === "ok" ? ICO.check : check.severity === "error" ? ICO.err : ICO.warn}</span><span class="home-check-main"><strong>${esc(check.label)}</strong><span>${esc(check.message)}</span></span><span class="home-check-state ${esc(check.severity)}">${esc(check.severity)}</span></div>`).join("")}
    </section>
    <section class="home-section" aria-labelledby="home-activity-title">
      <div class="home-section-head"><h3 id="home-activity-title">Recent Activity</h3><button class="home-link-button" type="button" data-home-activity>View all</button></div>
      ${recent.length ? recent.map((item) => `<div class="home-activity-row"><time>${esc(new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</time><span>${esc(item.action)}${item.detail ? ` · ${esc(item.detail)}` : ""}</span><span class="home-check-state ${item.status === "error" ? "error" : item.status === "warning" ? "warning" : "ok"}">${esc(item.status)}</span></div>`).join("") : `<div class="workbench-empty">No activity in this session.</div>`}
    </section>`;

  body.querySelectorAll("[data-home-command]").forEach((button) => button.addEventListener("click", () => runStudioCommand(button.dataset.homeCommand)));
  body.querySelector("[data-home-activity]")?.addEventListener("click", () => setWorkbench(true, "activity"));
}

async function runReleaseDoctor() {
  const button = $("btn-release-doctor");
  await withButtonSpinner(button, async () => {
    setStatus("Checking release readiness…");
    try {
      const result = await apiGet("/api/release-doctor");
      S.releaseDoctor = result;
      S.serverValidation = result.validation;
      const errors = result.checks.filter((check) => check.severity === "error").length;
      const warnings = result.checks.filter((check) => check.severity === "warning").length + (S.dirty ? 1 : 0);
      recordActivity("Release Doctor", errors ? "error" : warnings ? "warning" : "ok", `${errors} errors, ${warnings} warnings`);
      renderWorkbench();
      renderHomeTab();
      setStatus(errors ? "Release blocked" : warnings ? "Release has warnings" : "Release ready");
      toast(errors ? "Release Doctor found blocking issues." : warnings ? "Release Doctor completed with warnings." : "Saved project is release-ready.", errors ? "err" : warnings ? "warn" : "ok");
    } catch (error) {
      setStatus("Release check failed");
      recordActivity("Release Doctor", "error", error.message);
      toast("Release Doctor failed: " + error.message, "err");
    }
  });
}

$("btn-release-doctor")?.addEventListener("click", runReleaseDoctor);

// ═════════════════════════════════════════════════════════════════════════════
// AI CHAT — account/API connections live in Settings; the working chat stays docked on the right.
// ═════════════════════════════════════════════════════════════════════════════
const AI = {
  messages: [],
  busy: false,
  controller: null,
  wired: false,
  provider: null,
  modelCatalogs: {},
  modelLoading: new Set(),
  runtimeStatus: {},
  runtimeStatusLoading: null,
  runtimePollTimer: null,
  attachments: [],
  dockOpen: false,
  activateOnConnect: null,
  focusTimer: null,
  pendingReview: null
};
const AI_LEGACY_KEY_LS = "towerforge:anthropic-key";
const AI_LEGACY_MODEL_LS = "towerforge:ai-model";
const AI_KEYS_LS = "towerforge:ai-keys";
const AI_MODELS_LS = "towerforge:ai-models";
const AI_CUSTOM_MODELS_LS = "towerforge:ai-custom-models";
const AI_PROVIDER_LS = "towerforge:ai-provider";
const AI_REASONING_LS = "towerforge:ai-reasoning";
const AI_PERMISSION_MODE_LS = "towerforge:ai-permission-mode";
const AI_MODEL_ID_RE = /^[A-Za-z0-9~][A-Za-z0-9._:/~+@-]{0,199}$/;
const AI_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const AI_REASONING_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const AI_PROVIDERS = {
  codex: {
    label: "Codex (ChatGPT)",
    auth: "runtime",
    defaultModel: "default",
    reasoningLevels: AI_REASONING_LEVELS,
    models: [
      { id: "default", label: "Account default" },
      { id: "gpt-5.6", label: "GPT-5.6" },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra (fast)" }
    ]
  },
  "claude-code": {
    label: "Claude Code",
    auth: "runtime",
    defaultModel: "sonnet",
    reasoningLevels: ["low", "medium", "high", "max"],
    models: [
      { id: "sonnet", label: "Sonnet (balanced)" },
      { id: "opus", label: "Opus (deep)" },
      { id: "haiku", label: "Haiku (fast)" }
    ]
  },
  anthropic: {
    label: "Anthropic",
    auth: "apiKey",
    keyLabel: "Anthropic API key",
    keyPlaceholder: "sk-ant-...",
    defaultModel: "claude-sonnet-5",
    reasoningLevels: ["low", "medium", "high", "max"],
    models: [
      { id: "claude-sonnet-5", label: "Sonnet 5 (balanced)" },
      { id: "claude-opus-4-8", label: "Opus 4.8 (deep)" },
      { id: "claude-fable-5", label: "Fable 5 (maximum)" },
      { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5 (cheap)" }
    ]
  },
  openai: {
    label: "OpenAI",
    auth: "apiKey",
    keyLabel: "OpenAI API key",
    keyPlaceholder: "sk-...",
    defaultModel: "gpt-5.6-terra",
    reasoningLevels: ["low", "medium", "high", "xhigh"],
    models: [
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra (balanced)" },
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol (deep)" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna (cheap)" }
    ]
  },
  openrouter: {
    label: "OpenRouter",
    auth: "apiKey",
    keyLabel: "OpenRouter token",
    keyPlaceholder: "sk-or-v1-...",
    defaultModel: "openrouter/auto",
    reasoningLevels: ["low", "medium", "high", "xhigh"],
    models: [
      { id: "openrouter/auto", label: "Auto Router" },
      { id: "~openai/gpt-latest", label: "OpenAI GPT Latest" }
    ]
  }
};

function aiReadStorage(key, fallback = {}) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function aiInitStorage() {
  const legacyKey = localStorage.getItem(AI_LEGACY_KEY_LS);
  if (legacyKey) {
    const keys = aiReadStorage(AI_KEYS_LS);
    if (!keys.anthropic) keys.anthropic = legacyKey;
    localStorage.setItem(AI_KEYS_LS, JSON.stringify(keys));
    localStorage.removeItem(AI_LEGACY_KEY_LS);
  }
  const legacyModel = localStorage.getItem(AI_LEGACY_MODEL_LS);
  if (legacyModel) {
    const models = aiReadStorage(AI_MODELS_LS);
    if (!models.anthropic) models.anthropic = legacyModel;
    localStorage.setItem(AI_MODELS_LS, JSON.stringify(models));
    localStorage.removeItem(AI_LEGACY_MODEL_LS);
  }
}

function aiProvider() {
  const value = AI.provider || localStorage.getItem(AI_PROVIDER_LS) || "codex";
  return AI_PROVIDERS[value] ? value : "codex";
}

function aiProviderInfo(provider = aiProvider()) {
  return AI_PROVIDERS[provider] || AI_PROVIDERS.anthropic;
}

function aiIsRuntime(provider = aiProvider()) {
  return aiProviderInfo(provider).auth === "runtime";
}

function aiRuntimeStatus(provider = aiProvider()) {
  return AI.runtimeStatus[provider] || null;
}

function aiKeys() {
  return aiReadStorage(AI_KEYS_LS);
}

function aiKey(provider = aiProvider()) {
  const value = aiKeys()[provider];
  return typeof value === "string" ? value : "";
}

function aiHasKey(provider = aiProvider()) {
  return Boolean(aiKey(provider));
}

function aiIsReady(provider = aiProvider()) {
  return aiIsRuntime(provider) ? Boolean(aiRuntimeStatus(provider)?.connected) : aiHasKey(provider);
}

function aiAnyReady() {
  return Object.keys(AI_PROVIDERS).some((provider) => aiIsReady(provider));
}

function aiSetKey(provider, value) {
  const keys = aiKeys();
  if (value) keys[provider] = value;
  else delete keys[provider];
  localStorage.setItem(AI_KEYS_LS, JSON.stringify(keys));
}

function aiStoredModel(provider = aiProvider()) {
  const value = aiReadStorage(AI_MODELS_LS)[provider];
  return typeof value === "string" && AI_MODEL_ID_RE.test(value) ? value : aiProviderInfo(provider).defaultModel;
}

function aiSetStoredModel(provider, model) {
  const models = aiReadStorage(AI_MODELS_LS);
  models[provider] = model;
  localStorage.setItem(AI_MODELS_LS, JSON.stringify(models));
}

function aiStoredReasoning(provider = aiProvider()) {
  const value = aiReadStorage(AI_REASONING_LS)[provider];
  return value === "default" || AI_REASONING_LEVELS.includes(value) ? value : "default";
}

function aiSetStoredReasoning(provider, reasoning) {
  const values = aiReadStorage(AI_REASONING_LS);
  values[provider] = reasoning;
  localStorage.setItem(AI_REASONING_LS, JSON.stringify(values));
}

function aiPermissionMode() {
  const value = localStorage.getItem(AI_PERMISSION_MODE_LS) || "ask";
  return ["ask", "plan", "act"].includes(value) ? value : "ask";
}

function aiCustomModels(provider = aiProvider()) {
  const values = aiReadStorage(AI_CUSTOM_MODELS_LS)[provider];
  return Array.isArray(values) ? values.filter((value) => typeof value === "string" && AI_MODEL_ID_RE.test(value)) : [];
}

function aiAddCustomModel(provider, model) {
  const all = aiReadStorage(AI_CUSTOM_MODELS_LS);
  const values = Array.isArray(all[provider]) ? all[provider] : [];
  all[provider] = [...new Set([...values, model])].slice(-50);
  localStorage.setItem(AI_CUSTOM_MODELS_LS, JSON.stringify(all));
}

function aiAvailableModels(provider = aiProvider()) {
  const byId = new Map();
  for (const model of aiProviderInfo(provider).models) byId.set(model.id, model);
  if (Array.isArray(AI.modelCatalogs[provider])) {
    for (const model of AI.modelCatalogs[provider]) {
      if (!byId.has(model.id)) byId.set(model.id, { id: model.id, label: model.name || model.id });
      else byId.set(model.id, { ...byId.get(model.id), ...model, label: model.label || model.name || byId.get(model.id).label });
    }
  }
  for (const id of aiCustomModels(provider)) {
    if (!byId.has(id)) byId.set(id, { id, label: `${id} (custom)` });
  }
  return [...byId.values()];
}

function renderAiModelOptions(provider = aiProvider()) {
  const selected = aiStoredModel(provider);
  const models = aiAvailableModels(provider);
  if (!models.some((model) => model.id === selected)) models.unshift({ id: selected, label: `${selected} (custom)` });
  for (const id of ["ai-model", "setting-ai-model"]) {
    const select = $(id);
    if (!select) continue;
    select.innerHTML = models.map((model) => `<option value="${esc(model.id)}">${esc(model.label)}</option>`).join("");
    if (AI.modelLoading.has(provider)) select.insertAdjacentHTML("beforeend", '<option disabled value="">Loading models...</option>');
    select.value = selected;
  }
  renderAiReasoningOptions(provider);
}

async function loadAiModels(provider = aiProvider(), force = false) {
  if (!["codex", "claude-code", "openrouter"].includes(provider)) return;
  if (AI.modelLoading.has(provider) || (!force && Array.isArray(AI.modelCatalogs[provider]))) return;
  if (aiIsRuntime(provider) && !aiIsReady(provider)) return;
  AI.modelLoading.add(provider);
  renderAiModelOptions(provider);
  try {
    const response = await fetch(`/api/ai/models?provider=${encodeURIComponent(provider)}`);
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    const payload = await response.json();
    AI.modelCatalogs[provider] = Array.isArray(payload.models) ? payload.models : [];
  } catch (error) {
    AI.modelCatalogs[provider] = [];
    toast(`${aiProviderInfo(provider).label} model catalog unavailable: ${error.message}`, "warn");
  } finally {
    AI.modelLoading.delete(provider);
    if (aiProvider() === provider) renderAiModelOptions(provider);
  }
}

function aiCurrentModelInfo(provider = aiProvider()) {
  const id = aiStoredModel(provider);
  return aiAvailableModels(provider).find((model) => model.id === id) || null;
}

function renderAiReasoningOptions(provider = aiProvider()) {
  const model = aiCurrentModelInfo(provider);
  const dynamic = Array.isArray(model?.reasoningLevels) ? model.reasoningLevels.filter((level) => AI_REASONING_LEVELS.includes(level)) : [];
  const levels = dynamic.length ? dynamic : aiProviderInfo(provider).reasoningLevels || AI_REASONING_LEVELS;
  const suggested = model?.defaultReasoning && levels.includes(model.defaultReasoning) ? ` (${model.defaultReasoning})` : "";
  const selected = aiStoredReasoning(provider);
  const options = [
    { id: "default", label: `Default${suggested}` },
    ...levels.map((id) => ({ id, label: id === "xhigh" ? "Extra high" : id[0].toUpperCase() + id.slice(1) }))
  ];
  for (const id of ["ai-reasoning", "setting-ai-reasoning"]) {
    const select = $(id);
    if (!select) continue;
    select.innerHTML = options.map((option) => `<option value="${option.id}">${esc(option.label)}</option>`).join("");
    select.value = options.some((option) => option.id === selected) ? selected : "default";
  }
}

function renderAiProviderOptions() {
  const account = ["codex", "claude-code"];
  const direct = ["anthropic", "openai", "openrouter"];
  const option = (provider) => `<option value="${provider}">${esc(AI_PROVIDERS[provider].label)}</option>`;
  const html = `<optgroup label="Account runtimes">${account.map(option).join("")}</optgroup><optgroup label="API keys">${direct.map(option).join("")}</optgroup>`;
  for (const id of ["ai-provider", "setting-ai-provider"]) {
    const select = $(id);
    if (!select) continue;
    select.innerHTML = html;
    select.value = aiProvider();
  }
}

function clearAiConversation() {
  AI.controller?.abort();
  AI.messages = [];
  AI.attachments = [];
  if ($("ai-transcript")) $("ai-transcript").innerHTML = "";
  renderAiAttachments();
  renderAiEmpty();
}

function setAiProvider(provider, { announce = true } = {}) {
  if (!AI_PROVIDERS[provider]) return;
  const changed = AI.provider !== provider;
  AI.provider = provider;
  localStorage.setItem(AI_PROVIDER_LS, provider);
  renderAiProviderOptions();
  renderAiModelOptions(provider);
  updateAiUi();
  if (changed) {
    clearAiConversation();
    if (announce) toast(`AI provider: ${aiProviderInfo(provider).label}. New chat started.`, "ok");
  }
  loadAiModels(provider);
}

function scheduleAiRuntimePolling(provider) {
  clearInterval(AI.runtimePollTimer);
  let attempts = 0;
  AI.runtimePollTimer = setInterval(async () => {
    attempts += 1;
    const status = await loadAiRuntimeStatus(provider, true);
    if (status?.connected) {
      setAiProvider(provider, { announce: false });
      AI.activateOnConnect = null;
      await loadAiModels(provider, true);
      setAiDockOpen(true);
      toast(`${aiProviderInfo(provider).label} connected.`, "ok");
    }
    if (status?.connected || attempts >= 80) {
      clearInterval(AI.runtimePollTimer);
      AI.runtimePollTimer = null;
    }
  }, 1_500);
}

async function loadAiRuntimeStatus(provider = aiProvider(), force = false) {
  if (!aiIsRuntime(provider)) return null;
  if (AI.runtimeStatusLoading === provider) return aiRuntimeStatus(provider);
  if (!force && aiRuntimeStatus(provider)) return aiRuntimeStatus(provider);
  AI.runtimeStatusLoading = provider;
  updateAiUi();
  try {
    const response = await fetch(`/api/ai/runtime/status?provider=${encodeURIComponent(provider)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Server returned ${response.status}`);
    AI.runtimeStatus[provider] = payload;
    return payload;
  } catch (error) {
    AI.runtimeStatus[provider] = { provider, available: false, connected: false, error: error.message };
    return AI.runtimeStatus[provider];
  } finally {
    if (AI.runtimeStatusLoading === provider) AI.runtimeStatusLoading = null;
    updateAiUi();
    if (aiProvider() === provider) {
      if (AI.runtimeStatus[provider]?.connected) loadAiModels(provider, force);
      if (!AI.messages.length) renderAiEmpty();
    }
  }
}

async function postAiRuntime(pathname, provider) {
  const response = await fetch(pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Server returned ${response.status}`);
  return payload;
}

async function openAiAuthUrl(url) {
  if (!url) return;
  if (isDesktopShell()) await desktopInvoke("desktop_open_external", { url });
  else window.open(url, "_blank", "noopener,noreferrer");
}

async function aiRuntimeConnect(provider = aiProvider()) {
  if (!aiIsRuntime(provider)) return;
  const button = document.querySelector(`[data-ai-connect="${CSS.escape(provider)}"]`);
  if (button) button.disabled = true;
  try {
    const payload = await postAiRuntime("/api/ai/runtime/connect", provider);
    if (payload.authUrl) await openAiAuthUrl(payload.authUrl);
    AI.runtimeStatus[provider] = { provider, available: true, connected: false, authenticating: true };
    AI.activateOnConnect = provider;
    updateAiUi();
    renderAiEmpty();
    scheduleAiRuntimePolling(provider);
  } catch (error) {
    toast(`Could not start ${aiProviderInfo(provider).label} sign-in: ${error.message}`, "err");
    await loadAiRuntimeStatus(provider, true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function aiRuntimeDisconnect(provider = aiProvider()) {
  if (!aiIsRuntime(provider)) return;
  if (!await confirmDialog({
    title: `Disconnect ${aiProviderInfo(provider).label}?`,
    message: "This removes TowerForge's account session from the official runtime. Other apps and API keys are not touched.",
    confirmLabel: "Disconnect",
    danger: true
  })) return;
  try {
    await postAiRuntime("/api/ai/runtime/disconnect", provider);
    AI.runtimeStatus[provider] = { provider, available: true, connected: false };
    delete AI.modelCatalogs[provider];
    if (aiProvider() === provider) clearAiConversation();
    updateAiUi();
  } catch (error) {
    toast(`Could not disconnect: ${error.message}`, "err");
  }
}

async function removeAiKey(provider) {
  if (!await confirmDialog({
    title: `Remove ${aiProviderInfo(provider).label} key?`,
    message: "The key stored on this device will be deleted. Project files are not changed.",
    confirmLabel: "Remove key",
    danger: true
  })) return;
  aiSetKey(provider, "");
  if (aiProvider() === provider) clearAiConversation();
  updateAiUi();
  toast(`${aiProviderInfo(provider).label} key removed.`, "ok");
}

/** Tiny safe markdown: escape, then **bold**, `code`, and newlines. */
function aiMarkdown(text) {
  return esc(String(text))
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

function ensureAiInitialized() {
  if (!AI.provider) {
    aiInitStorage();
    const stored = localStorage.getItem(AI_PROVIDER_LS) || "codex";
    AI.provider = AI_PROVIDERS[stored] ? stored : "codex";
  }
  renderAiProviderOptions();
  renderAiModelOptions(AI.provider);
  if (!AI.wired) wireAi();
  updateAiUi();
  if (!AI.messages.length) renderAiEmpty();
  loadAiModels(AI.provider);
}

function wireAi() {
  AI.wired = true;
  $("ai-mode")?.addEventListener("change", () => {
    localStorage.setItem(AI_PERMISSION_MODE_LS, $("ai-mode").value);
    updateAiUi();
  });
  $("ai-provider")?.addEventListener("change", () => {
    setAiProvider($("ai-provider").value);
  });
  $("ai-model")?.addEventListener("change", () => {
    const model = $("ai-model")?.value;
    if (model) { aiSetStoredModel(aiProvider(), model); renderAiModelOptions(aiProvider()); updateAiUi(); }
  });
  $("ai-reasoning")?.addEventListener("change", () => {
    aiSetStoredReasoning(aiProvider(), $("ai-reasoning").value);
    renderAiReasoningOptions(aiProvider());
  });
  $("ai-form")?.addEventListener("submit", (e) => { e.preventDefault(); aiSend(); });
  $("ai-stop")?.addEventListener("click", () => AI.controller?.abort());
  $("ai-input")?.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); aiSend(); } });
  $("ai-attach")?.addEventListener("click", () => $("ai-file-input")?.click());
  $("ai-file-input")?.addEventListener("change", (event) => addAiFiles(event.target.files));
  $("ai-attachments")?.addEventListener("click", (event) => {
    const remove = event.target.closest?.("[data-ai-remove-attachment]");
    if (!remove || AI.busy) return;
    AI.attachments.splice(Number(remove.dataset.aiRemoveAttachment), 1);
    renderAiAttachments();
  });
  $("ai-transcript")?.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-ai-open-settings]")) switchTab("settings");
    if (event.target.closest?.("[data-ai-review-details]") && AI.pendingReview) {
      showChangeReviewBetween(AI.pendingReview.before, AI.pendingReview.after, "AI changes from last turn");
    }
    if (event.target.closest?.("[data-ai-review-keep]") && AI.pendingReview) {
      recordActivity("AI changes kept", "ok");
      finishAiReview("kept");
    }
    if (event.target.closest?.("[data-ai-review-revert]")) revertAiReview();
  });
}

function renderAiEmpty() {
  const transcript = $("ai-transcript");
  if (!transcript || AI.messages.length) return;
  let authPrompt = "";
  if (aiIsRuntime()) {
    const status = aiRuntimeStatus();
    if (!status) authPrompt = `<b>Checking ${esc(aiProviderInfo().label)}...</b><br><br>`;
    else if (status.authenticating) authPrompt = `<b>Complete sign-in in your browser.</b><br><br>`;
    else if (!status.available) authPrompt = `<b>${esc(status.error || "Official runtime is unavailable.")}</b><br><br>`;
    else if (!status.connected) authPrompt = `<b>Connect your ${esc(aiProviderInfo().label)} account to begin.</b><br><br>`;
    authPrompt += `OAuth credentials stay inside the official runtime. Prompts, selected attachments, and required TowerForge tool results are sent to ${esc(aiProviderInfo().label)}.<br><br>`;
  } else if (!aiHasKey()) {
    authPrompt = `<b>Set your ${esc(aiProviderInfo().keyLabel)} in Settings</b> to begin. It stays on this device and is never committed.<br><br>`;
  }
  transcript.innerHTML = `<div class="ai-empty">${authPrompt}Ask about the current screen, attach a visual reference, balance a mission, or author content through validated tools.<br><button class="btn btn-outline" type="button" data-ai-open-settings>AI Settings</button></div>`;
}

function runtimeStatusText(provider) {
  const info = aiProviderInfo(provider);
  const status = aiRuntimeStatus(provider);
  if (AI.runtimeStatusLoading === provider) return "Checking account...";
  if (status?.connected) return `${status.method || info.label}${status.subscription ? ` · ${status.subscription}` : ""}`;
  if (status?.authenticating) return "Waiting for browser sign-in...";
  if (status?.available === false) return status.error || "Runtime unavailable";
  return "Not connected";
}

function renderAiConnectionSettings() {
  const host = $("ai-connections-list");
  if (!host) return;
  const drafts = new Map([...host.querySelectorAll("[data-ai-key-input]")].map((input) => [input.dataset.aiKeyInput, input.value]));
  const runtimeCard = (provider, description) => {
    const status = aiRuntimeStatus(provider);
    const connected = Boolean(status?.connected);
    return `<article class="ai-connection-card">
      <div class="ai-connection-head"><span class="ai-runtime-indicator" data-state="${connected ? "connected" : status?.authenticating ? "pending" : "disconnected"}"></span><strong>${esc(aiProviderInfo(provider).label)}</strong><span class="ai-connection-type">Account</span></div>
      <p>${esc(description)}</p>
      <div class="ai-connection-status">${esc(runtimeStatusText(provider))}</div>
      <div class="ai-connection-actions">
        <button class="btn btn-primary" type="button" data-ai-connect="${provider}"${connected ? " hidden" : ""}>${status?.authenticating ? "Open sign-in again" : "Connect"}</button>
        <button class="btn btn-outline" type="button" data-ai-disconnect="${provider}"${connected ? "" : " hidden"}>Disconnect</button>
      </div>
    </article>`;
  };
  const keyRow = (provider) => {
    const info = aiProviderInfo(provider);
    const saved = aiHasKey(provider);
    return `<div class="ai-api-key-row">
      <div><strong>${esc(info.label)}</strong><span>${saved ? "Key saved on this device" : "Not configured"}</span></div>
      <input data-ai-key-input="${provider}" type="password" class="mono" placeholder="${esc(saved ? `${info.keyLabel} saved; paste to replace` : info.keyPlaceholder)}" autocomplete="new-password">
      <button class="btn btn-outline" type="button" data-ai-save-key="${provider}">Save</button>
      <button class="btn-icon danger" type="button" data-ai-remove-key="${provider}" title="Remove key" aria-label="Remove ${esc(info.label)} key"${saved ? "" : " hidden"}>${ICO.trash}</button>
    </div>`;
  };
  host.innerHTML = `<div class="ai-connection-grid">
    ${runtimeCard("codex", "Use your ChatGPT plan through the official Codex App Server OAuth flow.")}
    ${runtimeCard("claude-code", "Use your Claude account through the bundled official Claude Code runtime.")}
  </div>
  <div class="ai-connection-note">TowerForge never reads OAuth tokens. Account runtimes use private app-data storage, an isolated workspace, and only validated TowerForge tools.</div>
  <div class="ai-api-keys">${["anthropic", "openai", "openrouter"].map(keyRow).join("")}</div>`;
  for (const [provider, value] of drafts) {
    const input = host.querySelector(`[data-ai-key-input="${CSS.escape(provider)}"]`);
    if (input) input.value = value;
  }
}

function updateAiUi() {
  const info = aiProviderInfo();
  const ready = aiIsReady();
  const modeLabel = aiPermissionMode()[0].toUpperCase() + aiPermissionMode().slice(1);
  if ($("ai-dock-status")) $("ai-dock-status").textContent = ready ? `${modeLabel} · ${info.label} · ${aiStoredModel()}` : aiIsRuntime() ? `${modeLabel} · ${runtimeStatusText(aiProvider())}` : `${modeLabel} · ${info.keyLabel} required`;
  if ($("ai-chat-status-dot")) $("ai-chat-status-dot").dataset.state = aiAnyReady() ? "ready" : "offline";
  if ($("btn-ai-chat")) $("btn-ai-chat").classList.toggle("active", AI.dockOpen);
  if ($("ai-mode")) $("ai-mode").value = aiPermissionMode();
  renderAiConnectionSettings();
  aiSetBusy(AI.busy);
}

function saveAiCustomModel() {
  const input = $("setting-ai-custom-model");
  const model = input?.value.trim() || "";
  if (!AI_MODEL_ID_RE.test(model)) {
    toast("Enter a valid model ID (letters, numbers, ., -, _, /, :, ~, + or @).", "warn");
    return;
  }
  const provider = aiProvider();
  aiAddCustomModel(provider, model);
  aiSetStoredModel(provider, model);
  if (input) input.value = "";
  renderAiModelOptions(provider);
  toast(`Model added: ${model}`, "ok");
}

function aiBubble(role, html) {
  const t = $("ai-transcript");
  const div = document.createElement("div");
  div.className = `ai-msg ai-${role}`;
  div.innerHTML = html;
  t.appendChild(div);
  t.scrollTop = t.scrollHeight;
  return div;
}

function aiSetBusy(b) {
  AI.busy = b;
  if ($("ai-send")) $("ai-send").hidden = b;
  if ($("ai-stop")) $("ai-stop").hidden = !b;
  if ($("ai-input")) $("ai-input").disabled = b;
  if ($("ai-mode")) $("ai-mode").disabled = b;
  if ($("ai-provider")) $("ai-provider").disabled = b;
  if ($("ai-model")) $("ai-model").disabled = b;
  if ($("ai-reasoning")) $("ai-reasoning").disabled = b;
  const supportsImages = aiCurrentModelInfo()?.inputModalities?.includes("image") !== false;
  if ($("ai-attach")) {
    $("ai-attach").disabled = b || !supportsImages;
    $("ai-attach").title = supportsImages ? "Attach image or video" : "Selected model does not accept images";
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function base64ByteLength(value) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor(value.length * 3 / 4) - padding;
}

async function imageAttachmentFromBlob(blob, name, sourceKind = "image", timestampSeconds = null) {
  if (!AI_IMAGE_TYPES.has(blob.type)) throw new Error("Use JPEG, PNG, GIF, or WebP images.");
  if (blob.size > 4 * 1024 * 1024) throw new Error(`${name} is larger than 4 MB.`);
  return { name, mimeType: blob.type, data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())), sourceKind, timestampSeconds };
}

function waitForMedia(element, event, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Media decoding timed out.")), timeoutMs);
    const done = () => { clearTimeout(timer); cleanup(); resolve(); };
    const fail = () => { clearTimeout(timer); cleanup(); reject(new Error("This media format could not be decoded.")); };
    const cleanup = () => { element.removeEventListener(event, done); element.removeEventListener("error", fail); };
    element.addEventListener(event, done, { once: true });
    element.addEventListener("error", fail, { once: true });
  });
}

async function sampleVideoAttachment(file) {
  if (file.size > 200 * 1024 * 1024) throw new Error(`${file.name} is larger than 200 MB.`);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "metadata";
  const url = URL.createObjectURL(file);
  video.src = url;
  try {
    await waitForMedia(video, "loadedmetadata");
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) throw new Error("Video metadata is invalid.");
    const times = video.duration < 1 ? [video.duration / 2] : [0.08, 0.36, 0.64, 0.92].map((ratio) => Math.min(video.duration - 0.05, video.duration * ratio));
    const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    const frames = [];
    for (const time of times) {
      video.currentTime = Math.max(0, time);
      await waitForMedia(video, "seeked");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (!blob) throw new Error("Could not sample the video frame.");
      const timestamp = Math.round(time * 10) / 10;
      frames.push(await imageAttachmentFromBlob(blob, `${file.name} frame ${timestamp}s`, "video-frame", timestamp));
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
  }
}

async function addAiFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length || AI.busy) return;
  if (aiCurrentModelInfo()?.inputModalities?.includes("image") === false) {
    toast("The selected model does not accept image input.", "warn");
    return;
  }
  try {
    const next = [...AI.attachments];
    for (const file of files) {
      const attachments = file.type.startsWith("video/")
        ? await sampleVideoAttachment(file)
        : [await imageAttachmentFromBlob(file, file.name)];
      if (next.length + attachments.length > 8) throw new Error("Attach at most 8 images or sampled video frames per message.");
      next.push(...attachments);
      if (next.reduce((total, attachment) => total + base64ByteLength(attachment.data), 0) > 10 * 1024 * 1024) {
        throw new Error("Attachments must total 10 MB or less.");
      }
    }
    AI.attachments = next;
    renderAiAttachments();
    toast(files.some((file) => file.type.startsWith("video/")) ? "Video sampled locally. Only still frames will be sent." : "Attachment ready.", "ok");
  } catch (error) {
    toast(`Attachment failed: ${error.message}`, "err");
  } finally {
    if ($("ai-file-input")) $("ai-file-input").value = "";
  }
}

function renderAiAttachments() {
  const host = $("ai-attachments");
  if (!host) return;
  host.hidden = !AI.attachments.length;
  host.innerHTML = AI.attachments.map((attachment, index) => `<div class="ai-attachment-chip">
    <img src="data:${attachment.mimeType};base64,${attachment.data}" alt="">
    <span title="${esc(attachment.name)}">${esc(attachment.name)}</span>
    <button type="button" data-ai-remove-attachment="${index}" title="Remove attachment" aria-label="Remove attachment">${ICO.x}</button>
  </div>`).join("");
}

function aiCurrentSelection() {
  if (S.activeTab === "waves" && S.waveMissionId) return { collection: "missions", id: S.waveMissionId };
  if (S.activeTab === "enemies" && S.selectedEnemyId) return { collection: "enemies", id: S.selectedEnemyId };
  if (S.activeTab === "towers" && S.selectedTowerId) return { collection: "towers", id: S.selectedTowerId };
  if (S.activeTab === "missions" && S.selectedMissionEdId) return { collection: "missions", id: S.selectedMissionEdId };
  if (S.activeTab === "worldmap" && S.selectedNodeId) return { collection: "missions", id: S.selectedNodeId };
  if (S.activeTab === "maps" && S.selectedMapSourceName) return { collection: "mapSources", id: S.selectedMapSourceName };
  if (S.activeTab === "playtest" && PT?.missionId) return { collection: "missions", id: PT.missionId };
  return null;
}

function aiLastRunContext() {
  if (S.activeTab === "playtest" && PT?.game) {
    const snapshot = PT.game.getSnapshot();
    return {
      kind: "playtest",
      missionId: PT.missionId,
      summary: `${snapshot.outcome}; core ${snapshot.coreHp}/${snapshot.maxCoreHp}; wave ${snapshot.waveIndex ?? 0}/${snapshot.totalWaves ?? 0}; enemies ${snapshot.enemies?.length ?? 0}; towers ${snapshot.towers?.length ?? 0}`
    };
  }
  if (S.activeTab === "balance" && S.balanceReport?.summary) {
    const summary = S.balanceReport.summary;
    return {
      kind: "balance",
      missionId: null,
      summary: `${summary.missions ?? 0} missions analyzed; ${summary.flagged ?? 0} flagged; ${summary.errors ?? 0} errors; ${summary.warnings ?? 0} warnings`
    };
  }
  if (S.lastSimulation) {
    const result = S.lastSimulation;
    return {
      kind: "simulation",
      missionId: result.missionId,
      summary: `${result.outcome}; core ${result.coreHp}/${result.maxCoreHp}; waves ${result.startedWaveCount}/${result.totalWaves}; elapsed ${result.elapsed}`
    };
  }
  return null;
}

function aiContextEnvelope() {
  const issues = (S.clientIssues ?? []).slice(0, 20).map((issue) => ({
    severity: issue.severity === "warning" ? "warning" : "error",
    kind: issue.kind,
    entityId: issue.entityId,
    code: issue.code,
    message: issue.message
  }));
  return {
    activeTab: S.activeTab,
    project: {
      name: S.project?.manifest?.name || "Untitled",
      defaultMissionId: S.project?.defaultMissionId || null,
      dirty: Boolean(S.dirty)
    },
    selection: aiCurrentSelection(),
    validation: {
      errorCount: issues.filter((issue) => issue.severity === "error").length,
      warningCount: issues.filter((issue) => issue.severity === "warning").length,
      issues
    },
    lastRun: aiLastRunContext()
  };
}

function appendAiReviewCard(host, review) {
  const rows = changeReviewRows(review.before, review.after);
  const card = document.createElement("div");
  card.className = "ai-review-card";
  card.dataset.aiReviewId = review.id;
  card.innerHTML = `<div class="ai-review-title">AI changes applied locally</div>
    <div class="ai-review-summary">${rows ? "Review the changed sections or revert this turn." : "Only generated output changed; project content is unchanged."}</div>
    <div class="ai-review-actions">
      <button class="btn btn-outline" type="button" data-ai-review-details>Review</button>
      <button class="btn btn-outline danger" type="button" data-ai-review-revert>Revert</button>
      <button class="btn btn-primary" type="button" data-ai-review-keep>Keep</button>
    </div>`;
  host.appendChild(card);
}

function finishAiReview(action) {
  const review = AI.pendingReview;
  if (!review) return;
  const card = $("ai-transcript")?.querySelector(`[data-ai-review-id="${CSS.escape(review.id)}"]`);
  if (card) {
    card.classList.add("resolved");
    card.querySelector(".ai-review-summary").textContent = action === "reverted" ? "Changes reverted." : "Changes kept.";
    card.querySelector(".ai-review-actions")?.remove();
  }
  AI.pendingReview = null;
}

async function revertAiReview() {
  const review = AI.pendingReview;
  if (!review || AI.busy) return;
  try {
    S.project = deep(review.before);
    historyInit();
    markDirty(true, true);
    renderActiveTab();
    if (!(await save())) throw new Error("Could not save the restored project.");
    await apiPost("/api/maps/compile", {});
    await load();
    finishAiReview("reverted");
    recordActivity("AI changes reverted", "warning", "Restored the pre-turn project snapshot");
    toast("AI changes reverted.", "ok");
  } catch (error) {
    recordActivity("AI revert", "error", error.message);
    toast(`Could not revert AI changes: ${error.message}`, "err");
  }
}

async function aiSend() {
  if (AI.busy) return;
  const input = $("ai-input");
  const text = input?.value.trim() || (AI.attachments.length ? "Please analyze the attached visual reference." : "");
  if (!text) return;
  const provider = aiProvider();
  const apiKey = aiKey(provider);
  if (!aiIsReady(provider)) {
    if (aiIsRuntime(provider)) {
      toast(`Connect ${aiProviderInfo(provider).label} in Settings first.`, "warn");
      switchTab("settings");
    } else {
      toast(`Set your ${aiProviderInfo(provider).keyLabel} in Settings first.`, "warn");
      switchTab("settings");
    }
    return;
  }
  if (S.dirty) {
    const ok = await confirmDialog({ title: "Save before AI edits?", message: "The AI co-designer edits the saved project on disk. Save your local changes first so they aren't overwritten when the editor reloads.", confirmLabel: "Save & continue", danger: false });
    if (!ok) return;
    await save();
  }
  if (AI.pendingReview) {
    toast("Keep or revert the previous AI changes before starting another turn.", "warn");
    return;
  }
  const preAiProject = deep(S.project);

  input.value = "";
  $("ai-transcript")?.querySelector(".ai-empty")?.remove();
  // Snapshot so an aborted/failed turn (no authoritative `done`) doesn't leave AI.messages with a
  // dangling user turn that diverges from what the server actually ran.
  const snapshot = AI.messages.slice();
  const turnAttachments = AI.attachments.slice();
  AI.messages.push({ role: "user", content: text });
  aiBubble("user", `${esc(text)}${turnAttachments.length ? `<span class="ai-user-attachments">${turnAttachments.length} visual${turnAttachments.length === 1 ? "" : "s"} attached</span>` : ""}`);
  AI.attachments = [];
  renderAiAttachments();
  const wrap = aiBubble("assistant", `<div class="ai-steps"></div>`);
  const steps = wrap.querySelector(".ai-steps");
  aiSetBusy(true);
  AI.controller = new AbortController();
  recordActivity("AI turn started", "ok", `${aiProviderInfo(provider).label} · ${aiStoredModel(provider)}`);
  let appliedPatch = false;
  let gotDone = false;
  try {
    const res = await fetch("/api/ai/chat", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AI.controller.signal,
      body: JSON.stringify({
        provider,
        ...(aiIsRuntime(provider) ? {} : { apiKey }),
        model: aiStoredModel(provider),
        reasoning: aiStoredReasoning(provider),
        mode: aiPermissionMode(),
        context: aiContextEnvelope(),
        attachments: turnAttachments,
        messages: AI.messages
      })
    });
    if (!res.ok || !res.body) throw new Error(`Server returned ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === "text") steps.insertAdjacentHTML("beforeend", `<div class="ai-text">${aiMarkdown(ev.text)}</div>`);
        else if (ev.type === "tool_call") steps.insertAdjacentHTML("beforeend", `<div class="ai-tool" data-id="${esc(ev.id)}"><span class="ai-tool-name">${esc(ev.name)}</span> <code>${esc(JSON.stringify(ev.input).slice(0, 160))}</code> <span class="ai-tool-status">running</span></div>`);
        else if (ev.type === "tool_result") {
          const el = steps.querySelector(`.ai-tool[data-id="${CSS.escape(ev.id)}"] .ai-tool-status`);
          if (el) { el.textContent = ev.ok ? "done" : "error"; el.className = `ai-tool-status ${ev.ok ? "ok" : "err"}`; el.title = JSON.stringify(ev.summary ?? {}).slice(0, 500); }
          recordActivity(`AI tool · ${ev.name}`, ev.ok ? "ok" : "error", JSON.stringify(ev.summary ?? {}).slice(0, 240));
        }
        else if (ev.type === "error") { steps.insertAdjacentHTML("beforeend", `<div class="ai-error">${esc(ev.error)}</div>`); recordActivity("AI turn", "error", ev.error); }
        else if (ev.type === "done") { gotDone = true; if (Array.isArray(ev.messages)) AI.messages = ev.messages; appliedPatch = !!ev.appliedPatch; recordActivity("AI turn completed", "ok", appliedPatch ? "Project files changed" : "No project writes"); }
        $("ai-transcript").scrollTop = $("ai-transcript").scrollHeight;
      }
    }
  } catch (e) {
    steps.insertAdjacentHTML("beforeend", `<div class="ai-error">${e.name === "AbortError" ? "Stopped." : esc(e.message)}</div>`);
  } finally {
    if (!gotDone) { AI.messages = snapshot; AI.attachments = turnAttachments; renderAiAttachments(); }
    aiSetBusy(false);
    AI.controller = null;
  }
  if (appliedPatch) {
    toast("AI applied project changes — reloading.", "ok");
    await load(); // refetch the on-disk project the AI just patched (renderActiveTab re-renders the AI tab)
    const review = { id: `review-${Date.now()}`, before: preAiProject, after: deep(S.project) };
    AI.pendingReview = review;
    appendAiReviewCard(steps, review);
    $("ai-transcript").scrollTop = $("ai-transcript").scrollHeight;
  }
}

function setAiDockOpen(open) {
  ensureAiInitialized();
  if (AI.focusTimer) {
    clearTimeout(AI.focusTimer);
    AI.focusTimer = null;
  }
  AI.dockOpen = Boolean(open);
  document.documentElement.setAttribute("data-ai-dock", AI.dockOpen ? "open" : "closed");
  $("ai-dock")?.setAttribute("aria-hidden", String(!AI.dockOpen));
  for (const id of ["btn-ai-chat", "sidebar-ai-chat"]) $(id)?.setAttribute("aria-expanded", String(AI.dockOpen));
  $("sidebar-ai-chat")?.classList.toggle("active", AI.dockOpen);
  updateAiUi();
  if (AI.dockOpen) {
    Promise.all([loadAiRuntimeStatus("codex"), loadAiRuntimeStatus("claude-code")]).then(updateAiUi);
    AI.focusTimer = setTimeout(() => {
      AI.focusTimer = null;
      if (AI.dockOpen && !document.activeElement?.matches("input, textarea, select")) $("ai-input")?.focus();
    }, 80);
  }
}

function openAiWithPrompt(prompt, { mode = "ask" } = {}) {
  setAiDockOpen(true);
  const modeSelect = $("ai-mode");
  if (modeSelect && modeSelect.querySelector(`option[value="${mode}"]`)) {
    modeSelect.value = mode;
    modeSelect.dispatchEvent(new Event("change"));
  }
  const input = $("ai-input");
  if (input) {
    input.value = prompt;
    input.focus();
  }
}

function setupAiDock() {
  ensureAiInitialized();
  $("btn-ai-chat")?.addEventListener("click", () => setAiDockOpen(!AI.dockOpen));
  $("sidebar-ai-chat")?.addEventListener("click", () => setAiDockOpen(!AI.dockOpen));
  $("ai-dock-close")?.addEventListener("click", () => setAiDockOpen(false));
  $("ai-new-chat")?.addEventListener("click", clearAiConversation);
  renderAiAttachments();
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVES EDITOR
// ─────────────────────────────────────────────────────────────────────────────
function renderWavesTab() {
  const missions = S.project.missions ?? {};

  // Mission list (left pane)
  const ml = $("wave-mission-list");
  ml.innerHTML = "";
  for (const [id, m] of Object.entries(missions)) {
    const div = document.createElement("div");
    div.className = "mission-item" + (id === S.waveMissionId ? " active" : "");
    div.innerHTML = `<div class="m-name">${esc(m.label || id)}</div><div class="m-id">${esc(id)}</div>`;
    div.dataset.eid = id;
    div.addEventListener("click", () => { S.waveMissionId = id; renderWavesTab(); });
    ml.appendChild(div);
  }

  // Enemy reference sidebar
  renderEnemyRefPanel();

  // Waveset header
  const headerEl = $("waveset-header");
  const areaEl   = $("waves-area");
  const emptyEl  = $("waves-empty");

  if (!S.waveMissionId || !missions[S.waveMissionId]) {
    if (headerEl) headerEl.style.display = "none";
    if (areaEl)   areaEl.innerHTML = "";
    if (emptyEl)  { emptyEl.style.display = "flex"; areaEl?.appendChild(emptyEl); }
    return;
  }
  if (emptyEl) emptyEl.style.display = "none";

  const mission   = missions[S.waveMissionId];
  const waveSetId = mission.waveSetId;
  const waves     = S.project.waveSets?.[waveSetId] ?? [];

  // Header
  if (headerEl) {
    headerEl.style.display = "flex";
    $("waveset-title").textContent = mission.label || S.waveMissionId;
    $("waveset-id").textContent = waveSetId ? `waveset: ${waveSetId}` : "";
    const totalHp     = waves.reduce((s,w) => s + waveHp(w), 0);
    const totalCoins  = waves.reduce((s,w) => s + waveCoins(w), 0);
    const totalThreat = waves.reduce((s,w) => s + waveThreat(w), 0);
    $("waveset-metrics").innerHTML = `
      <span class="metric-pill hp"><span class="lbl">HP</span>${totalHp}</span>
      <span class="metric-pill coins"><span class="lbl">coins</span>${totalCoins}</span>
      <span class="metric-pill threat"><span class="lbl">threat</span>${totalThreat}</span>
      <span class="metric-pill dur"><span class="lbl">waves</span>${waves.length}</span>`;
  }

  // Wave cards
  if (!areaEl) return;
  areaEl.innerHTML = "";

  if (!waves.length) {
    const d = document.createElement("div");
    d.className = "waves-empty";
    d.innerHTML = `${ICO.warn}<p>No waves. Click "Add Wave" above to add one.</p>`;
    areaEl.appendChild(d);
    return;
  }

  waves.forEach((wave, wi) => areaEl.appendChild(buildWaveCard(waveSetId, waves, wave, wi)));
}

function waveHp(wave) {
  return (wave.groups ?? []).reduce((s,g) => {
    const e = S.project.enemies?.[g.enemyId];
    return s + g.count * (e?.maxHp ?? 0);
  }, 0);
}
function waveCoins(wave) {
  return (wave.groups ?? []).reduce((s,g) => {
    const e = S.project.enemies?.[g.enemyId];
    return s + g.count * (e?.coinReward ?? e?.reward?.coins ?? 0);
  }, 0);
}
function waveThreat(wave) {
  return (wave.groups ?? []).reduce((s,g) => {
    const e = S.project.enemies?.[g.enemyId];
    return s + g.count * (e?.coreDamage ?? 1);
  }, 0);
}

function buildWaveCard(waveSetId, waves, wave, wi) {
  const card = document.createElement("div");
  card.className = "wave-card";

  const mission   = S.project.missions?.[S.waveMissionId];
  const routes    = S.project.mapRoutes?.[mission?.mapId] ?? [];
  const hp        = waveHp(wave);
  const dur       = waveDuration(wave);

  // Header
  const head = document.createElement("div");
  head.className = "wave-head";
  head.innerHTML = `
    <span class="wave-num">#${wi + 1}</span>
    <input class="wave-label-input" type="text" value="${esc(wave.label ?? wave.id)}" aria-label="Wave label">
    <div class="wave-metrics-inline">
      <span class="wmi"><span class="val">${hp}</span><span class="lbl">HP</span></span>
      <span class="wmi"><span class="val">${waveCoins(wave)}</span><span class="lbl">coins</span></span>
      <span class="wmi"><span class="val">${dur.toFixed(1)}s</span></span>
    </div>
    <div class="wave-actions">
      ${iconBtn("up", "Move up")}
      ${iconBtn("down", "Move down")}
      ${iconBtn("copy", "Duplicate")}
      ${iconBtn("trash", "Delete wave", "danger")}
    </div>`;

  const labelInp = head.querySelector(".wave-label-input");
  labelInp.addEventListener("input", () => { wave.label = labelInp.value; markDirty(true); });

  const [btnUp, btnDown, btnDup, btnDel] = head.querySelectorAll(".btn-icon");
  btnUp.disabled  = wi === 0;
  btnDown.disabled = wi === waves.length - 1;
  btnUp.addEventListener("click",   () => { swapEl(waves, wi, wi-1); markDirty(true); renderWavesTab(); });
  btnDown.addEventListener("click", () => { swapEl(waves, wi, wi+1); markDirty(true); renderWavesTab(); });
  btnDup.addEventListener("click",  () => {
    const copy = deep(wave);
    copy.id = wave.id + "_copy_" + Math.random().toString(36).slice(-4);
    copy.label = (copy.label ?? "") + " (copy)";
    waves.splice(wi + 1, 0, copy);
    markDirty(true); renderWavesTab();
  });
  btnDel.addEventListener("click", async () => {
    if (!(await confirmDialog({ title: `Delete "${wave.label ?? wave.id}"?`, message: "This wave and its groups will be removed." }))) return;
    waves.splice(wi, 1);
    S.project.waveSets[waveSetId] = waves;
    markDirty(true); renderWavesTab();
  });

  card.appendChild(head);

  // Body
  const body = document.createElement("div");
  body.className = "wave-body";

  // Column headers
  const colHead = document.createElement("div");
  colHead.className = "group-cols-head" + (routes.length ? " has-route" : "");
  colHead.innerHTML = `<span>Enemy</span><span>Count</span><span>Interval</span><span>Delay</span>${routes.length ? "<span>Route</span>" : ""}<span></span>`;
  body.appendChild(colHead);

  // Groups
  (wave.groups ?? []).forEach((g, gi) => {
    const row = buildGroupRow(waveSetId, waves, wave, wi, g, gi, routes);
    body.appendChild(row);
  });

  // Add group
  const footer = document.createElement("div");
  footer.className = "group-footer";
  const addGrpBtn = document.createElement("button");
  addGrpBtn.className = "add-btn";
  addGrpBtn.innerHTML = ICO.plus + " Group";
  addGrpBtn.addEventListener("click", () => {
    if (!wave.groups) wave.groups = [];
    wave.groups.push({
      enemyId: Object.keys(S.project.enemies ?? {})[0] ?? "",
      count: 5, spawnInterval: 2, startDelay: 0,
    });
    markDirty(true); renderWavesTab();
  });
  footer.appendChild(addGrpBtn);
  body.appendChild(footer);
  card.appendChild(body);

  return card;
}

function waveDuration(wave) {
  return (wave.groups ?? []).reduce((mx, g) => {
    const end = (g.startDelay ?? 0) + g.count * (g.spawnInterval ?? 1);
    return Math.max(mx, end);
  }, 0);
}

function swapEl(arr, i, j) {
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

function buildGroupRow(waveSetId, waves, wave, wi, g, gi, routes) {
  const row = document.createElement("div");
  row.className = "group-row" + (routes.length ? " has-route" : "");

  // Enemy select
  const sel = document.createElement("select");
  sel.setAttribute("aria-label", "Enemy type");
  for (const [eid, e] of Object.entries(S.project.enemies ?? {})) {
    const opt = document.createElement("option");
    opt.value = eid;
    opt.textContent = e.label || eid;
    if (eid === g.enemyId) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => { g.enemyId = sel.value; markDirty(true); renderWavesTab(); });

  // Numeric inputs
  const iCount = numInp(g.count, true, v => { g.count = v; markDirty(true); });
  iCount.setAttribute("aria-label", "Spawn count");
  const iInterval = numInp(g.spawnInterval, false, v => { g.spawnInterval = v; markDirty(true); });
  iInterval.setAttribute("aria-label", "Spawn interval");
  const iDelay = numInp(g.startDelay, false, v => { g.startDelay = v; markDirty(true); });
  iDelay.setAttribute("aria-label", "Start delay");

  // Delete
  const delBtn = document.createElement("button");
  delBtn.className = "btn-icon danger";
  delBtn.innerHTML = ICO.trash;
  delBtn.title = "Delete group";
  delBtn.addEventListener("click", () => {
    wave.groups.splice(gi, 1);
    markDirty(true); renderWavesTab();
  });

  row.appendChild(sel);
  row.appendChild(iCount);
  row.appendChild(iInterval);
  row.appendChild(iDelay);

  if (routes.length) {
    const rSel = document.createElement("select");
    rSel.setAttribute("aria-label", "Route");
    const noOpt = document.createElement("option");
    noOpt.value = ""; noOpt.textContent = "(default)";
    rSel.appendChild(noOpt);
    for (const rid of routes) {
      const opt = document.createElement("option");
      opt.value = rid; opt.textContent = rid;
      if (rid === g.routeId) opt.selected = true;
      rSel.appendChild(opt);
    }
    rSel.addEventListener("change", () => { g.routeId = rSel.value || undefined; markDirty(true); });
    row.appendChild(rSel);
  }

  row.appendChild(delBtn);
  return row;
}

function numInp(val, isInt, onChange) {
  const inp = document.createElement("input");
  inp.type = "number";
  inp.min  = "0";
  inp.step = isInt ? "1" : "0.1";
  inp.value = val ?? 0;
  inp.addEventListener("input", () => {
    const v = isInt ? (parseInt(inp.value) || 0) : (parseFloat(inp.value) || 0);
    inp.classList.toggle("error", v < 0);
    if (v >= 0) onChange(v);
  });
  return inp;
}

// Enemy reference sidebar in waves tab
function renderEnemyRefPanel() {
  const container = $("enemy-ref-list");
  if (!container) return;
  const filter = ($("enemy-ref-search")?.value ?? "").toLowerCase();
  const enemies = S.project.enemies ?? {};
  container.innerHTML = "";
  for (const [id, e] of Object.entries(enemies)) {
    const label = (e.label || id).toLowerCase();
    if (filter && !label.includes(filter) && !id.includes(filter)) continue;
    const div = document.createElement("div");
    div.className = "entity-item";
    const color = typeof e.color === "number"
      ? "#" + e.color.toString(16).padStart(6,"0")
      : (e.color ?? "#888");
    div.innerHTML = `
      <div class="item-name" style="display:flex;align-items:center;gap:5px">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${esc(color)};flex-shrink:0"></span>
        ${esc(e.label || id)}
      </div>
      <div class="item-id" style="font-size:10.5px;color:var(--text-muted)">HP ${e.maxHp} · spd ${e.speed} · dmg ${e.coreDamage}</div>`;
    container.appendChild(div);
  }
}

$("enemy-ref-search")?.addEventListener("input", renderEnemyRefPanel);
$("btn-add-wave")?.addEventListener("click", () => {
  if (!S.waveMissionId) { toast("Select a mission first.", "warn"); return; }
  const mission   = S.project.missions?.[S.waveMissionId];
  const waveSetId = mission?.waveSetId;
  if (!waveSetId) { toast("Mission has no waveSetId.", "err"); return; }
  if (!S.project.waveSets) S.project.waveSets = {};
  if (!S.project.waveSets[waveSetId]) S.project.waveSets[waveSetId] = [];
  const waves = S.project.waveSets[waveSetId];
  waves.push({ id: `wave_${Date.now()}`, label: `Wave ${waves.length + 1}`, groups: [] });
  markDirty(true); renderWavesTab();
});

// ─────────────────────────────────────────────────────────────────────────────
// ENEMIES EDITOR
// ─────────────────────────────────────────────────────────────────────────────
function renderEnemiesTab() {
  const enemies = S.project.enemies ?? {};
  const filter  = ($("enemy-search")?.value ?? "").toLowerCase();
  const list    = $("enemy-list");
  list.innerHTML = "";

  for (const [id, e] of Object.entries(enemies)) {
    const label = (e.label || id).toLowerCase();
    if (filter && !label.includes(filter) && !id.includes(filter)) continue;
    const color = typeof e.color === "number"
      ? "#" + e.color.toString(16).padStart(6,"0")
      : (e.color ?? "#888");
    const div = document.createElement("div");
    div.className = "entity-item" + (id === S.selectedEnemyId ? " active" : "");
    div.innerHTML = `
      <div class="item-name">${entityVisual("enemies", id, color)}${esc(e.label || id)}</div>
      <div class="item-id">${esc(id)}</div>`;
    div.dataset.eid = id;
    div.addEventListener("click", () => { S.selectedEnemyId = id; renderEnemiesTab(); });
    list.appendChild(div);
  }

  if (S.selectedEnemyId && enemies[S.selectedEnemyId]) {
    renderEnemyDetail(S.selectedEnemyId);
  }
}

$("enemy-search")?.addEventListener("input", renderEnemiesTab);

$("btn-add-enemy")?.addEventListener("click", () => {
  openRecipePicker("enemies");
});

// ── Currencies ────────────────────────────────────────────────────────────────
// The project declares its spendable currencies in S.project.currencies; "coins" is the
// guaranteed primary. Resource bags (costs/rewards/startingResources) are edited dynamically
// over this set so a project can have any number of currencies.
function projCurrencies() {
  const list = Array.isArray(S.project?.currencies) ? S.project.currencies.filter(c => c && c.id) : [];
  if (!list.some(c => c.id === "coins")) list.unshift({ id: "coins", label: "Coins" });
  return list;
}
function currencyLabel(cid) {
  const c = projCurrencies().find(c => c.id === cid);
  return c ? c.label : cid;
}
/** One number input per currency for a resource bag; input ids are `${idPrefix}-${cid}`. */
function currencyBagFields(bag, idPrefix, labelSuffix = "") {
  return projCurrencies().map(c =>
    `<div class="field"><label>${esc(c.label)}${labelSuffix}</label>` +
    `<input id="${idPrefix}-${esc(c.id)}" type="number" min="0" step="1" value="${(bag && bag[c.id]) || 0}"></div>`
  ).join("");
}
/** Read a resource bag from `${idPrefix}-${cid}` inputs; omits zero amounts to keep JSON tidy. */
function readCurrencyBag(idPrefix) {
  const out = {};
  for (const c of projCurrencies()) {
    const v = parseFloat($(`${idPrefix}-${c.id}`)?.value) || 0;
    if (v) out[c.id] = v;
  }
  return out;
}
/** Compact summary like "4 Coins + 1 Gems" for list tags. */
function costTag(bag) {
  const parts = projCurrencies().map(c => (bag && bag[c.id]) ? `${bag[c.id]} ${c.label}` : null).filter(Boolean);
  return parts.join(" + ") || "free";
}
/** Every resource bag in the project, as live object references (for rename/remove remapping). */
function allResourceBags() {
  const P = S.project, bags = [];
  const push = b => { if (b && typeof b === "object") bags.push(b); };
  push(P.constants?.startingResources); push(P.constants?.moveTowerCost);
  for (const t of Object.values(P.towers ?? {})) { push(t.cost); for (const uc of (t.attack?.upgradeCosts ?? [])) push(uc); }
  for (const e of Object.values(P.enemies ?? {})) push(e.reward);
  for (const m of Object.values(P.missions ?? {})) push(m.startingResources);
  return bags;
}
function colorToHex(n) {
  return typeof n === "number" && Number.isFinite(n) ? "#" + n.toString(16).padStart(6, "0") : "#f5c542";
}
function renderCurrenciesPanel() {
  const panel = $("currencies-panel");
  if (!panel) return;
  if (!Array.isArray(S.project.currencies) || !S.project.currencies.length) S.project.currencies = projCurrencies();
  const list = S.project.currencies;
  panel.innerHTML = list.map((cur, i) => {
    const isPrimary = cur.id === "coins";
    return `<div class="form-row cur-row" data-i="${i}" style="align-items:flex-end;gap:8px;margin-bottom:6px">
      <div class="field" style="flex:0 0 150px"><label>ID${isPrimary ? " (primary)" : ""}</label>
        <input class="cur-id mono" type="text" value="${esc(cur.id)}"${isPrimary ? " disabled" : ""}></div>
      <div class="field"><label>Label</label><input class="cur-label" type="text" value="${esc(cur.label ?? cur.id)}"></div>
      <div class="field" style="flex:0 0 64px"><label>Color</label><input class="cur-color" type="color" value="${colorToHex(cur.color)}"></div>
      ${isPrimary ? "" : `<button class="btn-icon cur-del" title="Remove currency" aria-label="Remove currency">${ICO.trash}</button>`}
    </div>`;
  }).join("");

  panel.querySelectorAll(".cur-row").forEach(row => {
    const i = +row.dataset.i, cur = list[i];
    row.querySelector(".cur-label")?.addEventListener("change", e => { cur.label = e.target.value || cur.id; markDirty(true); });
    row.querySelector(".cur-color")?.addEventListener("change", e => { cur.color = parseInt(e.target.value.slice(1), 16); markDirty(true); });
    const idInp = row.querySelector(".cur-id");
    idInp?.addEventListener("change", e => {
      const next = e.target.value.trim();
      if (!next || next === cur.id) { e.target.value = cur.id; return; }
      if (list.some(c => c.id === next)) { toast?.(`Currency id "${next}" already exists.`); e.target.value = cur.id; return; }
      const prev = cur.id;
      for (const bag of allResourceBags()) if (bag[prev] !== undefined) { bag[next] = bag[prev]; delete bag[prev]; }
      cur.id = next;
      markDirty(true); renderCurrenciesPanel();
    });
    row.querySelector(".cur-del")?.addEventListener("click", () => {
      for (const bag of allResourceBags()) delete bag[cur.id];
      list.splice(i, 1);
      markDirty(true); renderCurrenciesPanel();
    });
  });
}

function renderResistancesPanel(enemyId) {
  const panel = $("ef-resist-panel");
  const enemy = S.project.enemies?.[enemyId];
  if (!panel || !enemy) return;
  const entries = Object.entries(enemy.resistances ?? {});
  panel.innerHTML = entries.length
    ? entries.map(([type, mult], i) =>
        `<div class="form-row cur-row" data-i="${i}" style="align-items:flex-end;gap:8px;margin-bottom:6px">
          <div class="field"><label>Damage type</label><input class="res-type mono" type="text" value="${esc(type)}"></div>
          <div class="field" style="flex:0 0 120px"><label>Multiplier</label><input class="res-mult" type="number" min="0" step="0.1" value="${mult}"></div>
          <button class="btn-icon res-del" title="Remove resistance" aria-label="Remove">${ICO.trash}</button>
        </div>`).join("")
    : `<div class="text-muted" style="font-size:12px">No resistances — takes normal damage from every type.</div>`;

  const rebuild = () => {
    // Fetch fresh: persistEnemy may have replaced the enemy object on a sibling field change.
    const target = S.project.enemies?.[enemyId];
    if (!target) return;
    const out = {};
    for (const row of panel.querySelectorAll(".cur-row")) {
      const type = row.querySelector(".res-type")?.value.trim();
      const mult = parseFloat(row.querySelector(".res-mult")?.value);
      if (type && Number.isFinite(mult) && mult >= 0) out[type] = mult;
    }
    if (Object.keys(out).length) target.resistances = out; else delete target.resistances;
    markDirty(true);
  };
  panel.querySelectorAll(".res-type, .res-mult").forEach(inp => inp.addEventListener("change", rebuild));
  panel.querySelectorAll(".res-del").forEach(btn => btn.addEventListener("click", () => {
    btn.closest(".cur-row")?.remove();
    rebuild();
    renderResistancesPanel(enemyId);
  }));
}

function renderEnemyDetail(id) {
  const detail = $("enemy-detail");
  if (!detail) return;
  const enemies = S.project.enemies ?? {};
  if (!id || !enemies[id]) { detail.innerHTML = detailEmpty("Select an enemy to edit, or create a new one.", "enemy", "New Enemy"); return; }
  const e = enemies[id];
  const hexColor = typeof e.color === "number"
    ? "#" + e.color.toString(16).padStart(6,"0")
    : (e.color ?? "#888888");

  detail.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:10px">
        ${entityVisual("enemies", id, hexColor, true)}
        <div>
          <div style="font-size:15px;font-weight:600">${esc(e.label || id)}</div>
          <div class="mono text-muted" style="font-size:11px">${esc(id)}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline" id="enemy-dup-btn">${ICO.copy} Duplicate</button>
        <button class="btn btn-danger" id="enemy-del-btn">Delete</button>
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-title">Identity</div>
      <div class="form-row">
        <div class="field"><label>ID</label><input id="ef-id" value="${esc(id)}"></div>
        <div class="field"><label>Label</label><input id="ef-label" value="${esc(e.label)}"></div>
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-title">Core Stats</div>
      <div class="form-row">
        <div class="field"><label>Max HP</label><input id="ef-maxHp" type="number" min="0.1" step="0.5" value="${e.maxHp}"></div>
        <div class="field"><label>Speed</label><input id="ef-speed" type="number" min="0.01" step="0.05" value="${e.speed}"></div>
        <div class="field"><label>Core Damage</label><input id="ef-coreDamage" type="number" min="0" step="1" value="${e.coreDamage}"></div>
      </div>
      <div class="form-row">
        ${currencyBagFields(e.reward, "ef-reward", " Reward")}
        <div class="field">
          <label>Color</label>
          <div style="display:flex;gap:6px;align-items:center">
            <input id="ef-color" type="color" value="${hexColor}">
            <input id="ef-color-text" type="text" style="flex:1" value="${hexColor}" placeholder="#rrggbb">
          </div>
        </div>
      </div>
      <div class="form-row">
        <div class="field"><label>Hit Radius</label><input id="ef-hitRadius" type="number" step="0.01" value="${e.hitRadius ?? 0.5}"></div>
        <div class="field"><label>Path Collision Radius</label><input id="ef-pathCollRadius" type="number" step="0.01" value="${e.pathCollisionRadius ?? ""}"></div>
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-title">Movement</div>
      <div class="form-row">
        <div class="field">
          <label>Movement Kind</label>
          <select id="ef-movKind">
            <option value=""${!e.movementKind?" selected":""}>(default / path)</option>
            <option value="direct_flying"${e.movementKind==="direct_flying"?" selected":""}>direct_flying</option>
          </select>
        </div>
        <div class="field">
          <label>Target Class</label>
          <select id="ef-targetClass">
            <option value=""${!e.targetClass?" selected":""}>(default / ground)</option>
            <option value="flying"${e.targetClass==="flying"?" selected":""}>flying</option>
          </select>
        </div>
        <div class="field" style="flex-direction:row;align-items:center;gap:8px;padding-top:18px">
          <input id="ef-ignoreWater" type="checkbox"${e.ignoresWaterSlow?" checked":""}>
          <label style="margin:0">Ignores water slow</label>
        </div>
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-title">Special Abilities</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <input id="ef-sod-enable" type="checkbox"${e.spawnOnDeath?" checked":""}>
        <label style="margin:0;font-size:12px">Spawn on Death</label>
      </div>
      <div id="sod-fields" style="${e.spawnOnDeath?"":"display:none"}">
        <div class="attack-section">
          <div class="form-row">
            <div class="field">
              <label>Spawn Enemy ID</label>
              <select id="ef-sod-id">
                ${Object.keys(enemies).map(eid=>`<option value="${esc(eid)}"${eid===e.spawnOnDeath?.enemyId?" selected":""}>${esc(eid)}</option>`).join("")}
              </select>
            </div>
            <div class="field"><label>Count</label><input id="ef-sod-count" type="number" min="1" value="${e.spawnOnDeath?.count??1}"></div>
            <div class="field"><label>Fwd Path Steps</label><input id="ef-sod-fwd" type="number" min="0" value="${e.spawnOnDeath?.forwardPathSteps??0}"></div>
          </div>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;margin-bottom:8px">
        <input id="ef-healAura-enable" type="checkbox"${e.healAura?" checked":""}>
        <label style="margin:0;font-size:12px">Heal Aura</label>
      </div>
      <div id="healAura-fields" style="${e.healAura?"":"display:none"}">
        <div class="attack-section">
          <div class="form-row">
            <div class="field"><label>Radius</label><input id="ef-ha-radius" type="number" step="0.1" value="${e.healAura?.radius??2}"></div>
            <div class="field"><label>Heal / unit</label><input id="ef-ha-heal" type="number" step="0.01" value="${e.healAura?.healPerUnit??0.1}"></div>
          </div>
          <div style="display:flex;gap:12px;margin-top:6px">
            <label style="display:flex;gap:6px;align-items:center"><input id="ef-ha-self" type="checkbox"${e.healAura?.includeSelf?" checked":""}> Include self</label>
            <label style="display:flex;gap:6px;align-items:center"><input id="ef-ha-stack" type="checkbox"${e.healAura?.stacks?" checked":""}> Stacks</label>
          </div>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;margin-bottom:8px">
        <input id="ef-disrupt-enable" type="checkbox"${e.towerDisrupt?" checked":""}>
        <label style="margin:0;font-size:12px">Tower Disrupt (boss) ${helpIcon("Boss pattern: every Interval time-units, silences towers within Radius hexes for Duration — they can't fire while disabled.")}</label>
      </div>
      <div id="disrupt-fields" style="${e.towerDisrupt?"":"display:none"}">
        <div class="attack-section">
          <div class="form-row">
            <div class="field"><label>Interval</label><input id="ef-disrupt-interval" type="number" min="0.1" step="0.5" value="${e.towerDisrupt?.interval??5}"></div>
            <div class="field"><label>Radius (hex)</label><input id="ef-disrupt-radius" type="number" min="0.5" step="0.5" value="${e.towerDisrupt?.radius??3}"></div>
            <div class="field"><label>Duration</label><input id="ef-disrupt-duration" type="number" min="0.1" step="0.5" value="${e.towerDisrupt?.duration??4}"></div>
          </div>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;margin-bottom:8px">
        <input id="ef-atk-enable" type="checkbox"${e.towerAttack?" checked":""}>
        <label style="margin:0;font-size:12px">Tower Attack (boss) ${helpIcon("Boss pattern: every Interval time-units, deals Damage to the nearest tower within Range hexes; a tower with maxHp is destroyed at 0 HP.")}</label>
      </div>
      <div id="atk-fields" style="${e.towerAttack?"":"display:none"}">
        <div class="attack-section">
          <div class="form-row">
            <div class="field"><label>Interval</label><input id="ef-atk-interval" type="number" min="0.1" step="0.5" value="${e.towerAttack?.interval??4}"></div>
            <div class="field"><label>Damage</label><input id="ef-atk-damage" type="number" min="0.1" step="1" value="${e.towerAttack?.damage??20}"></div>
            <div class="field"><label>Range (hex)</label><input id="ef-atk-range" type="number" min="0.5" step="0.5" value="${e.towerAttack?.range??2}"></div>
          </div>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
        <input id="ef-armor-enable" type="checkbox"${e.armor?" checked":""}>
        <label style="margin:0;font-size:12px">Armor (pierce_only)</label>
      </div>

      <div class="form-section" style="margin-top:12px">
        <div class="form-section-title">Damage Resistances ${helpIcon("Per-damage-type multiplier for incoming tower damage. 0.5 = takes half, 2 = takes double. Types are author-defined and match a tower's Damage Type.")}</div>
        <div id="ef-resist-panel"></div>
        <button id="ef-resist-add" class="btn btn-outline" type="button" style="margin-top:6px">+ Add resistance</button>
      </div>
    </div>`;

  // Color sync
  const colorPicker = $("ef-color");
  const colorText   = $("ef-color-text");
  colorPicker?.addEventListener("input", () => { colorText.value = colorPicker.value; });
  colorText?.addEventListener("input",   () => {
    if (/^#[0-9a-fA-F]{6}$/.test(colorText.value)) colorPicker.value = colorText.value;
  });

  // Toggle spawn on death
  $("ef-sod-enable")?.addEventListener("change", () => {
    $("sod-fields").style.display = $("ef-sod-enable").checked ? "" : "none";
  });
  $("ef-healAura-enable")?.addEventListener("change", () => {
    $("healAura-fields").style.display = $("ef-healAura-enable").checked ? "" : "none";
  });
  $("ef-disrupt-enable")?.addEventListener("change", () => {
    $("disrupt-fields").style.display = $("ef-disrupt-enable").checked ? "" : "none";
  });
  $("ef-atk-enable")?.addEventListener("change", () => {
    $("atk-fields").style.display = $("ef-atk-enable").checked ? "" : "none";
  });

  // Damage resistances editor
  renderResistancesPanel(id);
  $("ef-resist-add")?.addEventListener("click", () => {
    const enemy = S.project.enemies[id];
    enemy.resistances ??= {};
    let n = 1, key = "type";
    while (enemy.resistances[key] !== undefined) key = "type" + (++n);
    enemy.resistances[key] = 1;
    markDirty(true); renderResistancesPanel(id);
  });

  // Persist on any change
  detail.querySelectorAll("input, select, textarea").forEach(inp => {
    inp.addEventListener("change", () => persistEnemy(id));
  });

  $("enemy-del-btn")?.addEventListener("click", async () => {
    if (!(await confirmDialog({ title: `Delete enemy "${id}"?`, message: "The enemy definition will be removed.", refs: findReferences("enemy", id) }))) return;
    delete S.project.enemies[id];
    S.selectedEnemyId = null;
    markDirty(true); renderEnemiesTab();
  });
  $("enemy-dup-btn")?.addEventListener("click", () => duplicateStudioEntity("enemies", id));
}

function persistEnemy(oldId) {
  const enemies = S.project.enemies;
  const e = enemies[oldId];
  if (!e) return;
  const newId = $("ef-id")?.value.trim() || oldId;
  const colorHex = $("ef-color")?.value ?? "#888888";
  const colorNum = parseInt(colorHex.replace("#",""), 16);

  const updated = {
    ...e,
    id:    newId,
    label: $("ef-label")?.value ?? e.label,
    maxHp:       parseFloat($("ef-maxHp")?.value)       || e.maxHp,
    speed:       parseFloat($("ef-speed")?.value)       || e.speed,
    coreDamage:  parseFloat($("ef-coreDamage")?.value)  ?? e.coreDamage,
    coinReward:  parseFloat($("ef-reward-coins")?.value) || 0,
    reward: readCurrencyBag("ef-reward"),
    color: colorNum,
    hitRadius:   parseFloat($("ef-hitRadius")?.value)   || e.hitRadius,
    movementKind: $("ef-movKind")?.value || undefined,
    targetClass:  $("ef-targetClass")?.value || undefined,
    ignoresWaterSlow: $("ef-ignoreWater")?.checked ?? false,
  };
  const pathColl = parseFloat($("ef-pathCollRadius")?.value);
  if (pathColl > 0) updated.pathCollisionRadius = pathColl;
  else delete updated.pathCollisionRadius;

  // Spawn on death
  if ($("ef-sod-enable")?.checked) {
    updated.spawnOnDeath = {
      enemyId:         $("ef-sod-id")?.value ?? "",
      count:           parseInt($("ef-sod-count")?.value) || 1,
      forwardPathSteps: parseInt($("ef-sod-fwd")?.value) || 0,
    };
  } else { delete updated.spawnOnDeath; }

  // Heal aura
  if ($("ef-healAura-enable")?.checked) {
    updated.healAura = {
      radius:       parseFloat($("ef-ha-radius")?.value) || 2,
      healPerUnit:  parseFloat($("ef-ha-heal")?.value)   || 0.1,
      includeSelf:  $("ef-ha-self")?.checked ?? false,
      stacks:       $("ef-ha-stack")?.checked ?? false,
    };
  } else { delete updated.healAura; }

  // Tower disrupt (boss)
  if ($("ef-disrupt-enable")?.checked) {
    updated.towerDisrupt = {
      interval: parseFloat($("ef-disrupt-interval")?.value) || 5,
      radius:   parseFloat($("ef-disrupt-radius")?.value)   || 3,
      duration: parseFloat($("ef-disrupt-duration")?.value) || 4,
    };
  } else { delete updated.towerDisrupt; }

  // Tower attack (boss) — damages/destroys towers
  if ($("ef-atk-enable")?.checked) {
    updated.towerAttack = {
      interval: parseFloat($("ef-atk-interval")?.value) || 4,
      damage:   parseFloat($("ef-atk-damage")?.value)   || 20,
      range:    parseFloat($("ef-atk-range")?.value)    || 2,
    };
  } else { delete updated.towerAttack; }

  // Armor
  if ($("ef-armor-enable")?.checked) { updated.armor = { kind: "pierce_only" }; }
  else { delete updated.armor; }

  if (newId !== oldId) { delete enemies[oldId]; S.selectedEnemyId = newId; }
  enemies[newId] = updated;
  markDirty(true);
  // Re-render list only (keep detail open)
  renderEnemiesTab();
}

// ─────────────────────────────────────────────────────────────────────────────
// TOWERS EDITOR
// ─────────────────────────────────────────────────────────────────────────────
function renderTowersTab() {
  const towers = S.project.towers ?? {};
  const filter = ($("tower-search")?.value ?? "").toLowerCase();
  const list   = $("tower-list");
  list.innerHTML = "";

  for (const [id, t] of Object.entries(towers)) {
    const label = (t.label || id).toLowerCase();
    if (filter && !label.includes(filter) && !id.includes(filter)) continue;
    const div = document.createElement("div");
    div.className = "entity-item" + (id === S.selectedTowerId ? " active" : "");
    div.innerHTML = `
      <div class="item-name">${entityVisual("towers", id, towerColorHex(t))}${esc(t.label || id)}</div>
      <div class="item-badges">
        <span class="tag">${esc(t.attack?.kind ?? "?")}</span>
        <span class="tag">${esc(costTag(t.cost))}</span>
      </div>`;
    div.dataset.eid = id;
    div.addEventListener("click", () => { S.selectedTowerId = id; renderTowersTab(); });
    list.appendChild(div);
  }

  if (S.selectedTowerId && towers[S.selectedTowerId]) {
    renderTowerDetail(S.selectedTowerId);
  }
}

$("tower-search")?.addEventListener("input", renderTowersTab);

$("btn-add-tower")?.addEventListener("click", () => {
  openRecipePicker("towers");
});

function renderTowerDetail(id) {
  const detail = $("tower-detail");
  if (!detail) return;
  const towers = S.project.towers ?? {};
  if (!id || !towers[id]) { detail.innerHTML = detailEmpty("Select a tower to edit, or create a new one.", "tower", "New Tower"); return; }
  const t = towers[id];
  const a = t.attack ?? {};

  const allTowerIds = Object.keys(towers);
  const towerOpts   = allTowerIds
    .filter(tid => tid !== id)
    .map(tid => `<option value="${esc(tid)}"${tid===t.requiresAuraFrom?" selected":""}>${esc(tid)}</option>`)
    .join("");
  const kinds = ["single","pulse","sniper","antiair","splash","pipeline","support","support_buff"];

  detail.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:10px">
        ${entityVisual("towers", id, towerColorHex(t), true)}
        <div>
          <div style="font-size:15px;font-weight:600">${esc(t.label || id)}</div>
          <div class="mono text-muted" style="font-size:11px">${esc(id)}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline" id="tower-dup-btn">${ICO.copy} Duplicate</button>
        <button class="btn btn-danger" id="tower-del-btn">Delete</button>
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-title">Identity</div>
      <div class="form-row">
        <div class="field"><label>ID</label><input id="tf-id" value="${esc(id)}"></div>
        <div class="field"><label>Label</label><input id="tf-label" value="${esc(t.label)}"></div>
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-title">Placement</div>
      <div class="form-row">
        ${currencyBagFields(t.cost, "tf-cost", " Cost")}
      </div>
      <div class="form-row">
        <div class="field"><label>Footprint Radius${helpIcon("How many hex rings the tower occupies. 0 = a single tile; 1 = a 7-tile cluster.")}</label><input id="tf-footprint" type="number" step="0.5" min="0" value="${t.footprintRadius ?? 1}"></div>
        <div class="field"><label>Range${helpIcon("Targeting radius in hex tiles.")}</label><input id="tf-range" type="number" step="0.5" min="0.5" value="${t.range ?? 5}"></div>
        <div class="field"><label>Max HP${helpIcon("Optional. If set, the tower can be damaged/destroyed by boss enemies with towerAttack. Blank = indestructible.")}</label><input id="tf-maxhp" type="number" step="1" min="0" value="${t.maxHp ?? ""}"></div>
        <div class="field">
          <label>Requires Aura From${helpIcon("If set, this tower can only be placed inside the named support tower's aura.")}</label>
          <select id="tf-requires">
            <option value=""${!t.requiresAuraFrom?" selected":""}>None</option>
            ${towerOpts}
          </select>
        </div>
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-title">Attack Model</div>
      <div class="form-row">
        <div class="field">
          <label>Attack Kind</label>
          <select id="tf-attack-kind">
            ${kinds.map(k=>`<option value="${k}"${k===a.kind?" selected":""}>${k}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="attack-section" id="attack-fields">
        ${buildAttackFields(a)}
      </div>
    </div>`;

  // Switching attack kind re-renders fields
  $("tf-attack-kind")?.addEventListener("change", () => {
    const newKind = $("tf-attack-kind").value;
    towers[id].attack = defaultAttackModel(newKind);
    $("attack-fields").innerHTML = buildAttackFields(towers[id].attack);
    bindAttackFieldListeners(id);
  });

  detail.querySelectorAll("input, select").forEach(inp => {
    inp.addEventListener("change", () => persistTower(id));
  });
  bindAttackFieldListeners(id);

  $("tower-del-btn")?.addEventListener("click", async () => {
    if (!(await confirmDialog({ title: `Delete tower "${id}"?`, message: "The tower definition will be removed.", refs: findReferences("tower", id) }))) return;
    delete S.project.towers[id];
    S.selectedTowerId = null;
    markDirty(true); renderTowersTab();
  });
  $("tower-dup-btn")?.addEventListener("click", () => duplicateStudioEntity("towers", id));
}

function defaultAttackModel(kind) {
  const defaults = {
    single: { kind, fireRate: 1, damagePerStack: 1, startingStacks: 1, maxStacks: 5, upgradeCost: 10 },
    pulse: { kind, pulseRate: 1, pulseDamage: 1, dotDamagePerUnit: 0.1, dotDuration: 3, upgradeCosts: [] },
    sniper: { kind, interval: 2, damage: 5, targetPriority: "largest_hp", upgradeCosts: [] },
    antiair: { kind, fireRate: 1, damage: 2, maxTargetsByLevel: [1, 2, 3, 4], upgradeCosts: [] },
    splash: { kind, interval: 1.5, damage: 3, splashDamage: 2, armoredChipDamage: 1, splashRadius: 1, slowFactor: 0.7, slowDuration: 2, affectsClasses: ["ground"], upgradeCosts: [] },
    pipeline: { kind, interval: 1, targeting: { classes: ["ground"], mode: "first", maxTargets: 1 }, delivery: { kind: "single" }, effects: [{ kind: "damage", amount: 1 }], upgradeCosts: [] },
    support: { kind, auraRadius: 3, unlocksTowerIds: [], upgradeCosts: [] },
    support_buff: { kind, auraRadius: 3, fireRateMultiplierByLevel: [1.2, 1.3, 1.4], affectsTowerIds: [], upgradeCosts: [] }
  };
  return deep(defaults[kind] ?? defaults.single);
}

function buildAttackFields(a) {
  const v = (key, def, step = 1, label = null, help = null) =>
    `<div class="field"><label>${esc(label ?? key)}${help ? helpIcon(help) : ""}</label><input class="af" data-f="${esc(key)}" type="number" step="${step}" value="${a[key] ?? def}"></div>`;
  const slider = (key, def, label, { min = 0, max = 1, step = 0.05 } = {}, help = null) =>
    `<div class="field"><label>${esc(label)}${help ? helpIcon(help) : ""}</label><div class="slider-field"><input class="af-slider" data-f="${esc(key)}" type="range" min="${min}" max="${max}" step="${step}" value="${a[key] ?? def}"><output>${a[key] ?? def}</output></div></div>`;
  const lvl = (key, defs, label, opts = {}, help = null) =>
    `<div class="field field-full"><label>${esc(label)}${help ? helpIcon(help) : ""}</label>${levelArrayEditor(key, (a[key]?.length ? a[key] : defs), opts)}</div>`;
  const costs = (label, help = null) =>
    `<div class="field field-full"><label>${esc(label)}${help ? helpIcon(help) : ""}</label>${costArrayEditor(a.upgradeCosts ?? [])}</div>`;
  const towers = (key, label, help = null) =>
    `<div class="field field-full"><label>${esc(label)}${help ? helpIcon(help) : ""}</label>${towerCheckGrid(key, a[key] ?? [])}</div>`;
  const title = kind => `<div class="attack-section-title">${kind}${helpIcon(ATTACK_HELP[a.kind] ?? "")}</div>`;

  const perKind = () => {
  switch (a.kind) {
    case "single":
      return `${title("Single-Target Attack")}
        <div class="form-row">${v("fireRate", 1, 0.05, "Fire Rate", "Shots per time-unit.")}${v("damagePerStack", 0.5, 0.05, "Damage / Stack")}</div>
        <div class="form-row">${v("startingStacks", 3, 1, "Starting Stacks")}${v("maxStacks", 10, 1, "Max Stacks")}${v("upgradeCost", 2, 1, "Upgrade Cost", "Coins per added stack.")}</div>`;
    case "pulse":
      return `${title("Pulse Attack")}
        <div class="form-row">${v("pulseRate", 1, 0.05, "Pulse Rate")}${v("pulseDamage", 0.5, 0.05, "Pulse Damage")}</div>
        <div class="form-row">${v("dotDamagePerUnit", 0.1, 0.01, "DoT Dmg / Unit", "Lingering damage applied per time-unit after leaving the aura.")}${v("dotDuration", 30, 1, "DoT Duration")}</div>
        ${lvl("pulseRateByLevel", [1, 1.25, 1.6], "Pulse Rate by Level")}
        ${costs("Upgrade Costs")}`;
    case "sniper":
      return `${title("Sniper Attack")}
        <div class="form-row">${v("interval", 2.4, 0.05, "Interval (s)", "Seconds between shots.")}${v("damage", 4, 0.5, "Damage")}</div>
        <div class="form-row"><div class="field"><label>Target Priority${helpIcon("Which enemy this tower aims at first.")}</label>
          <select class="af-sel" data-f="targetPriority">
            <option value="fastest_ahead"${a.targetPriority === "fastest_ahead" ? " selected" : ""}>fastest_ahead</option>
            <option value="largest_hp"${a.targetPriority === "largest_hp" ? " selected" : ""}>largest_hp</option>
          </select></div></div>
        ${lvl("rangeByLevel", [6, 7, 8], "Range by Level", { step: 0.5 })}
        ${costs("Upgrade Costs")}`;
    case "antiair":
      return `${title("Anti-Air Attack")}
        <div class="form-row">${v("fireRate", 1.4, 0.05, "Fire Rate")}${v("damage", 1, 0.5, "Damage")}</div>
        ${lvl("maxTargetsByLevel", [1, 2, 3, 4], "Max Targets by Level", { int: true }, "How many flying enemies it can hit at once, per level.")}
        ${costs("Upgrade Costs")}`;
    case "splash":
      return `${title("Splash Attack")}
        <div class="form-row">${v("interval", 1.7, 0.05, "Interval (s)")}${v("damage", 0.32, 0.01, "Damage")}${v("splashDamage", 0.14, 0.01, "Splash Damage")}</div>
        <div class="form-row">${v("splashRadius", 1, 0.1, "Splash Radius")}${slider("slowFactor", 0.55, "Slow Factor", { min: 0.05, max: 0.95, step: 0.05 }, "Speed multiplier while slowed — must be below 1.")}${v("slowDuration", 4, 0.5, "Slow Duration (s)")}</div>
        <div class="form-row">${v("armoredChipDamage", 0.08, 0.01, "Armored Chip Dmg", "Capped damage dealt to pierce-only-armored enemies.")}</div>
        ${targetClassEditor(a.affectsClasses ?? ["ground"], "af-affects-class", "Splash affects")}
        ${lvl("intervalByLevel", [1.7, 1.45, 1.2], "Interval by Level")}
        ${costs("Upgrade Costs")}`;
    case "pipeline": {
      const targeting = a.targeting ?? {};
      const delivery = a.delivery ?? { kind: "single" };
      const deliveryFields = delivery.kind === "area"
        ? `${vNested("delivery.radius", delivery.radius, 0.1, "Radius")}${vNested("delivery.secondaryMultiplier", delivery.secondaryMultiplier ?? 1, 0.05, "Secondary Multiplier")}`
        : delivery.kind === "chain"
          ? `${vNested("delivery.maxJumps", delivery.maxJumps, 1, "Max Jumps")}${vNested("delivery.jumpRadius", delivery.jumpRadius, 0.5, "Jump Radius")}${vNested("delivery.damageFalloff", delivery.damageFalloff ?? 1, 0.05, "Damage Falloff")}`
          : "";
      return `${title("Effect Pipeline")}
        <div class="form-row">${v("interval", 1, 0.05, "Interval")}
          <div class="field"><label>Target Priority</label><select class="af-pipeline-target" data-pf="mode">${PT_TARGET_MODES.map(([mode, label]) => `<option value="${mode}"${(targeting.mode ?? "first") === mode ? " selected" : ""}>${label}</option>`).join("")}</select></div>
          <div class="field"><label>Primary Targets</label><input class="af-pipeline-target" data-pf="maxTargets" type="number" min="1" step="1" value="${targeting.maxTargets ?? 1}"></div>
        </div>
        ${targetClassEditor(targeting.classes ?? ["ground"], "af-pipeline-class", "Targets")}
        <div class="form-row"><div class="field"><label>Delivery</label><select id="af-pipeline-delivery">${["single", "multi", "area", "chain", "aura"].map(kind => `<option value="${kind}"${delivery.kind === kind ? " selected" : ""}>${kind}</option>`).join("")}</select></div>${deliveryFields}</div>
        <div class="field field-full"><label>Ordered Effects ${helpIcon("Effects run in order for every delivered target: damage, status, or resource.")}</label><textarea id="af-pipeline-effects" class="mono" rows="8" spellcheck="false">${esc(JSON.stringify(a.effects ?? [{ kind: "damage", amount: 1 }], null, 2))}</textarea></div>
        ${lvl("intervalByLevel", [a.interval ?? 1], "Interval by Level")}
        ${lvl("rangeByLevel", [S.project.towers?.[S.selectedTowerId]?.range ?? 3], "Range by Level", { step: 0.5 })}
        ${costs("Upgrade Costs")}`;
    }
    case "support":
      return `${title("Support (Aura)")}
        <div class="form-row">${v("auraRadius", 4, 0.5, "Aura Radius")}</div>
        ${lvl("auraRadiusByLevel", [4, 5, 6], "Aura Radius by Level", { step: 0.5 })}
        ${towers("unlocksTowerIds", "Unlocks Towers", "Towers that become buildable inside this aura.")}
        ${costs("Upgrade Costs")}`;
    case "support_buff":
      return `${title("Support Buff (Aura)")}
        <div class="form-row">${v("auraRadius", 2, 0.5, "Aura Radius")}</div>
        ${lvl("fireRateMultiplierByLevel", [1.25, 1.35, 1.45], "Fire-Rate Multiplier by Level", { step: 0.05 }, "Multiplies affected towers' fire rate (e.g. 1.25 = +25%).")}
        ${towers("affectsTowerIds", "Affects Towers", "Towers whose fire rate this aura buffs.")}
        ${costs("Upgrade Costs")}`;
    default:
      return `<div class="text-muted" style="padding:8px">Select an attack kind above.</div>`;
  }
  };
  function vNested(path, value, step, label) {
    return `<div class="field"><label>${esc(label)}</label><input class="af-pipeline-delivery-num" data-pf="${esc(path)}" type="number" min="0" step="${step}" value="${value ?? ""}"></div>`;
  }
  const damaging = ["single", "pulse", "sniper", "antiair", "splash"].includes(a.kind);
  return perKind() + (damaging ? damageTypeField(a) + statusOnHitEditor(a) : "") + (a.kind === "single" ? chainEditor(a) : "");
}

// Optional composable delivery: after a hit, a single-kind shot chains hop-by-hop to nearby
// ground enemies, reusing this tower's resistances/armor/on-hit effects for every hop.
function chainEditor(a) {
  const c = a.chain ?? {};
  const on = !!a.chain;
  const num = (path, val, step, label) =>
    `<div class="field"><label>${esc(label)}</label><input class="af-chain" data-cf="${path}" type="number" min="0" step="${step}" value="${val ?? ""}"></div>`;
  return `<div class="attack-section-title" style="margin-top:12px">Chain ${helpIcon("Optional: after a hit, the shot jumps hop-by-hop to nearby ground enemies (up to Max Jumps, within Jump Radius of the last-hit enemy), each hop's damage multiplied by Damage Falloff. Reuses this tower's resistances/armor/on-hit effects for every hop.")}
      <label style="font-weight:400;font-size:12px;margin-left:auto;display:inline-flex;gap:6px;align-items:center">
        <input type="checkbox" id="af-chain-enable" ${on ? "checked" : ""}> enable</label></div>
    ${on ? `<div class="form-row">${num("maxJumps", c.maxJumps, 1, "Max Jumps")}${num("jumpRadius", c.jumpRadius, 0.5, "Jump Radius")}${num("damageFalloff", c.damageFalloff, 0.05, "Damage Falloff")}</div>` : ""}`;
}

// Optional author-defined damage type (matched against enemy resistances). Empty = "physical".
function damageTypeField(a) {
  return `<div class="form-row"><div class="field"><label>Damage Type ${helpIcon("Author-defined damage type (e.g. fire, ice). Enemies scale incoming damage by their resistance for this type. Empty = physical.")}</label>
    <input class="af-str" data-f="damageType" type="text" placeholder="physical" value="${esc(a.damageType ?? "")}"></div></div>`;
}

function targetClassEditor(selected, inputClass, label) {
  const active = new Set(selected ?? []);
  return `<div class="field field-full"><label>${esc(label)} ${helpIcon("Choose which enemy classes this effect can reach. At least one class is required.")}</label>
    <div class="check-grid">
      ${["ground", "flying"].map((targetClass) => `<label class="check-item"><input class="${inputClass}" data-target-class="${targetClass}" type="checkbox"${active.has(targetClass) ? " checked" : ""}> ${targetClass}</label>`).join("")}
    </div></div>`;
}

// Optional data-driven on-hit status effects (stun / slow / poison) for any damaging tower.
function statusOnHitEditor(a) {
  const s = a.statusOnHit ?? {};
  const on = !!a.statusOnHit;
  const num = (path, val, step, label) =>
    `<div class="field"><label>${esc(label)}</label><input class="af-status" data-sf="${path}" type="number" min="0" step="${step}" value="${val ?? ""}"></div>`;
  return `<div class="attack-section-title" style="margin-top:12px">On-Hit Effects ${helpIcon("Optional status effects applied to enemies this tower damages.")}
      <label style="font-weight:400;font-size:12px;margin-left:auto;display:inline-flex;gap:6px;align-items:center">
        <input type="checkbox" id="af-status-enable" ${on ? "checked" : ""}> enable</label></div>
    ${on ? `<div class="form-row">${num("stun", s.stun, 0.5, "Stun (s)")}${num("poison.dps", s.poison?.dps, 0.5, "Poison DPS")}${num("poison.duration", s.poison?.duration, 0.5, "Poison Duration (s)")}</div>
    <div class="form-row">${num("slow.factor", s.slow?.factor, 0.05, "Slow Factor (<1)")}${num("slow.duration", s.slow?.duration, 0.5, "Slow Duration (s)")}</div>
    ${targetClassEditor(s.slowAffectsClasses ?? ["ground"], "af-status-class", "Slow affects")}` : ""}`;
}

function bindAttackFieldListeners(id) {
  const towers = S.project.towers;
  const attack = () => towers[id]?.attack ?? {};
  const refresh = () => { const box = $("attack-fields"); if (box) { box.innerHTML = buildAttackFields(towers[id].attack); bindAttackFieldListeners(id); } };

  document.querySelectorAll(".af").forEach(inp =>
    inp.addEventListener("change", () => { attack()[inp.dataset.f] = parseFloat(inp.value) || 0; markDirty(true); }));
  document.querySelectorAll(".af-str").forEach(inp =>
    inp.addEventListener("change", () => { const v = inp.value.trim(); if (v) attack()[inp.dataset.f] = v; else delete attack()[inp.dataset.f]; markDirty(true); }));
  document.querySelectorAll(".af-sel").forEach(sel =>
    sel.addEventListener("change", () => { attack()[sel.dataset.f] = sel.value; markDirty(true); }));
  document.querySelectorAll(".af-slider").forEach(sl =>
    sl.addEventListener("input", () => {
      attack()[sl.dataset.f] = parseFloat(sl.value) || 0;
      const out = sl.parentElement?.querySelector("output"); if (out) out.textContent = sl.value;
      markDirty(true);
    }));

  // Per-level numeric arrays
  document.querySelectorAll(".af-lvl").forEach(inp =>
    inp.addEventListener("change", () => {
      const key = inp.dataset.arrkey;
      attack()[key] = [...document.querySelectorAll(`.af-lvl[data-arrkey="${key}"]`)].map(r => parseFloat(r.value) || 0);
      markDirty(true);
    }));
  document.querySelectorAll(".af-lvl-add").forEach(btn =>
    btn.addEventListener("click", () => {
      const key = btn.dataset.arrkey, arr = (attack()[key] ??= []);
      arr.push(arr.length ? arr[arr.length - 1] : 1);
      markDirty(true); refresh();
    }));
  document.querySelectorAll(".af-lvl-del").forEach(btn =>
    btn.addEventListener("click", () => {
      const inp = btn.closest(".lvl-row")?.querySelector(".af-lvl"); if (!inp) return;
      (attack()[inp.dataset.arrkey] ?? []).splice(+inp.dataset.idx, 1);
      markDirty(true); refresh();
    }));

  // Upgrade cost ladder
  const rebuildCosts = () => {
    const map = {};
    document.querySelectorAll(".af-cost").forEach(inp => { (map[+inp.dataset.idx] ??= {})[inp.dataset.field] = parseFloat(inp.value) || 0; });
    attack().upgradeCosts = Object.keys(map).map(Number).sort((x, y) => x - y).map(i => {
      const o = {}; for (const cur of projCurrencies()) if (map[i][cur.id]) o[cur.id] = map[i][cur.id]; return o;
    });
  };
  document.querySelectorAll(".af-cost").forEach(inp => inp.addEventListener("change", () => { rebuildCosts(); markDirty(true); }));
  document.querySelectorAll(".af-cost-add").forEach(btn =>
    btn.addEventListener("click", () => { (attack().upgradeCosts ??= []).push({ coins: 0 }); markDirty(true); refresh(); }));
  document.querySelectorAll(".af-cost-del").forEach(btn =>
    btn.addEventListener("click", () => { (attack().upgradeCosts ?? []).splice(+btn.closest(".cost-row")?.dataset.idx, 1); markDirty(true); refresh(); }));

  // Tower-id pickers (unlocks / affects)
  document.querySelectorAll(".af-towers").forEach(cb =>
    cb.addEventListener("change", () => {
      const key = cb.dataset.arrkey;
      attack()[key] = [...document.querySelectorAll(`.af-towers[data-arrkey="${key}"]:checked`)].map(c => c.dataset.tid);
      markDirty(true);
    }));

  // On-hit status effects (nested statusOnHit object, rebuilt from .af-status inputs)
  $("af-status-enable")?.addEventListener("change", (e) => {
    if (e.target.checked) attack().statusOnHit ??= {}; else delete attack().statusOnHit;
    markDirty(true); refresh();
  });
  const rebuildStatus = () => {
    const out = {};
    for (const inp of document.querySelectorAll(".af-status")) {
      const val = parseFloat(inp.value);
      if (!Number.isFinite(val) || val <= 0) continue;
      const [group, field] = inp.dataset.sf.split(".");
      if (field) { (out[group] ??= {})[field] = val; } else { out[group] = val; }
    }
    // Drop partial slow/poison groups (need both fields) so validation stays clean.
    if (out.slow && (out.slow.factor === undefined || out.slow.duration === undefined)) delete out.slow;
    if (out.poison && (out.poison.dps === undefined || out.poison.duration === undefined)) delete out.poison;
    if (out.slow) out.slowAffectsClasses = [...document.querySelectorAll(".af-status-class:checked")].map(item => item.dataset.targetClass);
    attack().statusOnHit = out;
    markDirty(true);
  };
  document.querySelectorAll(".af-status").forEach(inp => inp.addEventListener("change", rebuildStatus));
  document.querySelectorAll(".af-status-class").forEach(cb => cb.addEventListener("change", () => {
    const selected = [...document.querySelectorAll(".af-status-class:checked")].map(item => item.dataset.targetClass);
    if (!selected.length) { cb.checked = true; toast("Slow must affect at least one enemy class.", "warn"); return; }
    attack().statusOnHit ??= {};
    attack().statusOnHit.slowAffectsClasses = selected;
    markDirty(true);
  }));

  document.querySelectorAll(".af-affects-class").forEach(cb => cb.addEventListener("change", () => {
    const selected = [...document.querySelectorAll(".af-affects-class:checked")].map(item => item.dataset.targetClass);
    if (!selected.length) { cb.checked = true; toast("Splash must affect at least one enemy class.", "warn"); return; }
    attack().affectsClasses = selected;
    markDirty(true);
  }));

  // Chain delivery (nested chain object, single-kind only; rebuilt from .af-chain inputs)
  $("af-chain-enable")?.addEventListener("change", (e) => {
    if (e.target.checked) attack().chain ??= { maxJumps: 2, jumpRadius: 2, damageFalloff: 0.6 };
    else delete attack().chain;
    markDirty(true); refresh();
  });
  const rebuildChain = () => {
    const out = {};
    for (const inp of document.querySelectorAll(".af-chain")) {
      const val = parseFloat(inp.value);
      if (Number.isFinite(val) && val > 0) out[inp.dataset.cf] = val;
    }
    attack().chain = out;
    markDirty(true);
  };
  document.querySelectorAll(".af-chain").forEach(inp => inp.addEventListener("change", rebuildChain));

  // Universal tower pipeline: targeting -> delivery -> ordered effects.
  document.querySelectorAll(".af-pipeline-target").forEach(input => input.addEventListener("change", () => {
    attack().targeting ??= { classes: ["ground"] };
    attack().targeting[input.dataset.pf] = input.dataset.pf === "maxTargets" ? Math.max(1, Number(input.value) || 1) : input.value;
    markDirty(true);
  }));
  document.querySelectorAll(".af-pipeline-class").forEach(input => input.addEventListener("change", () => {
    const selected = [...document.querySelectorAll(".af-pipeline-class:checked")].map(item => item.dataset.targetClass);
    if (!selected.length) { input.checked = true; toast("Pipeline targeting needs at least one enemy class.", "warn"); return; }
    attack().targeting ??= {};
    attack().targeting.classes = selected;
    markDirty(true);
  }));
  $("af-pipeline-delivery")?.addEventListener("change", event => {
    const kind = event.target.value;
    attack().delivery = kind === "area"
      ? { kind, radius: 1, secondaryMultiplier: 1 }
      : kind === "chain"
        ? { kind, maxJumps: 2, jumpRadius: 2, damageFalloff: 0.7 }
        : { kind };
    markDirty(true); refresh();
  });
  document.querySelectorAll(".af-pipeline-delivery-num").forEach(input => input.addEventListener("change", () => {
    const field = input.dataset.pf.split(".")[1];
    attack().delivery[field] = Number(input.value) || 0;
    markDirty(true);
  }));
  $("af-pipeline-effects")?.addEventListener("change", event => {
    try {
      const effects = JSON.parse(event.target.value);
      if (!Array.isArray(effects) || !effects.length) throw new Error("Effects must be a non-empty JSON array.");
      attack().effects = effects;
      markDirty(true);
      toast("Pipeline effects updated.", "ok");
    } catch (error) {
      toast(`Invalid pipeline effects: ${error.message}`, "err");
    }
  });
}

function persistTower(oldId) {
  const towers = S.project.towers;
  const t = towers[oldId];
  if (!t) return;
  const newId = $("tf-id")?.value.trim() || oldId;

  const updated = {
    ...t,
    id:             newId,
    label:          $("tf-label")?.value ?? t.label,
    footprintRadius: parseFloat($("tf-footprint")?.value) || 1,
    range:           parseFloat($("tf-range")?.value)     || 5,
    cost: readCurrencyBag("tf-cost"),
    attack: t.attack ?? {},
  };
  const maxHpVal = parseFloat($("tf-maxhp")?.value);
  if (Number.isFinite(maxHpVal) && maxHpVal > 0) updated.maxHp = maxHpVal; else delete updated.maxHp;
  const req = $("tf-requires")?.value;
  if (req) updated.requiresAuraFrom = req; else delete updated.requiresAuraFrom;

  if (newId !== oldId) { delete towers[oldId]; S.selectedTowerId = newId; }
  towers[newId] = updated;
  markDirty(true);
  renderTowersTab();
}

// ─────────────────────────────────────────────────────────────────────────────
// MISSIONS EDITOR
// ─────────────────────────────────────────────────────────────────────────────
function renderMissionsTab() {
  const missions = S.project.missions ?? {};
  const filter   = ($("mission-search")?.value ?? "").toLowerCase();
  const list     = $("mission-list");
  list.innerHTML = "";

  for (const [id, m] of Object.entries(missions)) {
    const label = (m.label || id).toLowerCase();
    if (filter && !label.includes(filter) && !id.includes(filter)) continue;
    const div = document.createElement("div");
    const balanceMission = S.balanceReportRevision === S.contentHash
      ? S.balanceReport?.missions?.find((mission) => mission.missionId === id)
      : null;
    const balanceFlags = balanceMission ? missionBalanceSignals(balanceMission) : [];
    const balanceSeverity = balanceFlags.some((flag) => flag.severity === "error") ? "error" : "warning";
    div.className = "entity-item" + (id === S.selectedMissionEdId ? " active" : "") + (balanceFlags.length ? " balance-warning" : "");
    const badges = [];
    if (m.availability === "comingSoon") badges.push(`<span class="tag">soon</span>`);
    if (balanceFlags.length) badges.push(`<span class="tag balance-tag ${balanceSeverity}" title="${esc(balanceFlags.map((flag) => flag.message).join(" · "))}">${balanceFlags.length} balance</span>`);
    div.innerHTML = `
      <div class="item-name">${esc(m.label || id)}</div>
      <div class="item-id">${esc(id)}</div>
      ${badges.length ? `<div class="item-badges">${badges.join("")}</div>` : ""}`;
    div.dataset.eid = id;
    div.addEventListener("click", () => { S.selectedMissionEdId = id; renderMissionsTab(); });
    list.appendChild(div);
  }

  if (S.selectedMissionEdId && missions[S.selectedMissionEdId]) {
    renderMissionDetail(S.selectedMissionEdId);
  }
}

$("mission-search")?.addEventListener("input", renderMissionsTab);

$("btn-add-mission")?.addEventListener("click", () => {
  openRecipePicker("missions");
});

function missionVictoryRows(mission) {
  const rows = mission.objectives?.victory?.length
    ? mission.objectives.victory
    : [{ id: "clear_waves", label: "Clear all waves", kind: "clearWaves" }];
  const enemies = Object.keys(S.project.enemies ?? {});
  const currencies = projCurrencies();
  return rows.map((objective, index) => {
    const kinds = [["clearWaves", "Clear all waves"], ["surviveSeconds", "Survive time"], ["killCount", "Kill count"], ["accumulateResource", "Accumulate resource"]];
    const target = objective.kind === "surviveSeconds" ? objective.seconds : objective.kind === "killCount" ? objective.count : objective.kind === "accumulateResource" ? objective.amount : null;
    const reference = objective.kind === "killCount"
      ? `<select class="mf-objective-ref"><option value="">All enemies</option>${enemies.map((id) => `<option value="${esc(id)}"${objective.enemyTypeId === id ? " selected" : ""}>${esc(id)}</option>`).join("")}</select>`
      : objective.kind === "accumulateResource"
        ? `<select class="mf-objective-ref">${currencies.map((currency) => `<option value="${esc(currency.id)}"${objective.resourceId === currency.id ? " selected" : ""}>${esc(currency.label)}</option>`).join("")}</select>`
        : `<span class="text-muted">${objective.kind === "clearWaves" ? "Mission waves" : "Time units"}</span>`;
    return `<div class="mission-rule-row" data-objective-index="${index}" data-objective-id="${esc(objective.id)}">
      <input class="mf-objective-label" aria-label="Objective label" value="${esc(objective.label ?? "")}" placeholder="Objective label">
      <select class="mf-objective-kind" aria-label="Victory objective kind">${kinds.map(([kind, label]) => `<option value="${kind}"${objective.kind === kind ? " selected" : ""}>${label}</option>`).join("")}</select>
      ${target === null ? `<span class="mission-rule-target text-muted">Automatic</span>` : `<input class="mf-objective-target" aria-label="Objective target" type="number" min="0.01" step="0.1" value="${target}">`}
      ${reference}
      <button class="btn-icon mf-objective-delete" type="button" title="Remove objective" aria-label="Remove objective">${ICO.trash}</button>
    </div>`;
  }).join("");
}

function missionStarRows(mission) {
  const stars = mission.objectives?.stars ?? [];
  const currencies = projCurrencies();
  return stars.map((star, index) => {
    const kinds = [["coreHpAtLeast", "Core HP at least"], ["maxLeaks", "Leaks at most"], ["timeAtMost", "Finish by time"], ["resourceAtLeast", "Resource at least"]];
    const target = star.kind === "maxLeaks" ? star.maxLeaks : star.kind === "timeAtMost" ? star.seconds : star.amount;
    const reference = star.kind === "resourceAtLeast"
      ? `<select class="mf-star-resource">${currencies.map((currency) => `<option value="${esc(currency.id)}"${star.resourceId === currency.id ? " selected" : ""}>${esc(currency.label)}</option>`).join("")}</select>`
      : `<span class="text-muted">${star.kind === "timeAtMost" ? "Time units" : star.kind === "maxLeaks" ? "Enemies" : "Core HP"}</span>`;
    return `<div class="mission-rule-row" data-star-index="${index}" data-star-id="${esc(star.id)}">
      <input class="mf-star-label" aria-label="Star label" value="${esc(star.label ?? "")}" placeholder="Star label">
      <select class="mf-star-kind" aria-label="Star condition kind">${kinds.map(([kind, label]) => `<option value="${kind}"${star.kind === kind ? " selected" : ""}>${label}</option>`).join("")}</select>
      <input class="mf-star-target" aria-label="Star target" type="number" min="0" step="0.1" value="${target ?? 0}">
      ${reference}
      <button class="btn-icon mf-star-delete" type="button" title="Remove star" aria-label="Remove star">${ICO.trash}</button>
    </div>`;
  }).join("");
}

function renderMissionDetail(id) {
  const detail   = $("mission-detail");
  if (!detail) return;
  const missions = S.project.missions ?? {};
  if (!id || !missions[id]) { detail.innerHTML = detailEmpty("Select a mission to edit, or create a new one.", "mission", "New Mission"); return; }
  const m = missions[id];

  const mapOpts     = Object.keys(S.project.maps ?? {}).map(mid =>
    `<option value="${esc(mid)}"${mid===m.mapId?" selected":""}>${esc(mid)}</option>`).join("");
  const waveSetOpts = Object.keys(S.project.waveSets ?? {}).map(wsid =>
    `<option value="${esc(wsid)}"${wsid===m.waveSetId?" selected":""}>${esc(wsid)}</option>`).join("");
  const availOpts   = ["playable","comingSoon"].map(v =>
    `<option value="${v}"${v===m.availability?" selected":""}>${v}</option>`).join("");

  // Tower checkboxes
  const allTowers = Object.keys(S.project.towers ?? {});
  const buildSet  = new Set(m.buildTowerIds ?? []);
  const towerChecks = allTowers.map(tid => `
    <label class="check-item">
      <input type="checkbox" class="mission-tower-cb" data-tid="${esc(tid)}"${buildSet.has(tid)?" checked":""}>
      ${esc(tid)}
    </label>`).join("");

  // Ability checkboxes
  const allAbilities = Object.keys(S.project.abilities ?? {});
  const abilitySet   = new Set(m.abilityIds ?? []);
  const abilityChecks = allAbilities.map(aid => `
    <label class="check-item">
      <input type="checkbox" class="mission-ability-cb" data-aid="${esc(aid)}"${abilitySet.has(aid)?" checked":""}>
      ${esc(aid)}
    </label>`).join("");

  const sun = m.sunlight;
  const economy = m.economy;

  detail.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:15px;font-weight:600">${esc(m.label || id)}</div>
        <div class="mono text-muted" style="font-size:11px">${esc(id)}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline" id="mission-sim-btn">Sim</button>
        <button class="btn btn-outline" id="mission-dup-btn">${ICO.copy} Duplicate</button>
        <button class="btn btn-danger"  id="mission-del-btn">Delete</button>
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-title">Identity</div>
      <div class="form-row">
        <div class="field"><label>ID</label><input id="mf-id" value="${esc(id)}"></div>
        <div class="field"><label>Label</label><input id="mf-label" value="${esc(m.label)}"></div>
        <div class="field">
          <label>Availability</label>
          <select id="mf-avail">${availOpts}</select>
        </div>
      </div>
      <div class="field">
        <label>Description</label>
        <textarea id="mf-desc" rows="2">${esc(m.description ?? "")}</textarea>
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-title">Game Setup</div>
      <div class="form-row">
        <div class="field"><label>Map</label><select id="mf-mapId">${mapOpts}</select></div>
        <div class="field"><label>Wave Set</label><select id="mf-waveSetId">${waveSetOpts}</select></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Starting Core HP</label><input id="mf-coreHp" type="number" min="1" value="${m.startingCoreHp ?? 20}"></div>
        ${currencyBagFields(m.startingResources, "mf-start", " (start)")}
        <div class="field"><label>Prep Time (units)</label><input id="mf-prep" type="number" min="0" value="${m.prepTimeUnits ?? 20}"></div>
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-title">Available Towers</div>
      <div class="check-grid">${towerChecks || "<span class='text-muted' style='padding:6px'>No towers defined.</span>"}</div>
    </div>

    ${allAbilities.length ? `
    <div class="form-section">
      <div class="form-section-title">Abilities</div>
      <div class="check-grid">${abilityChecks}</div>
    </div>` : ""}

    <div class="form-section">
      <div class="form-section-title">Economy</div>
      <label class="check-item" style="margin-bottom:8px">
        <input id="mf-economy-enable" type="checkbox"${economy ? " checked" : ""}> Enable mission economy rules
      </label>
      <div id="economy-fields" style="${economy ? "" : "display:none"}">
        <div class="attack-section">
          <div class="form-row">
            <div class="field"><label>Sell Refund</label><input id="mf-econ-refund" type="number" min="0" max="1" step="0.05" value="${economy?.sellRefundRatio ?? 0.7}"></div>
            <div class="field"><label>Interest / Wave</label><input id="mf-econ-interest" type="number" min="0" step="0.01" value="${economy?.interestRate ?? 0}"></div>
          </div>
          <div class="form-row">${currencyBagFields(economy?.perWaveStart, "mf-econ-start", " / wave start")}</div>
          <div class="form-row">${currencyBagFields(economy?.perWaveClear, "mf-econ-clear", " / wave clear")}</div>
          <div class="form-row">${currencyBagFields(economy?.passivePerTimeUnit, "mf-econ-passive", " / time unit")}</div>
          <div class="form-row">${currencyBagFields(economy?.earlyStartBonusPerUnit, "mf-econ-early", " / skipped prep unit")}</div>
          <div class="form-row">${currencyBagFields(economy?.interestCap, "mf-econ-cap", " interest cap")}</div>
        </div>
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-title form-section-title-actions"><span>Mission Objectives</span><button id="mf-objective-add" class="btn btn-outline" type="button">${ICO.plus} Objective</button></div>
      <div class="mission-rule-list">${missionVictoryRows(m)}</div>
      <div class="mission-failure-grid">
        <div class="field"><label>Maximum Leaks</label><input id="mf-fail-leaks" type="number" min="0" placeholder="No limit" value="${m.objectives?.failure?.find((item) => item.kind === "maxLeaks")?.maxLeaks ?? ""}"></div>
        <div class="field"><label>Time Limit</label><input id="mf-fail-time" type="number" min="0.01" step="0.1" placeholder="No limit" value="${m.objectives?.failure?.find((item) => item.kind === "timeLimit")?.seconds ?? ""}"></div>
      </div>
      <div class="form-section-title form-section-title-actions mission-star-title"><span>Star Ratings</span><button id="mf-star-add" class="btn btn-outline" type="button">${ICO.plus} Star</button></div>
      <div class="mission-rule-list">${missionStarRows(m) || `<span class="text-muted mission-rule-empty">No optional star conditions.</span>`}</div>
    </div>

    <div class="form-section">
      <div class="form-section-title">Sunlight Modifier</div>
      <label class="check-item" style="margin-bottom:8px">
        <input id="mf-sun-enable" type="checkbox"${sun?" checked":""}> Enable sunlight modifier
      </label>
      <div id="sun-fields" style="${sun?"":"display:none"}">
        <div class="attack-section">
          <div class="form-row">
            <div class="field"><label>Regen per Unit</label><input id="mf-sun-regen" type="number" step="0.01" value="${sun?.regenPerUnit??0}"></div>
            <div class="field"><label>AoE Damage Multiplier</label><input id="mf-sun-aoe" type="number" step="0.01" value="${sun?.aoeDamageMultiplier??1}"></div>
          </div>
          <div class="field">
            <label>Path Orders (JSON array of numbers)</label>
            <input id="mf-sun-pathOrders" value="${JSON.stringify(sun?.pathOrders??[])}">
          </div>
        </div>
      </div>
    </div>`;

  $("mf-sun-enable")?.addEventListener("change", () => {
    $("sun-fields").style.display = $("mf-sun-enable").checked ? "" : "none";
  });
  $("mf-economy-enable")?.addEventListener("change", () => {
    $("economy-fields").style.display = $("mf-economy-enable").checked ? "" : "none";
  });
  $("mf-objective-add")?.addEventListener("click", () => {
    const objectives = (m.objectives ??= { victory: [{ id: "clear_waves", label: "Clear all waves", kind: "clearWaves" }] });
    objectives.victory ??= [];
    objectives.victory.push({ id: `objective_${objectives.victory.length + 1}`, label: "New objective", kind: "surviveSeconds", seconds: 60 });
    markDirty(true); renderMissionDetail(id);
  });
  detail.querySelectorAll(".mf-objective-delete").forEach((button) => button.addEventListener("click", () => {
    const rows = m.objectives?.victory?.length ? m.objectives.victory : [{ id: "clear_waves", label: "Clear all waves", kind: "clearWaves" }];
    const next = rows.filter((_, index) => index !== Number(button.closest("[data-objective-index]")?.dataset.objectiveIndex));
    m.objectives = { ...(m.objectives ?? {}), victory: next.length ? next : [{ id: "clear_waves", label: "Clear all waves", kind: "clearWaves" }] };
    markDirty(true); renderMissionDetail(id);
  }));
  $("mf-star-add")?.addEventListener("click", () => {
    const objectives = (m.objectives ??= { victory: [{ id: "clear_waves", label: "Clear all waves", kind: "clearWaves" }] });
    const stars = (objectives.stars ??= []);
    stars.push({ id: `star_${stars.length + 1}`, label: `Star ${stars.length + 1}`, kind: "coreHpAtLeast", amount: Math.max(1, Math.floor((m.startingCoreHp ?? 20) * 0.5)) });
    markDirty(true); renderMissionDetail(id);
  });
  detail.querySelectorAll(".mf-star-delete").forEach((button) => button.addEventListener("click", () => {
    if (!m.objectives?.stars) return;
    m.objectives.stars.splice(Number(button.closest("[data-star-index]")?.dataset.starIndex), 1);
    markDirty(true); renderMissionDetail(id);
  }));

  detail.querySelectorAll("input, select, textarea").forEach(inp => {
    inp.addEventListener("change", () => persistMission(id));
  });

  $("mission-del-btn")?.addEventListener("click", async () => {
    if (!(await confirmDialog({ title: `Delete mission "${id}"?`, message: "The mission will be removed.", refs: findReferences("mission", id) }))) return;
    delete S.project.missions[id];
    S.selectedMissionEdId = null;
    markDirty(true); renderMissionsTab();
  });
  $("mission-dup-btn")?.addEventListener("click", () => duplicateStudioEntity("missions", id));

  $("mission-sim-btn")?.addEventListener("click", async () => {
    showOverlayLoading("sim-overlay", "sim-results", "Running headless simulation…", "sim-title", "Simulating");
    try {
      const result = await apiGet(`/api/sim/${encodeURIComponent(id)}`);
      showSimResult(result);
    } catch (e) { toast("Sim error: " + e.message, "err"); $("sim-overlay")?.classList.add("hidden"); }
  });
}

function persistMission(oldId) {
  const missions = S.project.missions;
  const m = missions[oldId];
  if (!m) return;
  const newId = $("mf-id")?.value.trim() || oldId;

  const buildTowerIds = [...document.querySelectorAll(".mission-tower-cb:checked")].map(cb => cb.dataset.tid);
  const abilityIds    = [...document.querySelectorAll(".mission-ability-cb:checked")].map(cb => cb.dataset.aid);
  const sunEnabled    = $("mf-sun-enable")?.checked;
  const economyEnabled = $("mf-economy-enable")?.checked;

  const updated = {
    ...m,
    id:              newId,
    label:           $("mf-label")?.value ?? m.label,
    description:     $("mf-desc")?.value  ?? m.description,
    availability:    $("mf-avail")?.value ?? m.availability,
    mapId:           $("mf-mapId")?.value ?? m.mapId,
    waveSetId:       $("mf-waveSetId")?.value ?? m.waveSetId,
    startingCoreHp:  parseFloat($("mf-coreHp")?.value) || 20,
    startingResources: readCurrencyBag("mf-start"),
    prepTimeUnits:   parseFloat($("mf-prep")?.value) || 20,
    buildTowerIds,
    abilityIds,
  };

  if (sunEnabled) {
    let pathOrders = [];
    try { pathOrders = JSON.parse($("mf-sun-pathOrders")?.value ?? "[]"); } catch {}
    updated.sunlight = {
      pathOrders,
      regenPerUnit:        parseFloat($("mf-sun-regen")?.value) || 0,
      aoeDamageMultiplier: parseFloat($("mf-sun-aoe")?.value)   || 1,
    };
  } else { delete updated.sunlight; }

  if (economyEnabled) {
    updated.economy = {
      sellRefundRatio: Math.max(0, Math.min(1, Number($("mf-econ-refund")?.value) || 0)),
      interestRate: Math.max(0, Number($("mf-econ-interest")?.value) || 0),
      perWaveStart: readCurrencyBag("mf-econ-start"),
      perWaveClear: readCurrencyBag("mf-econ-clear"),
      passivePerTimeUnit: readCurrencyBag("mf-econ-passive"),
      earlyStartBonusPerUnit: readCurrencyBag("mf-econ-early"),
      interestCap: readCurrencyBag("mf-econ-cap")
    };
  } else { delete updated.economy; }

  const objectiveRows = [...document.querySelectorAll("[data-objective-index]")];
  const victory = objectiveRows.map((row, index) => {
    const kind = row.querySelector(".mf-objective-kind")?.value ?? "clearWaves";
    const label = row.querySelector(".mf-objective-label")?.value.trim();
    const target = Math.max(0, Number(row.querySelector(".mf-objective-target")?.value) || 0);
    const reference = row.querySelector(".mf-objective-ref")?.value;
    const base = { id: row.dataset.objectiveId || `objective_${index + 1}`, ...(label ? { label } : {}), kind };
    if (kind === "surviveSeconds") return { ...base, seconds: target };
    if (kind === "killCount") return { ...base, count: target, ...(reference ? { enemyTypeId: reference } : {}) };
    if (kind === "accumulateResource") return { ...base, resourceId: reference || projCurrencies()[0]?.id || "coins", amount: target };
    return { ...base, kind: "clearWaves" };
  });
  const failure = [];
  const maxLeaks = $("mf-fail-leaks")?.value.trim();
  const timeLimit = $("mf-fail-time")?.value.trim();
  if (maxLeaks) failure.push({ id: "max_leaks", label: "Maximum leaks", kind: "maxLeaks", maxLeaks: Math.max(0, Number(maxLeaks) || 0) });
  if (timeLimit) failure.push({ id: "time_limit", label: "Time limit", kind: "timeLimit", seconds: Math.max(0, Number(timeLimit) || 0) });

  const stars = [...document.querySelectorAll("[data-star-index]")].map((row, index) => {
    const kind = row.querySelector(".mf-star-kind")?.value ?? "coreHpAtLeast";
    const label = row.querySelector(".mf-star-label")?.value.trim() || `Star ${index + 1}`;
    const target = Math.max(0, Number(row.querySelector(".mf-star-target")?.value) || 0);
    const base = { id: row.dataset.starId || `star_${index + 1}`, label, kind };
    if (kind === "maxLeaks") return { ...base, maxLeaks: target };
    if (kind === "timeAtMost") return { ...base, seconds: target };
    if (kind === "resourceAtLeast") return { ...base, resourceId: row.querySelector(".mf-star-resource")?.value || projCurrencies()[0]?.id || "coins", amount: target };
    return { ...base, kind: "coreHpAtLeast", amount: target };
  });
  const isImplicitDefault = !m.objectives
    && victory.length === 1
    && victory[0].kind === "clearWaves"
    && victory[0].id === "clear_waves"
    && failure.length === 0
    && stars.length === 0;
  if (isImplicitDefault) delete updated.objectives;
  else updated.objectives = {
    victory: victory.length ? victory : [{ id: "clear_waves", label: "Clear all waves", kind: "clearWaves" }],
    ...(failure.length ? { failure } : {}),
    ...(stars.length ? { stars } : {})
  };

  if (newId !== oldId) { delete missions[oldId]; S.selectedMissionEdId = newId; }
  missions[newId] = updated;
  markDirty(true);
  renderMissionsTab();
}

// ─────────────────────────────────────────────────────────────────────────────
// WORLD MAP EDITOR
// ─────────────────────────────────────────────────────────────────────────────
function renderWorldMapTab() {
  const wm      = S.project.worldMap ?? { width: 800, height: 600, regions: [], missionNodes: [] };
  const regions = wm.regions  ?? [];
  const nodes   = wm.missionNodes ?? [];

  // Region list
  const rList = $("region-list");
  rList.innerHTML = "";
  for (const r of regions) {
    const div = document.createElement("div");
    div.className = "wm-item" + (r.id === S.selectedRegionId ? " active" : "");
    div.innerHTML = `<div style="display:flex;align-items:center;gap:6px;flex:1">
      <span style="width:10px;height:10px;border-radius:2px;background:${esc(r.accent??'#4a7c4a')};flex-shrink:0"></span>
      <span class="wm-name">${esc(r.label || r.id)}</span>
    </div>
    <span class="wm-sub">${esc(r.biome ?? "")}</span>`;
    div.addEventListener("click", () => { S.selectedRegionId = r.id; S.selectedNodeId = null; renderWorldMapDetail(); renderWorldMapTab(); });
    rList.appendChild(div);
  }

  // Node list
  const nList = $("node-list");
  nList.innerHTML = "";
  for (const n of nodes) {
    const m = S.project.missions?.[n.missionId];
    const div = document.createElement("div");
    div.className = "wm-item" + (n.missionId === S.selectedNodeId ? " active" : "");
    div.innerHTML = `<span class="wm-name">${esc(m?.label || n.missionId)}</span>
      <span class="wm-sub">${"★".repeat(Math.min(n.difficulty ?? 1, 5))}</span>`;
    div.addEventListener("click", () => { S.selectedNodeId = n.missionId; S.selectedRegionId = null; renderWorldMapDetail(); renderWorldMapTab(); });
    nList.appendChild(div);
  }

  // Canvas preview
  drawWorldMapCanvas(wm);

  $("worldmap-dims").textContent = `${wm.width ?? 0} × ${wm.height ?? 0}`;
}

function drawWorldMapCanvas(wm) {
  const canvas = $("worldmap-canvas");
  if (!canvas) return;
  const W = canvas.offsetWidth  || 600;
  const H = canvas.offsetHeight || 400;
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, W, H);

  const regions = wm.regions  ?? [];
  const nodes   = wm.missionNodes ?? [];
  const mw = wm.width  || 1;
  const mh = wm.height || 1;

  // Regions
  for (const r of regions) {
    const b   = r.bounds;
    if (!b) continue;
    const x = b.x / mw * W;
    const y = b.y / mh * H;
    const w = b.width  / mw * W;
    const h = b.height / mh * H;
    ctx.fillStyle = (r.accent ?? "#3a5a3a") + "22";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = r.accent ?? "#4a7c4a";
    ctx.lineWidth = r.id === S.selectedRegionId ? 2 : 1;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = r.accent ?? "#7eb87e";
    ctx.font = "11px -apple-system, sans-serif";
    ctx.fillText(r.label || r.id, x + 6, y + 16);
  }

  // Connections (edges between nodes)
  const nodeMap = {};
  for (const n of nodes) nodeMap[n.missionId] = n;
  ctx.strokeStyle = "#3a5a3a";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (const n of nodes) {
    const x1 = n.x / mw * W, y1 = n.y / mh * H;
    for (const rid of n.unlockRequiresMissionIds ?? []) {
      const r2 = nodeMap[rid];
      if (!r2) continue;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(r2.x / mw * W, r2.y / mh * H);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // Mission nodes
  for (const n of nodes) {
    const nx = n.x / mw * W, ny = n.y / mh * H;
    const m  = S.project.missions?.[n.missionId];
    const isSelected = n.missionId === S.selectedNodeId;
    ctx.beginPath();
    ctx.arc(nx, ny, isSelected ? 9 : 7, 0, Math.PI * 2);
    ctx.fillStyle = isSelected ? "#7eb87e" : "#3a6a3a";
    ctx.fill();
    ctx.strokeStyle = "#7eb87e";
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.stroke();
    ctx.fillStyle = "#e8e8e8";
    ctx.font = "10px -apple-system, sans-serif";
    ctx.fillText(m?.label || n.missionId, nx + 11, ny + 4);
  }

  // Click on canvas to select node
  canvas.onclick = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const cx = ev.clientX - rect.left;
    const cy = ev.clientY - rect.top;
    for (const n of nodes) {
      const nx = n.x / mw * W, ny = n.y / mh * H;
      const d  = Math.sqrt((cx-nx)**2 + (cy-ny)**2);
      if (d < 14) {
        S.selectedNodeId = n.missionId; S.selectedRegionId = null;
        renderWorldMapDetail(); renderWorldMapTab(); return;
      }
    }
  };
}

function renderWorldMapDetail() {
  const detail  = $("worldmap-detail");
  if (!detail) return;
  const wm      = S.project.worldMap ?? {};
  const regions = wm.regions  ?? [];
  const nodes   = wm.missionNodes ?? [];

  if (S.selectedRegionId) {
    const r = regions.find(r => r.id === S.selectedRegionId);
    if (!r) return;
    const otherRegions = regions.filter(r2 => r2.id !== r.id);
    detail.innerHTML = `
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border)">
        Region: ${esc(r.label || r.id)}
        <button class="btn btn-danger" id="region-del-btn" style="float:right">Delete</button>
      </div>
      <div class="form-row"><div class="field"><label>ID</label><input id="rf-id" value="${esc(r.id)}"></div></div>
      <div class="form-row"><div class="field"><label>Label</label><input id="rf-label" value="${esc(r.label??"")}"></div></div>
      <div class="form-row"><div class="field"><label>Biome</label><input id="rf-biome" value="${esc(r.biome??"")}"></div></div>
      <div class="form-row"><div class="field"><label>Accent Color</label><input id="rf-accent" type="color" value="${r.accent??"#4a7c4a"}"></div></div>
      <div class="field"><label>Description</label><textarea id="rf-desc" rows="2">${esc(r.description??"")}</textarea></div>
      <div class="form-section-title" style="margin-top:10px">Bounds</div>
      <div class="form-row">
        <div class="field"><label>X</label><input id="rf-bx" type="number" value="${r.bounds?.x??0}"></div>
        <div class="field"><label>Y</label><input id="rf-by" type="number" value="${r.bounds?.y??0}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Width</label><input id="rf-bw" type="number" value="${r.bounds?.width??800}"></div>
        <div class="field"><label>Height</label><input id="rf-bh" type="number" value="${r.bounds?.height??600}"></div>
      </div>
      <div class="form-section-title" style="margin-top:10px">Connections</div>
      <div>${otherRegions.map(r2 =>
        `<label class="check-item"><input type="checkbox" class="conn-cb" data-rid="${esc(r2.id)}"${(r.connections??[]).includes(r2.id)?" checked":""}> ${esc(r2.label||r2.id)}</label>`
      ).join("") || "<span class='text-muted text-sm'>No other regions.</span>"}</div>`;

    const persist = () => {
      r.id          = $("rf-id")?.value.trim() || r.id;
      r.label       = $("rf-label")?.value ?? r.label;
      r.biome       = $("rf-biome")?.value ?? r.biome;
      r.accent      = $("rf-accent")?.value ?? r.accent;
      r.description = $("rf-desc")?.value  ?? r.description;
      r.bounds      = { x: +($("rf-bx")?.value||0), y: +($("rf-by")?.value||0), width: +($("rf-bw")?.value||800), height: +($("rf-bh")?.value||600) };
      r.connections = [...document.querySelectorAll(".conn-cb:checked")].map(cb=>cb.dataset.rid);
      S.selectedRegionId = r.id;
      markDirty(true); renderWorldMapTab();
    };
    detail.querySelectorAll("input, select, textarea").forEach(inp => inp.addEventListener("change", persist));
    $("region-del-btn")?.addEventListener("click", async () => {
      if (!(await confirmDialog({ title: "Delete region?", message: `Region "${S.selectedRegionId}" will be removed from the world map.` }))) return;
      wm.regions = regions.filter(r2 => r2.id !== S.selectedRegionId);
      S.selectedRegionId = null; markDirty(true); renderWorldMapTab();
    });

  } else if (S.selectedNodeId) {
    const n = nodes.find(n => n.missionId === S.selectedNodeId);
    if (!n) return;
    const missionOpts = Object.keys(S.project.missions ?? {}).map(mid =>
      `<option value="${esc(mid)}"${mid===n.missionId?" selected":""}>${esc(mid)}</option>`).join("");
    const regionOpts  = regions.map(r =>
      `<option value="${esc(r.id)}"${r.id===n.regionId?" selected":""}>${esc(r.label||r.id)}</option>`).join("");
    const otherMissions = Object.keys(S.project.missions ?? {}).filter(mid => mid !== n.missionId);

    detail.innerHTML = `
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border)">
        Node: ${esc(n.missionId)}
        <button class="btn btn-danger" id="node-del-btn" style="float:right">Delete</button>
      </div>
      <div class="form-row"><div class="field"><label>Mission</label><select id="nf-mission">${missionOpts}</select></div></div>
      <div class="form-row"><div class="field"><label>Region</label><select id="nf-region">${regionOpts}</select></div></div>
      <div class="form-row">
        <div class="field"><label>X</label><input id="nf-x" type="number" value="${n.x??0}"></div>
        <div class="field"><label>Y</label><input id="nf-y" type="number" value="${n.y??0}"></div>
        <div class="field"><label>Difficulty (1–5)</label><input id="nf-diff" type="number" min="1" max="5" value="${n.difficulty??1}"></div>
      </div>
      <div class="form-section-title" style="margin-top:10px">Unlock Requires Missions</div>
      <div>${otherMissions.map(mid =>
        `<label class="check-item"><input type="checkbox" class="unlock-cb" data-mid="${esc(mid)}"${(n.unlockRequiresMissionIds??[]).includes(mid)?" checked":""}> ${esc(mid)}</label>`
      ).join("") || "<span class='text-muted text-sm'>None.</span>"}</div>`;

    const persist = () => {
      const newMid = $("nf-mission")?.value ?? n.missionId;
      n.missionId = newMid;
      n.regionId  = $("nf-region")?.value  ?? n.regionId;
      n.x         = parseFloat($("nf-x")?.value)    || 0;
      n.y         = parseFloat($("nf-y")?.value)     || 0;
      n.difficulty = parseInt($("nf-diff")?.value)   || 1;
      n.unlockRequiresMissionIds = [...document.querySelectorAll(".unlock-cb:checked")].map(cb=>cb.dataset.mid);
      S.selectedNodeId = newMid;
      markDirty(true); renderWorldMapTab();
    };
    detail.querySelectorAll("input, select").forEach(inp => inp.addEventListener("change", persist));
    $("node-del-btn")?.addEventListener("click", async () => {
      if (!(await confirmDialog({ title: "Delete node?", message: `Mission node "${S.selectedNodeId}" will be removed from the world map.` }))) return;
      wm.missionNodes = nodes.filter(n2 => n2.missionId !== S.selectedNodeId);
      S.selectedNodeId = null; markDirty(true); renderWorldMapTab();
    });
  } else {
    detail.innerHTML = `<div style="padding:12px;color:var(--text-dim);font-size:12px">Click a region or node to edit.</div>`;
  }
}

// Add region / node buttons
$("btn-add-region")?.addEventListener("click", addRegion);
$("btn-add-region-2")?.addEventListener("click", addRegion);
function addRegion() {
  if (!S.project.worldMap) S.project.worldMap = { width: 800, height: 600, regions: [], missionNodes: [] };
  if (!S.project.worldMap.regions) S.project.worldMap.regions = [];
  const id = "region_" + Math.random().toString(36).slice(-6);
  S.project.worldMap.regions.push({ id, label: "New Region", description: "", biome: "meadow", accent: "#4a7c4a", bounds: { x: 100, y: 100, width: 400, height: 300 }, connections: [] });
  S.selectedRegionId = id; S.selectedNodeId = null;
  markDirty(true); renderWorldMapTab(); renderWorldMapDetail();
}

$("btn-add-node")?.addEventListener("click", addNode);
$("btn-add-node-2")?.addEventListener("click", addNode);
function addNode() {
  if (!S.project.worldMap) S.project.worldMap = { width: 800, height: 600, regions: [], missionNodes: [] };
  if (!S.project.worldMap.missionNodes) S.project.worldMap.missionNodes = [];
  const firstMission = Object.keys(S.project.missions ?? {})[0] ?? "";
  const firstRegion  = S.project.worldMap.regions?.[0]?.id ?? "";
  S.project.worldMap.missionNodes.push({ missionId: firstMission, regionId: firstRegion, x: 300, y: 300, difficulty: 1, unlockRequiresMissionIds: [] });
  S.selectedNodeId = firstMission; S.selectedRegionId = null;
  markDirty(true); renderWorldMapTab(); renderWorldMapDetail();
}

// ─────────────────────────────────────────────────────────────────────────────
// MAP AUTHORING (Tiled-style tile-layer editor)
// ─────────────────────────────────────────────────────────────────────────────
let mapRenderer = null;
let mapPainting = false;
let mapPaintStroke = null;
const GID_BY_TERRAIN_C = { buildable: 1, path: 2, blocked: 3, water: 4, spawn: 5, core: 6 };
const TERRAIN_BY_GID_C = { 1: "buildable", 2: "path", 3: "blocked", 4: "water", 5: "spawn", 6: "core" };

/** Find or create the authoritative "terrain" tilelayer, resizing its data to width×height. */
function ensureTerrainLayer(source) {
  source.width = Math.max(1, Number(source.width) || 1);
  source.height = Math.max(1, Number(source.height) || 1);
  const w = source.width, h = source.height;
  if (!Array.isArray(source.layers)) source.layers = [];
  let idx = source.layers.findIndex(l => l && l.type === "tilelayer" && l.name === "terrain");
  if (idx < 0) idx = source.layers.findIndex(l => l && l.type === "tilelayer");
  let layer = idx >= 0 ? source.layers[idx] : null;
  const fillGid = GID_BY_TERRAIN_C[mapDefaultTerrain(source)] ?? 1;
  if (!layer) {
    layer = { id: 1, name: "terrain", type: "tilelayer", x: 0, y: 0, width: w, height: h, visible: true, opacity: 1, data: new Array(w * h).fill(fillGid), properties: [] };
    source.layers.unshift(layer);
    return layer;
  }
  if (!Array.isArray(layer.data) || layer.width !== w || layer.height !== h || layer.data.length !== w * h) {
    const oldW = layer.width || w, oldH = layer.height || h, old = Array.isArray(layer.data) ? layer.data : [];
    const data = new Array(w * h).fill(fillGid);
    for (let r = 0; r < Math.min(h, oldH); r += 1)
      for (let q = 0; q < Math.min(w, oldW); q += 1) { const g = old[r * oldW + q]; if (g) data[r * w + q] = g; }
    layer.width = w; layer.height = h; layer.data = data;
  }
  return layer;
}
function mapDefaultTerrain(source) {
  const p = (source.properties ?? []).find(pr => pr.name === "defaultTerrain");
  return String(p?.value ?? source.defaultTerrain ?? "buildable");
}
function paintTerrainTile(source, coord, terrain) {
  const layer = ensureTerrainLayer(source);
  const i = coord.r * layer.width + coord.q;
  if (i < 0 || i >= layer.data.length) return;
  layer.data[i] = GID_BY_TERRAIN_C[terrain] ?? 1;
  // Tile layer is authoritative: drop any conflicting legacy explicit override.
  if (Array.isArray(source.terrainOverrides)) source.terrainOverrides = source.terrainOverrides.filter(o => !(o.q === coord.q && o.r === coord.r));
}

function coordKey(coord) { return `${coord.q},${coord.r}`; }

/** Keep the authored centerline, its default runtime route, and path terrain in lockstep. */
function replacePrimaryPath(source, nextPath) {
  const path = nextPath.map(coord => ({ q: coord.q, r: coord.r }));
  const pathKeys = new Set(path.map(coordKey));
  const layer = ensureTerrainLayer(source);
  const defaultTerrain = mapDefaultTerrain(source);

  // Path painting owns path terrain. Removing/replacing a route must not leave road cells from the
  // previous centerline behind, because those cells make the map preview disagree with runtime.
  for (let i = 0; i < layer.data.length; i += 1) {
    if (TERRAIN_BY_GID_C[layer.data[i]] !== "path") continue;
    const key = `${i % layer.width},${Math.floor(i / layer.width)}`;
    if (!pathKeys.has(key)) layer.data[i] = GID_BY_TERRAIN_C[defaultTerrain] ?? GID_BY_TERRAIN_C.buildable;
  }
  if (Array.isArray(source.terrainOverrides)) {
    source.terrainOverrides = source.terrainOverrides.filter(item => item.terrain !== "path" || pathKeys.has(coordKey(item)));
  }
  for (const coord of path) paintTerrainTile(source, coord, "path");

  setMapProperty(source, "pathCenterline", JSON.stringify(path));

  // HexMap uses the first named route as the default route. Keep it synchronized when the source
  // explicitly declares routes; with no named routes the compiler derives "main" from centerline.
  const routeProp = (source.properties ?? []).find(prop => prop.name === "pathRoutes");
  const routes = Array.isArray(source.pathRoutes)
    ? source.pathRoutes
    : parseJsonInput(routeProp?.value, []);
  if (Array.isArray(routes) && routes.length) {
    const updated = routes.map((route, index) => index === 0 ? { ...route, pathCenterline: path.map(coord => ({ ...coord })) } : route);
    if (Array.isArray(source.pathRoutes)) source.pathRoutes = updated;
    else setMapProperty(source, "pathRoutes", JSON.stringify(updated));
  }
}

function updateMapPathField(source, value) {
  let parsed;
  try { parsed = JSON.parse(value); }
  catch { toast("pathCenterline must be valid JSON.", "warn"); return; }
  if (!Array.isArray(parsed)) { toast("pathCenterline must be a JSON array.", "warn"); return; }
  replacePrimaryPath(source, parsed);
  markDirty(true);
  drawSelectedMapSource();
}
/** Build a render definition honoring layer-visibility toggles. */
function mapEditorDefinition(source) {
  const def = mapSourceToDefinition(source, S.selectedMapSourceName);
  const layer = ensureTerrainLayer(source);
  const overrides = [];
  if (S.mapLayers.terrain) {
    for (let i = 0; i < layer.data.length; i += 1) {
      const terrain = TERRAIN_BY_GID_C[layer.data[i]];
      if (terrain && terrain !== def.defaultTerrain && terrain !== "spawn" && terrain !== "core")
        overrides.push({ q: i % layer.width, r: Math.floor(i / layer.width), terrain });
    }
    for (const o of def.terrainOverrides ?? []) if (o.terrain !== "spawn" && o.terrain !== "core") overrides.push(o);
  }
  if (S.mapLayers.markers) {
    overrides.push({ ...def.spawnCoord, terrain: "spawn" });
    overrides.push({ ...def.coreCoord, terrain: "core" });
  }
  return { ...def, terrainOverrides: overrides, pathCenterline: S.mapLayers.path ? def.pathCenterline : [] };
}

function renderMapsTab() {
  if (!S.project.mapSources) S.project.mapSources = {};
  S.mapLayers ??= { terrain: true, markers: true, path: true };
  const names = Object.keys(S.project.mapSources);
  if (!S.selectedMapSourceName || !S.project.mapSources[S.selectedMapSourceName]) {
    S.selectedMapSourceName = names[0] ?? null;
  }
  renderMapSourceList();
  renderMapSourceDetail();
  bindMapLayerToggles();
  drawSelectedMapSource();
}

function bindMapLayerToggles() {
  const bind = (id, key) => { const cb = $(id); if (cb) { cb.checked = S.mapLayers[key]; cb.onchange = () => { S.mapLayers[key] = cb.checked; drawSelectedMapSource(); }; } };
  bind("layer-terrain", "terrain"); bind("layer-markers", "markers"); bind("layer-path", "path");
}

function renderMapSourceList() {
  const list = $("map-source-list");
  if (!list) return;
  list.innerHTML = "";
  for (const [name, source] of Object.entries(S.project.mapSources ?? {})) {
    const div = document.createElement("div");
    div.className = "entity-item" + (name === S.selectedMapSourceName ? " active" : "");
    div.innerHTML = `<div class="item-name">${esc(mapSourceId(source, name))}</div><div class="item-id">${esc(name)}</div>`;
    div.addEventListener("click", () => { S.selectedMapSourceName = name; renderMapsTab(); });
    list.appendChild(div);
  }
  const addButton = $("btn-add-map-source");
  if (addButton) addButton.onclick = addMapSource;
}

function addMapSource() {
  if (!S.project.mapSources) S.project.mapSources = {};
  const id = "map_" + Math.random().toString(36).slice(-5);
  const sourceName = `${id}.tmj`;
  const w = 6, h = 6;
  const gridKind = $("new-map-grid")?.value === "square" ? "square" : "hex";
  const pathCenterline = Array.from({ length: h }, (_, r) => ({ q: 2, r }));
  // Tiled "terrain" tile layer: all buildable (gid 1), the path column = gid 2.
  const data = new Array(w * h).fill(GID_BY_TERRAIN_C.buildable);
  for (const c of pathCenterline) data[c.r * w + c.q] = GID_BY_TERRAIN_C.path;
  S.project.mapSources[sourceName] = {
    id,
    type: "map",
    orientation: gridKind === "square" ? "orthogonal" : "hexagonal",
    width: w,
    height: h,
    properties: [
      { name: "id", type: "string", value: id },
      { name: "towerforge.gridKind", type: "string", value: gridKind },
      { name: "defaultTerrain", type: "string", value: "buildable" },
      { name: "spawnCoord", type: "string", value: JSON.stringify(pathCenterline[0]) },
      { name: "coreCoord", type: "string", value: JSON.stringify(pathCenterline[pathCenterline.length - 1]) },
      { name: "pathCenterline", type: "string", value: JSON.stringify(pathCenterline) }
    ],
    layers: [
      { id: 1, name: "terrain", type: "tilelayer", x: 0, y: 0, width: w, height: h, visible: true, opacity: 1, data, properties: [] }
    ],
    terrainOverrides: []
  };
  S.selectedMapSourceName = sourceName;
  markDirty(true);
  renderMapsTab();
}

function renderMapSourceDetail() {
  const detail = $("map-source-detail");
  const source = S.project.mapSources?.[S.selectedMapSourceName];
  if (!detail) return;
  if (!source) {
    detail.innerHTML = `<div class="empty-state">Select or add a map source.</div>`;
    return;
  }
  const map = mapSourceToDefinition(source, S.selectedMapSourceName);
  $("map-editor-title").textContent = `${S.selectedMapSourceName} · ${map.width}x${map.height}`;
  detail.innerHTML = `
    <div class="form-section">
      <div class="form-section-title">Map Identity</div>
      <div class="form-row">
        <div class="field"><label>ID</label><input id="map-id-field" class="mono" value="${esc(map.id)}"></div>
        <div class="field"><label>Grid</label><select id="map-grid-field"><option value="hex"${map.grid.kind==="hex"?" selected":""}>Hex odd-r</option><option value="square"${map.grid.kind==="square"?" selected":""}>Square cardinal</option></select></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Default Terrain</label>
          <select id="map-default-terrain">
            ${["buildable","blocked","water","path"].map(t => `<option value="${t}"${map.defaultTerrain===t?" selected":""}>${t}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="field"><label>Width</label><input id="map-width-field" type="number" min="1" step="1" value="${map.width}"></div>
        <div class="field"><label>Height</label><input id="map-height-field" type="number" min="1" step="1" value="${map.height}"></div>
      </div>
    </div>
    <div class="form-section">
      <div class="form-section-title">Coords and Routes</div>
      <div class="form-row">
        <div class="field"><label>Spawn</label><input id="map-spawn-field" class="mono" value="${esc(JSON.stringify(map.spawnCoord))}"></div>
        <div class="field"><label>Core</label><input id="map-core-field" class="mono" value="${esc(JSON.stringify(map.coreCoord))}"></div>
      </div>
      <div class="field"><label>Path Centerline</label><textarea id="map-path-field" class="mono" rows="5">${esc(JSON.stringify(map.pathCenterline, null, 2))}</textarea></div>
      <div class="field"><label>Named Routes</label><textarea id="map-routes-field" class="mono" rows="5">${esc(JSON.stringify(map.pathRoutes ?? [], null, 2))}</textarea></div>
      <div class="field"><label>Terrain Overrides</label><textarea id="map-terrain-field" class="mono" rows="6">${esc(JSON.stringify(map.terrainOverrides ?? [], null, 2))}</textarea></div>
    </div>`;

  $("map-id-field").onchange = (e) => { setMapProperty(source, "id", e.target.value.trim()); source.id = e.target.value.trim(); markDirty(true); renderMapSourceList(); };
  $("map-grid-field").onchange = (e) => {
    const kind = e.target.value === "square" ? "square" : "hex";
    source.orientation = kind === "square" ? "orthogonal" : "hexagonal";
    setMapProperty(source, "towerforge.gridKind", kind);
    markDirty(true);
    drawSelectedMapSource();
  };
  $("map-default-terrain").onchange = (e) => { setMapProperty(source, "defaultTerrain", e.target.value); markDirty(true); drawSelectedMapSource(); };
  $("map-width-field").onchange = (e) => { source.width = Math.max(1, Number(e.target.value) || 1); markDirty(true); drawSelectedMapSource(); };
  $("map-height-field").onchange = (e) => { source.height = Math.max(1, Number(e.target.value) || 1); markDirty(true); drawSelectedMapSource(); };
  $("map-spawn-field").onchange = (e) => updateMapJsonField(source, "spawnCoord", e.target.value, false);
  $("map-core-field").onchange = (e) => updateMapJsonField(source, "coreCoord", e.target.value, false);
  $("map-path-field").onchange = (e) => updateMapPathField(source, e.target.value);
  $("map-routes-field").onchange = (e) => { source.pathRoutes = parseJsonInput(e.target.value, []); markDirty(true); drawSelectedMapSource(); };
  $("map-terrain-field").onchange = (e) => { source.terrainOverrides = parseJsonInput(e.target.value, []); markDirty(true); drawSelectedMapSource(); };
  $("map-paint-mode").onchange = (e) => { S.mapPaintMode = e.target.value; };
  $("map-paint-mode").value = S.mapPaintMode;
}

function drawSelectedMapSource() {
  const canvas = $("map-editor-canvas");
  const source = S.project.mapSources?.[S.selectedMapSourceName];
  if (!canvas || !source) return;
  if (!mapRenderer) {
    mapRenderer = createCanvasRenderer({ canvas, content: { towers: {}, enemies: {}, visuals: S.project.visuals ?? {} } });
    window.addEventListener("resize", () => { if (S.activeTab === "maps") drawSelectedMapSource(); });
    canvas.addEventListener("mousedown", e => {
      if (e.button !== 0 || S.mapPaintMode === "inspect") return;
      mapPainting = true;
      mapPaintStroke = { visited: new Set(), pathAction: null };
      paintMapAt(e);
    });
    canvas.addEventListener("mousemove", e => { if (mapPainting) paintMapAt(e); });
    window.addEventListener("mouseup", () => {
      if (!mapPainting) return;
      mapPainting = false;
      mapPaintStroke = null;
      if (S.activeTab === "maps") renderMapSourceDetail();
    });
  }
  mapRenderer.resize();
  mapRenderer.content.visuals = S.project.visuals ?? {};
  mapRenderer.drawMapDefinition(mapEditorDefinition(source));
}

function paintMapAt(event) {
  const source = S.project.mapSources?.[S.selectedMapSourceName];
  if (!source || S.mapPaintMode === "inspect") return;
  const def = mapSourceToDefinition(source, S.selectedMapSourceName);
  const tiles = [];
  for (let r = 0; r < def.height; r += 1)
    for (let q = 0; q < def.width; q += 1) tiles.push({ q, r });
  const coord = mapRenderer.pickTile(event, tiles);
  if (!coord) return;
  const key = coordKey(coord);
  if (mapPaintStroke?.visited.has(key)) return;
  mapPaintStroke?.visited.add(key);
  const mode = S.mapPaintMode;
  if (mode === "spawn") setMapProperty(source, "spawnCoord", JSON.stringify(coord));
  else if (mode === "core") setMapProperty(source, "coreCoord", JSON.stringify(coord));
  else if (mode === "path") {
    const path = def.pathCenterline ?? [];
    const exists = path.some(point => coordKey(point) === key);
    if (mapPaintStroke && mapPaintStroke.pathAction === null) mapPaintStroke.pathAction = exists ? "remove" : "add";
    const action = mapPaintStroke?.pathAction ?? (exists ? "remove" : "add");
    const previous = path[path.length - 1];
    if (action === "add" && previous && !mapCoordsAdjacent(previous, coord, def.grid)) {
      toast(`Route segments must be adjacent on the ${def.grid.kind} grid.`, "warn");
      return;
    }
    const nextPath = action === "remove"
      ? path.filter(point => coordKey(point) !== key)
      : exists ? path : [...path, coord];
    replacePrimaryPath(source, nextPath);
  } else {
    paintTerrainTile(source, coord, mode); // buildable / blocked / water
    const path = def.pathCenterline ?? [];
    if (path.some(point => coordKey(point) === key)) {
      replacePrimaryPath(source, path.filter(point => coordKey(point) !== key));
      paintTerrainTile(source, coord, mode);
    }
  }
  markDirty(true);
  drawSelectedMapSource();
}

$("btn-map-clear-path")?.addEventListener("click", async () => {
  const source = S.project?.mapSources?.[S.selectedMapSourceName];
  if (!source) return;
  const ok = await confirmDialog({
    title: "Clear route?",
    message: "This removes the centerline and its path terrain. You can undo the change before saving.",
    confirmLabel: "Clear route",
    danger: true
  });
  if (!ok) return;
  replacePrimaryPath(source, []);
  S.mapPaintMode = "path";
  markDirty(true);
  renderMapSourceDetail();
  drawSelectedMapSource();
});

async function compileMaps() {
  if (S.dirty) {
    const saved = await save();
    if (!saved) return;
  }
  setStatus("Compiling maps…");
  try {
    const result = await apiPost("/api/maps/compile", {});
    S.project.maps = result.maps;
    S.contentHash = result.newHash;
    setStatus("Maps compiled");
    toast("Maps compiled.", "ok");
  } catch (e) {
    setStatus("Map compile failed");
    toast("Map compile failed: " + e.message, "err");
  }
}
$("btn-map-compile")?.addEventListener("click", () => runStudioCommand("project.compile_maps"));

function mapSourceToDefinition(source, sourceName) {
  const props = mapProperties(source);
  const gridKind = props["towerforge.gridKind"] === "square" || source.orientation === "orthogonal" ? "square" : "hex";
  return {
    id: String(props.id ?? source.id ?? sourceName?.replace(/\.tmj$/, "") ?? "map"),
    width: Number(source.width ?? 1),
    height: Number(source.height ?? 1),
    grid: gridKind === "square" ? { kind: "square", adjacency: "cardinal" } : { kind: "hex", layout: "odd-r" },
    defaultTerrain: String(props.defaultTerrain ?? source.defaultTerrain ?? "buildable"),
    spawnCoord: parseJsonInput(props.spawnCoord ?? source.spawnCoord, { q: 0, r: 0 }),
    coreCoord: parseJsonInput(props.coreCoord ?? source.coreCoord, { q: 0, r: 0 }),
    pathCenterline: parseJsonInput(props.pathCenterline ?? source.pathCenterline, []),
    pathRoutes: source.pathRoutes ?? parseJsonInput(props.pathRoutes, []),
    terrainOverrides: source.terrainOverrides ?? parseJsonInput(props.terrainOverrides, [])
  };
}

function mapCoordsAdjacent(a, b, grid) {
  const dq = b.q - a.q, dr = b.r - a.r;
  if (grid?.kind === "square") return Math.abs(dq) + Math.abs(dr) === 1;
  const even = a.r % 2 === 0;
  const deltas = even ? [[-1,-1],[0,-1],[-1,0],[1,0],[-1,1],[0,1]] : [[0,-1],[1,-1],[-1,0],[1,0],[0,1],[1,1]];
  return deltas.some(([x,y]) => x === dq && y === dr);
}

function mapSourceId(source, sourceName) {
  return mapSourceToDefinition(source, sourceName).id;
}

function mapProperties(source) {
  const props = {};
  for (const prop of source.properties ?? []) props[prop.name] = prop.value;
  return props;
}

function setMapProperty(source, name, value) {
  if (!Array.isArray(source.properties)) source.properties = [];
  const existing = source.properties.find((prop) => prop.name === name);
  if (existing) existing.value = value;
  else source.properties.push({ name, type: "string", value });
}

function updateMapJsonField(source, name, value, expectArray) {
  const parsed = parseJsonInput(value, expectArray ? [] : {});
  if (expectArray && !Array.isArray(parsed)) {
    toast(`${name} must be a JSON array.`, "warn");
    return;
  }
  setMapProperty(source, name, JSON.stringify(parsed));
  markDirty(true);
  drawSelectedMapSource();
}

function upsertTerrainOverride(source, coord, terrain) {
  if (!Array.isArray(source.terrainOverrides)) source.terrainOverrides = [];
  source.terrainOverrides = source.terrainOverrides.filter((item) => !(item.q === coord.q && item.r === coord.r));
  source.terrainOverrides.push({ q: coord.q, r: coord.r, terrain });
}

function parseJsonInput(value, fallback) {
  if (typeof value !== "string") return value ?? fallback;
  try { return JSON.parse(value); }
  catch { return fallback; }
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSET CATALOG
// ─────────────────────────────────────────────────────────────────────────────
// ── Project tree / TowerScript editor ────────────────────────────────────────
function renderScriptsTab() {
  if (!S.projectTree && !SCRIPT_UI.loading) refreshProjectTree();
  else renderProjectTree();
  syncScriptEditorUi();
}

async function refreshProjectTree() {
  SCRIPT_UI.loading = true;
  const tree = $("project-tree");
  if (tree) tree.innerHTML = `<div class="workbench-empty">Loading project...</div>`;
  try {
    S.projectTree = await apiGet("/api/project/tree");
    renderProjectTree();
  } catch (error) {
    if (tree) tree.innerHTML = `<div class="workbench-empty">${esc(error.message)}</div>`;
  } finally {
    SCRIPT_UI.loading = false;
  }
}

function renderProjectTree() {
  const tree = $("project-tree");
  if (!tree || !S.projectTree) return;
  tree.innerHTML = renderProjectTreeNodes(S.projectTree.nodes ?? [], 0);
  tree.querySelectorAll("[data-tree-path]").forEach((row) => row.addEventListener("click", async () => {
    const path = row.dataset.treePath;
    const kind = row.dataset.treeKind;
    SCRIPT_UI.selectedNode = { path, kind, manageable: row.dataset.manageable === "true", editable: row.dataset.editable === "true" };
    if (kind === "directory") {
      if (SCRIPT_UI.collapsed.has(path)) SCRIPT_UI.collapsed.delete(path); else SCRIPT_UI.collapsed.add(path);
      renderProjectTree();
      syncScriptTreeActions();
      return;
    }
    if (S.scriptDirty && path !== S.selectedProjectPath) {
      const discard = await confirmDialog({ title: "Discard unsaved script changes?", message: S.selectedProjectPath ?? "Unsaved TowerScript", confirmLabel: "Discard", danger: true });
      if (!discard) return;
      markScriptDirty(false);
    }
    await openProjectTreeFile(path);
  }));
  syncScriptTreeActions();
}

function renderProjectTreeNodes(nodes, depth) {
  return nodes.map((node) => {
    const selected = SCRIPT_UI.selectedNode?.path === node.path;
    const collapsed = node.kind === "directory" && SCRIPT_UI.collapsed.has(node.path);
    const chevron = node.kind === "directory"
      ? `<svg class="tree-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`
      : `<span></span>`;
    const icon = node.kind === "directory"
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5h6l2 2h10v12H3z"/></svg>`
      : node.name.endsWith(".tower.json")
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16h16V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    return `<div class="tree-node"><button class="tree-row${selected ? " active" : ""}${collapsed ? " collapsed" : ""}" type="button" role="treeitem" style="--tree-depth:${depth}" data-tree-path="${esc(node.path)}" data-tree-kind="${esc(node.kind)}" data-manageable="${String(Boolean(node.manageable))}" data-editable="${String(Boolean(node.editable))}">${chevron}${icon}<span class="tree-label">${esc(node.name)}</span></button>${node.kind === "directory" ? `<div class="tree-children${collapsed ? " hidden" : ""}" role="group">${renderProjectTreeNodes(node.children ?? [], depth + 1)}</div>` : ""}</div>`;
  }).join("");
}

async function openProjectTreeFile(path) {
  try {
    const file = await apiGet(`/api/project/file?path=${encodeURIComponent(path)}`);
    S.selectedProjectPath = file.path;
    S.scriptSource = file.source;
    S.scriptFileRevision = file.revision;
    S.scriptOriginalId = file.editable ? safeScriptDefinition(file.source)?.id ?? null : null;
    markScriptDirty(false);
    const editor = $("script-editor");
    if (editor) {
      editor.value = file.source;
      editor.disabled = !file.editable;
      editor.readOnly = !file.editable;
    }
    syncScriptEditorUi();
    validateScriptEditorSource();
  } catch (error) {
    toast(`Could not open file: ${error.message}`, "err");
  }
}

function safeScriptDefinition(source) {
  try {
    const value = JSON.parse(source);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

function validateScriptEditorSource() {
  const diagnostics = $("script-diagnostics");
  const state = $("script-editor-state");
  if (!S.selectedProjectPath?.endsWith(".tower.json")) {
    if (diagnostics) diagnostics.innerHTML = "";
    if (state) { state.textContent = "Read only"; state.className = "script-editor-state"; }
    return false;
  }
  try {
    const definition = JSON.parse($("script-editor")?.value ?? S.scriptSource);
    const missing = ["schemaVersion", "id", "bindings", "handlers"].filter((key) => definition?.[key] === undefined);
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error("TowerScript root must be an object.");
    if (missing.length) throw new Error(`Missing required field${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
    if (diagnostics) diagnostics.innerHTML = "";
    if (state) { state.textContent = S.scriptDirty ? "Unsaved" : "Valid JSON"; state.className = `script-editor-state${S.scriptDirty ? " dirty" : ""}`; }
    return true;
  } catch (error) {
    if (diagnostics) diagnostics.innerHTML = `<div class="script-diagnostic">${ICO.err}<span>${esc(error.message)}</span></div>`;
    if (state) { state.textContent = "Invalid"; state.className = "script-editor-state invalid"; }
    return false;
  }
}

function syncScriptEditorUi() {
  const editor = $("script-editor");
  const isScript = Boolean(S.selectedProjectPath?.endsWith(".tower.json"));
  if ($("script-editor-path")) $("script-editor-path").textContent = S.selectedProjectPath ?? "Select a file";
  if (editor && document.activeElement !== editor && editor.value !== S.scriptSource) editor.value = S.scriptSource;
  if (editor && !S.selectedProjectPath) editor.disabled = true;
  const valid = validateScriptEditorSource();
  if ($("btn-script-save")) $("btn-script-save").disabled = !isScript || !S.scriptDirty || !valid;
  syncScriptTreeActions();
}

function syncScriptTreeActions() {
  const manageable = Boolean(SCRIPT_UI.selectedNode?.manageable);
  if ($("btn-script-rename")) $("btn-script-rename").disabled = !manageable;
  if ($("btn-script-delete")) $("btn-script-delete").disabled = !manageable;
}

async function saveActiveScript({ silent = false } = {}) {
  if (!S.scriptDirty) return true;
  if (!S.selectedProjectPath?.endsWith(".tower.json") || !validateScriptEditorSource()) {
    if (!silent) toast("Fix the TowerScript JSON before saving.", "err");
    return false;
  }
  const source = $("script-editor")?.value ?? S.scriptSource;
  try {
    const result = await apiPost("/api/project/script/save", {
      path: S.selectedProjectPath,
      source,
      contentHash: S.contentHash,
      fileRevision: S.scriptFileRevision ?? "missing"
    });
    const definition = JSON.parse(source);
    if (S.scriptOriginalId && S.scriptOriginalId !== definition.id) delete S.project.scripts?.[S.scriptOriginalId];
    S.project.scripts ??= {};
    S.project.scripts[definition.id] = definition;
    S.project.scriptFiles ??= {};
    S.project.scriptFiles[S.selectedProjectPath] = { path: S.selectedProjectPath, source, definition };
    S.scriptSource = source;
    S.scriptOriginalId = definition.id;
    S.scriptFileRevision = result.fileRevision;
    S.contentHash = result.newHash;
    markScriptDirty(false);
    PT.dirty = true;
    await refreshProjectTree();
    syncScriptEditorUi();
    recordActivity("TowerScript saved", "ok", S.selectedProjectPath);
    if (!silent) toast("TowerScript saved.", "ok");
    return true;
  } catch (error) {
    const issues = error.issues ?? [];
    if ($("script-diagnostics") && issues.length) $("script-diagnostics").innerHTML = issues.map((issue) => `<div class="script-diagnostic">${ICO.err}<span>${esc(issue.message)} <code>${esc(issue.fieldPath ?? "")}</code></span></div>`).join("");
    if (!silent) toast(`Script save failed: ${error.message}`, "err");
    recordActivity("TowerScript save", "error", error.message);
    return false;
  }
}

function newTowerScriptSource(id) {
  return JSON.stringify({
    schemaVersion: 1,
    id,
    label: id.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    enabled: true,
    bindings: [{ scope: "global" }],
    initialState: {},
    handlers: {
      waveStarted: [{ id: "on_wave_started", actions: [{ action: "emitSignal", signal: "wave_started", payload: { $get: "event.waveIndex" } }] }]
    }
  }, null, 2) + "\n";
}

$("script-editor")?.addEventListener("input", () => {
  S.scriptSource = $("script-editor").value;
  markScriptDirty(true);
  validateScriptEditorSource();
  if ($("btn-script-save")) $("btn-script-save").disabled = !validateScriptEditorSource();
});
$("script-editor")?.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  event.preventDefault();
  const editor = event.currentTarget;
  const start = editor.selectionStart;
  editor.setRangeText("  ", start, editor.selectionEnd, "end");
  editor.dispatchEvent(new Event("input", { bubbles: true }));
});
$("btn-script-save")?.addEventListener("click", () => saveActiveScript());
$("btn-script-refresh")?.addEventListener("click", refreshProjectTree);
$("btn-script-new")?.addEventListener("click", async () => {
  if (S.scriptDirty) { toast("Save or discard the current script first.", "warn"); return; }
  const requested = window.prompt("New TowerScript path", "scripts/gameplay/new-rule.tower.json");
  if (!requested) return;
  const path = requested.replaceAll("\\", "/");
  const id = path.split("/").pop()?.replace(/\.tower\.json$/, "").replace(/[^A-Za-z0-9_.-]+/g, "_") || "new_rule";
  S.selectedProjectPath = path;
  S.scriptFileRevision = "missing";
  S.scriptOriginalId = null;
  S.scriptSource = newTowerScriptSource(id);
  SCRIPT_UI.selectedNode = { path, kind: "file", manageable: true, editable: true };
  const editor = $("script-editor");
  editor.disabled = false;
  editor.readOnly = false;
  editor.value = S.scriptSource;
  markScriptDirty(true);
  syncScriptEditorUi();
  editor.focus();
});
$("btn-script-folder")?.addEventListener("click", async () => {
  const path = window.prompt("New folder under scripts/", "scripts/gameplay");
  if (!path) return;
  try {
    const result = await apiPost("/api/project/tree/create-folder", { path, contentHash: S.contentHash });
    S.contentHash = result.newHash;
    await refreshProjectTree();
  } catch (error) { toast(error.message, "err"); }
});
$("btn-script-rename")?.addEventListener("click", async () => {
  const selected = SCRIPT_UI.selectedNode;
  if (!selected?.manageable) return;
  if (S.scriptDirty) { toast("Save or discard the current script first.", "warn"); return; }
  const to = window.prompt("Rename project entry", selected.path);
  if (!to || to === selected.path) return;
  try {
    const result = await apiPost("/api/project/tree/rename", { from: selected.path, to, contentHash: S.contentHash });
    S.contentHash = result.newHash;
    if (S.selectedProjectPath === selected.path) S.selectedProjectPath = to;
    SCRIPT_UI.selectedNode = { ...selected, path: to };
    await refreshProjectTree();
    if (selected.kind === "file") await openProjectTreeFile(to);
  } catch (error) { toast(error.message, "err"); }
});
$("btn-script-delete")?.addEventListener("click", async () => {
  const selected = SCRIPT_UI.selectedNode;
  if (!selected?.manageable) return;
  if (S.scriptDirty) { toast("Save or discard the current script first.", "warn"); return; }
  const confirmed = await confirmDialog({ title: `Delete ${selected.path}?`, message: "A backup will be kept under .towerforge/backups/scripts.", confirmLabel: "Delete", danger: true });
  if (!confirmed) return;
  try {
    const result = await apiPost("/api/project/tree/delete", { path: selected.path, contentHash: S.contentHash });
    S.contentHash = result.newHash;
    if (S.selectedProjectPath === selected.path || S.selectedProjectPath?.startsWith(`${selected.path}/`)) {
      S.selectedProjectPath = null;
      S.scriptSource = "";
      S.scriptFileRevision = null;
      $("script-editor").value = "";
      $("script-editor").disabled = true;
    }
    SCRIPT_UI.selectedNode = null;
    const data = await apiGet("/api/project");
    S.project.scripts = data.scripts;
    S.project.scriptFiles = data.scriptFiles;
    S.contentHash = data.contentHash;
    await refreshProjectTree();
    syncScriptEditorUi();
  } catch (error) { toast(error.message, "err"); }
});

function renderAssetsTab() {
  if (!S.project.visuals) S.project.visuals = { schemaVersion: 2, assetsRoot: "assets", atlases: {}, sprites: {}, tileSets: {}, bindings: { towers: {}, enemies: {}, tiles: {}, tileSets: { grids: {}, maps: {} }, ui: {} }, audio: { sounds: {}, events: {}, musicTracks: {}, musicByMission: {} } };
  const textarea = $("visuals-json");
  if (textarea) {
    textarea.value = JSON.stringify(S.project.visuals, null, 2);
    textarea.onchange = () => {
      try {
        S.project.visuals = JSON.parse(textarea.value);
        markDirty(true);
        renderSoundBindings();
        renderMusicBindings();
        toast("Visual catalog updated.", "ok");
      } catch (e) {
        toast("Invalid visuals JSON: " + e.message, "err");
      }
    };
  }
  bindJsonProjectEditor("story-comics-json", "storyComics", { seenStoragePrefix: "story_seen_", comics: {} }, "Story comics");
  bindJsonProjectEditor("battle-backgrounds-json", "battleBackgrounds", { fallbackMissionId: "", placeholderMissionIds: [], definitions: {} }, "Battle backgrounds");
  void renderThemePacks();
  renderSoundBindings();
  renderMusicBindings();
  renderAtlasFrames();
  bindTilesetWorkbench();
}

let tilesetImportPreview = null;
function numericTilesetField(id) {
  const value = $(id)?.value;
  return value === "" || value === undefined ? undefined : Number(value);
}

async function tilesetImagePayload(file) {
  if (!file) return undefined;
  if (file.type && file.type !== "image/png") throw new Error("Tileset image must be a PNG file.");
  if (!/\.png$/i.test(file.name)) throw new Error("Tileset image filename must end in .png.");
  if (file.size < 1 || file.size > 10 * 1024 * 1024) throw new Error("Tileset PNG must be 10 MB or smaller.");
  return { name: file.name, mimeType: "image/png", data: bytesToBase64(new Uint8Array(await file.arrayBuffer())) };
}

function parseOptionalJsonEditor(id, label) {
  const source = $(id)?.value.trim();
  if (!source) return undefined;
  try { return JSON.parse(source); }
  catch (error) { throw new Error(`${label} JSON is invalid: ${error.message}`); }
}

function tilesetSlicingOptions() {
  const slicing = {
    tileWidth: numericTilesetField("tileset-tile-width"),
    tileHeight: numericTilesetField("tileset-tile-height"),
    columns: numericTilesetField("tileset-columns"),
    margin: numericTilesetField("tileset-margin"),
    spacing: numericTilesetField("tileset-spacing")
  };
  return Object.values(slicing).some((value) => value !== undefined) ? slicing : undefined;
}

function renderTilesetCoverage(preview) {
  const panel = $("tileset-coverage-matrix");
  if (!panel) return;
  const expected = preview.tileSet.ruleKind === "edge" ? (preview.tileSet.topology === "hex" ? 64 : 16)
    : preview.tileSet.ruleKind === "corner" ? 16
      : preview.tileSet.ruleKind === "mixed" || preview.tileSet.ruleKind === "blob" ? 47
        : null;
  const rows = Object.entries(preview.tileSet.materials ?? {}).map(([terrainId, material]) => {
    const signatures = Object.keys(material.signatures ?? {}).length;
    const variants = Object.values(material.signatures ?? {}).reduce((total, entries) => total + (Array.isArray(entries) ? entries.length : 1), 0);
    return `<div class="tileset-coverage-row"><span>${esc(terrainId)} · ${esc(material.connectionSource ?? "neighbors")}</span><span class="tileset-coverage-count">${signatures}${expected ? `/${expected}` : ""} masks · ${variants} variants</span></div>`;
  });
  panel.innerHTML = rows.join("") || `<div class="text-muted">No terrain materials mapped.</div>`;
}

async function renderTilesetSlicingPreview(file, preview) {
  const canvas = $("tileset-slicing-preview");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#101410";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!file) {
    ctx.fillStyle = "#8c968d";
    ctx.font = "13px sans-serif";
    ctx.fillText("Select the matching PNG spritesheet", 18, 30);
    return;
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("Could not decode tileset PNG.")); image.src = url; });
    const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
    const dx = (canvas.width - image.width * scale) / 2;
    const dy = (canvas.height - image.height * scale) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, dx, dy, image.width * scale, image.height * scale);
    const { tileWidth, tileHeight, margin, spacing } = preview.tileSet;
    ctx.strokeStyle = "rgba(255,255,255,.55)";
    ctx.lineWidth = 1;
    for (let tileId = 0; tileId < preview.source.tileCount && tileId < 512; tileId += 1) {
      const q = tileId % preview.source.columns;
      const r = Math.floor(tileId / preview.source.columns);
      ctx.strokeRect(dx + (margin + q * (tileWidth + spacing)) * scale, dy + (margin + r * (tileHeight + spacing)) * scale, tileWidth * scale, tileHeight * scale);
    }
    canvas.title = `${image.width}x${image.height} · ${preview.source.tileCount} tiles`;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function bindTilesetWorkbench() {
  const previewButton = $("btn-preview-tileset");
  const applyButton = $("btn-apply-tileset");
  const report = $("tileset-workbench-report");
  if (!previewButton || !applyButton || !report) return;
  const invalidatePreview = () => {
    if (!tilesetImportPreview) return;
    tilesetImportPreview = null;
    applyButton.disabled = true;
    report.textContent = "Workbench changed. Preview again before applying.";
  };
  for (const id of ["tileset-descriptor", "tileset-image", "tileset-topology", "tileset-id", "tileset-tile-width", "tileset-tile-height", "tileset-columns", "tileset-margin", "tileset-spacing", "tileset-materials", "tileset-terrain-types"]) {
    const control = $(id);
    if (control) control.oninput = invalidatePreview;
  }
  previewButton.onclick = async () => {
    const file = $("tileset-descriptor")?.files?.[0];
    if (!file) { toast("Choose a TSJ or TSX descriptor.", "warn"); return; }
    try {
      const descriptor = await file.text();
      const imageFile = $("tileset-image")?.files?.[0];
      const request = {
        descriptor,
        sourceName: file.name,
        tileSetId: $("tileset-id")?.value.trim() || undefined,
        topology: $("tileset-topology")?.value,
        slicing: tilesetSlicingOptions(),
        materialOverrides: parseOptionalJsonEditor("tileset-materials", "Materials"),
        terrainTypeOverrides: parseOptionalJsonEditor("tileset-terrain-types", "Terrain properties"),
        image: await tilesetImagePayload(imageFile)
      };
      const result = await apiPost("/api/tilesets/preview", request);
      tilesetImportPreview = { ...result.preview, revision: result.revision, request };
      $("tileset-tile-width").value = result.preview.tileSet.tileWidth;
      $("tileset-tile-height").value = result.preview.tileSet.tileHeight;
      $("tileset-columns").value = result.preview.source.columns;
      $("tileset-margin").value = result.preview.tileSet.margin;
      $("tileset-spacing").value = result.preview.tileSet.spacing;
      $("tileset-materials").value = JSON.stringify(result.preview.tileSet.materials, null, 2);
      $("tileset-terrain-types").value = JSON.stringify(result.preview.terrainTypes, null, 2);
      const materialCount = Object.keys(result.preview.tileSet.materials ?? {}).length;
      report.innerHTML = `<strong>${esc(result.preview.tileSet.id)}</strong> · ${esc(result.preview.tileSet.ruleKind)} · ${Object.keys(result.preview.sprites ?? {}).length} frames · ${materialCount} terrain material(s) · ${result.preview.source.expectedWidth}x${result.preview.source.expectedHeight}px minimum${result.preview.warnings?.length ? `<br>${result.preview.warnings.map(esc).join("<br>")}` : ""}`;
      renderTilesetCoverage(result.preview);
      await renderTilesetSlicingPreview(imageFile, result.preview);
      applyButton.disabled = false;
    } catch (error) {
      tilesetImportPreview = null;
      applyButton.disabled = true;
      report.textContent = error.message;
      toast(`Tileset preview failed: ${error.message}`, "err");
    }
  };
  applyButton.onclick = async () => {
    if (!tilesetImportPreview) return;
    try {
      const request = {
        ...tilesetImportPreview.request,
        slicing: tilesetSlicingOptions(),
        materialOverrides: parseOptionalJsonEditor("tileset-materials", "Materials"),
        terrainTypeOverrides: parseOptionalJsonEditor("tileset-terrain-types", "Terrain properties")
      };
      const result = await apiPost("/api/tilesets/apply", {
        ...request,
        tileSetId: tilesetImportPreview.tileSet.id,
        ifRevision: tilesetImportPreview.revision
      });
      toast(`Tileset "${result.tileSetId}" imported.`, "ok");
      tilesetImportPreview = null;
      await load();
    } catch (error) { toast(`Tileset import failed: ${error.message}`, "err"); }
  };
}

let themePacksCache = null;
async function renderThemePacks() {
  const panel = $("theme-packs-panel");
  if (!panel) return;
  panel.innerHTML = `<div class="text-muted" style="font-size:11px">Loading theme packs...</div>`;
  try {
    themePacksCache ??= (await apiGet("/api/theme-packs")).packs ?? [];
    const currentId = S.project?.visuals?.theme?.id;
    panel.innerHTML = themePacksCache.map(pack => {
      const colors = Object.values(pack.theme?.renderer ?? {}).slice(0, 6);
      const active = currentId === pack.id;
      return `<article class="theme-pack-card${active ? " active" : ""}">
        <img class="theme-pack-preview" src="${esc(pack.previewUrl)}" alt="${esc(pack.label)} battlefield preview">
        <div class="theme-pack-body">
          <div><div class="theme-pack-title">${esc(pack.label)}</div><div class="theme-pack-swatches" aria-hidden="true">${colors.map(color => `<span class="theme-pack-swatch" style="background:${esc(color)}"></span>`).join("")}</div></div>
          <button class="btn ${active ? "btn-outline" : "btn-primary"} theme-pack-apply" type="button" data-pack-id="${esc(pack.id)}" ${active ? "disabled" : ""}>${active ? "Applied" : "Preview & Apply"}</button>
          <p class="theme-pack-description">${esc(pack.description)}</p>
        </div>
      </article>`;
    }).join("") || `<div class="text-muted">No bundled theme packs found.</div>`;
    panel.querySelectorAll(".theme-pack-apply").forEach(button => button.addEventListener("click", () => applyThemePackFromStudio(button.dataset.packId)));
  } catch (error) {
    panel.innerHTML = `<div class="text-muted">Theme packs unavailable: ${esc(error.message)}</div>`;
  }
}

async function applyThemePackFromStudio(packId) {
  if (S.dirty) {
    toast("Save current edits before applying a theme pack.", "warn");
    return;
  }
  const pack = themePacksCache?.find(item => item.id === packId);
  try {
    const preview = await apiPost("/api/theme-packs/apply", { packId, dryRun: true });
    const ok = await confirmDialog({
      title: `Apply ${pack?.label ?? packId}?`,
      message: `This will update the renderer palette and battle background for ${preview.changes.missionIds.length} mission(s). A local backup is created before validation.`,
      confirmLabel: "Apply theme",
      danger: false
    });
    if (!ok) return;
    const result = await apiPost("/api/theme-packs/apply", { packId, ifRevision: preview.revision });
    if (!result.ok) throw new Error(result.error || "Theme pack could not be applied.");
    recordActivity("Theme applied", "ok", pack?.label ?? packId);
    toast(`${pack?.label ?? packId} applied.`, "ok");
    await load();
  } catch (error) {
    recordActivity("Theme apply", "error", error.message);
    toast(`Theme apply failed: ${error.message}`, "err");
  }
}

function bindJsonProjectEditor(elementId, projectKey, fallback, label) {
  const textarea = $(elementId);
  if (!textarea) return;
  S.project[projectKey] ??= deep(fallback);
  textarea.value = JSON.stringify(S.project[projectKey], null, 2);
  textarea.onchange = () => {
    try {
      S.project[projectKey] = JSON.parse(textarea.value);
      markDirty(true);
      toast(`${label} updated.`, "ok");
    } catch (error) {
      toast(`Invalid ${label.toLowerCase()} JSON: ${error.message}`, "err");
    }
  };
}

const afImages = new Map();
function afAtlasUrl(src) {
  return "/project-file/" + String(src).split("/").map(encodeURIComponent).join("/");
}
function afLoadImage(src, onload) {
  let img = afImages.get(src);
  if (!img) {
    img = new Image();
    img.addEventListener("load", onload);
    img.src = afAtlasUrl(src);
    afImages.set(src, img);
  }
  // The caller re-checks img.complete after this returns and draws when ready, so a
  // cached-complete image needs no synchronous onload() — that would recurse into the caller.
  return img;
}
function renderAtlasFrames() {
  const panel = $("atlas-frames-panel");
  if (!panel || !S.project.visuals) return;
  const v = S.project.visuals;
  v.atlases ??= {};
  v.sprites ??= {};
  const atlasIds = Object.keys(v.atlases).filter(id => typeof v.atlases[id]?.src === "string");
  const frameSprites = Object.entries(v.sprites).filter(([, s]) => s && typeof s === "object" && s.atlas);
  if (!atlasIds.length) {
    panel.innerHTML = `<p class="text-dim" style="font-size:11px;margin:0">Import an atlas image above (Kind = atlas) to slice frames from it.</p>`;
    return;
  }
  panel.innerHTML = `
    <div class="form-row">
      <div class="field"><label>Atlas</label><select id="af-atlas">${atlasIds.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("")}</select></div>
      <div class="field"><label>New sprite ID</label><input id="af-id" class="mono" placeholder="hero_idle"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>X</label><input id="af-x" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>Y</label><input id="af-y" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>W</label><input id="af-w" type="number" min="1" step="1" value="32"></div>
      <div class="field"><label>H</label><input id="af-h" type="number" min="1" step="1" value="32"></div>
    </div>
    <div style="display:flex;gap:12px;align-items:center;margin:6px 0 4px">
      <canvas id="af-preview" width="72" height="72" style="border:1px solid var(--border);border-radius:4px;background:#0002;image-rendering:pixelated"></canvas>
      <span id="af-dims" class="text-muted mono" style="font-size:11px"></span>
      <button id="af-add" class="btn btn-primary" style="margin-left:auto">Add frame sprite</button>
    </div>
    ${frameSprites.length ? `<div class="form-section-title" style="margin-top:8px">Frame sprites</div>` + frameSprites.map(([id, s]) =>
      `<div class="snd-row"><span class="snd-label mono">${esc(id)}</span><span class="text-muted mono" style="font-size:11px">${esc(s.atlas)} @ ${esc(s.frame?.x ?? "?")},${esc(s.frame?.y ?? "?")} · ${esc(s.frame?.w ?? "?")}×${esc(s.frame?.h ?? "?")}</span><button class="btn-icon af-del" data-id="${esc(id)}" title="Remove frame sprite" aria-label="Remove frame sprite">${ICO.trash}</button></div>`
    ).join("") : ""}
  `;

  const num = (id, min) => { const n = Math.floor(Number($(id).value)); return Number.isFinite(n) ? Math.max(min, n) : min; };
  const drawPreview = () => {
    const canvas = $("af-preview");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const atlas = v.atlases[$("af-atlas").value];
    const x = num("af-x", 0), y = num("af-y", 0), w = num("af-w", 1), h = num("af-h", 1);
    $("af-dims").textContent = `${w}×${h}`;
    if (!atlas?.src) return;
    const img = afLoadImage(atlas.src, drawPreview);
    if (!img.complete || !img.naturalWidth) return;
    const scale = Math.min(canvas.width / w, canvas.height / h, 4);
    const dw = w * scale, dh = h * scale;
    ctx.imageSmoothingEnabled = false;
    try {
      ctx.drawImage(img, x, y, w, h, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
    } catch { /* out-of-bounds frame — leave blank */ }
  };
  ["af-atlas", "af-x", "af-y", "af-w", "af-h"].forEach(id => $(id).addEventListener("input", drawPreview));
  drawPreview();

  $("af-add").addEventListener("click", () => {
    const id = $("af-id").value.trim();
    if (!id) { toast("Enter a sprite ID.", "warn"); return; }
    if (!/^[a-zA-Z0-9_.-]+$/.test(id)) { toast("Sprite ID may use letters, digits, _ . - only.", "warn"); return; }
    if (v.sprites[id]) { toast(`Sprite "${id}" already exists.`, "warn"); return; }
    v.sprites[id] = { atlas: $("af-atlas").value, frame: { x: num("af-x", 0), y: num("af-y", 0), w: num("af-w", 1), h: num("af-h", 1) } };
    markDirty(true);
    toast(`Added frame sprite "${id}".`, "ok");
    renderAssetsTab();
  });

  panel.querySelectorAll(".af-del").forEach(btn => btn.addEventListener("click", () => {
    const id = btn.dataset.id;
    delete v.sprites[id];
    markDirty(true);
    renderAssetsTab();
  }));
}

let assetsAudio = null;
let assetsMusicPreviewId = null;
const ICO_PLAY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>`;
const ICO_STOP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>`;
function renderSoundBindings() {
  const box = $("sound-bindings");
  if (!box || !S.project.visuals) return;
  S.project.visuals.audio ??= { sounds: {}, events: {} };
  const audio = S.project.visuals.audio;
  audio.sounds ??= {};
  audio.events ??= {};
  const soundIds = Object.keys(audio.sounds);
  box.innerHTML = AUDIO_EVENTS.map(ev => {
    const cur = audio.events[ev.id] || "";
    const opts = `<option value="">— synth default —</option>` +
      soundIds.map(sid => `<option value="${esc(sid)}"${sid === cur ? " selected" : ""}>${esc(sid)}</option>`).join("");
    const hasCustom = cur && audio.sounds[cur]?.src;
    return `<div class="snd-row">
      <span class="snd-label">${esc(ev.label)}</span>
      <select class="snd-bind" data-ev="${esc(ev.id)}" aria-label="${esc(ev.label)} sound">${opts}</select>
      <button class="btn-icon snd-preview" data-ev="${esc(ev.id)}" title="Preview sound"${hasCustom ? "" : " disabled"}>${ICO_PLAY}</button>
    </div>`;
  }).join("") + (soundIds.length ? "" : `<p class="text-dim" style="font-size:11px;margin-top:6px">No sounds imported yet — import an audio file with Kind = sound to assign it.</p>`);

  box.querySelectorAll(".snd-bind").forEach(sel => sel.addEventListener("change", () => {
    if (sel.value) audio.events[sel.dataset.ev] = sel.value; else delete audio.events[sel.dataset.ev];
    markDirty(true);
    renderSoundBindings();
  }));
  box.querySelectorAll(".snd-preview").forEach(btn => btn.addEventListener("click", async () => {
    const src = audio.sounds[audio.events[btn.dataset.ev]]?.src;
    if (!src) return;
    if (!assetsAudio) { try { const m = await import("/renderer/audio.mjs"); assetsAudio = m.createAudioPlayer({ assetBase: "/project-file/" }); } catch { return; } }
    assetsAudio.previewSound(src);
  }));
}

function renderMusicBindings() {
  const box = $("music-bindings");
  if (!box || !S.project.visuals) return;
  S.project.visuals.audio ??= {};
  const audio = S.project.visuals.audio;
  audio.musicTracks ??= {};
  audio.musicByMission ??= {};
  const trackIds = Object.keys(audio.musicTracks);
  const missions = Object.values(S.project.missions ?? {});
  if (!trackIds.length) {
    box.innerHTML = `<p class="text-dim" style="font-size:11px;margin:0">No music imported yet. Choose Kind = music above.</p>`;
    return;
  }
  box.innerHTML = missions.map((mission) => {
    const current = audio.musicByMission[mission.id] || "";
    const options = `<option value="">No music</option>` + trackIds.map((trackId) => `<option value="${esc(trackId)}"${current === trackId ? " selected" : ""}>${esc(trackId)}</option>`).join("");
    const previewing = current && current === assetsMusicPreviewId;
    return `<div class="snd-row"><span class="snd-label">${esc(mission.label || mission.id)}</span><select class="music-bind" data-mission="${esc(mission.id)}">${options}</select><button class="btn-icon music-preview" data-mission="${esc(mission.id)}" title="${previewing ? "Stop music preview" : "Preview music"}" aria-pressed="${previewing ? "true" : "false"}"${current ? "" : " disabled"}>${previewing ? ICO_STOP : ICO_PLAY}</button></div>`;
  }).join("");
  box.querySelectorAll(".music-bind").forEach((select) => select.addEventListener("change", () => {
    if (assetsMusicPreviewId && assetsAudio) {
      assetsAudio.selectMusic("");
      assetsMusicPreviewId = null;
    }
    if (select.value) audio.musicByMission[select.dataset.mission] = select.value;
    else delete audio.musicByMission[select.dataset.mission];
    markDirty(true);
    renderMusicBindings();
  }));
  box.querySelectorAll(".music-preview").forEach((button) => button.addEventListener("click", async () => {
    const trackId = audio.musicByMission[button.dataset.mission];
    if (!audio.musicTracks[trackId]?.src) return;
    if (!assetsAudio) { try { const module = await import("/renderer/audio.mjs"); assetsAudio = module.createAudioPlayer({ assetBase: "/project-file/" }); } catch { return; } }
    assetsAudio.setCatalog(audio, "/project-file/");
    assetsMusicPreviewId = assetsMusicPreviewId === trackId ? null : trackId;
    assetsAudio.resume();
    assetsAudio.selectMusic(assetsMusicPreviewId || "");
    renderMusicBindings();
  }));
}

$("btn-import-asset")?.addEventListener("click", async () => {
  if (S.dirty) {
    toast("Save changes before importing assets.", "warn");
    return;
  }
  try {
    const result = await apiPost("/api/assets/import", {
      sourcePath: $("asset-source-path").value.trim(),
      targetPath: $("asset-target-path").value.trim(),
      id: $("asset-id").value.trim(),
      kind: $("asset-kind").value
    });
    S.project.visuals = result.visuals;
    S.contentHash = result.newHash;
    renderAssetsTab();
    toast(`Imported ${result.asset.id}.`, "ok");
  } catch (e) {
    toast("Asset import failed: " + e.message, "err");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS / CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
function renderSettingsTab() {
  const c = S.project.constants ?? {};
  renderCurrenciesPanel();
  const addCur = $("btn-add-currency");
  if (addCur) addCur.onclick = () => {
    const list = (S.project.currencies = projCurrencies());
    let n = list.length, id = `currency_${n}`;
    while (list.some(x => x.id === id)) id = `currency_${++n}`;
    list.push({ id, label: "New Currency", color: 0x8db0ff });
    markDirty(true); renderCurrenciesPanel();
  };
  const FIELDS = [
    ["timeUnitSeconds",            "Time Unit (seconds)",            0.001],
    ["startingCoreHp",             "Starting Core HP (default)",     1    ],
    ["startingCoins",              "Starting Coins (default)",       1    ],
    ["prepTimeUnits",              "Prep Time Units (default)",      1    ],
    ["moveTowerCost",              "(see JSON — object)",            null ],
    ["waterGroundSpeedFactor",     "Water Ground Speed Factor",      0.01 ],
    ["pathWaterCooldownUnits",     "PathWater Cooldown (units)",     1    ],
    ["pathWaterDurationUnits",     "PathWater Duration (units)",     0.1  ],
    ["pathWaterRadius",            "PathWater Radius (hex)",         0.5  ],
    ["pathWaterGroundSpeedFactor", "PathWater Speed Factor",         0.01 ],
  ];

  const table = $("constants-table");
  if (table) {
    table.innerHTML = FIELDS.map(([key, label, step]) => {
      if (step === null) return `<tr><td>${esc(key)}</td><td class="text-muted" style="font-size:11px">Object — edit JSON directly</td></tr>`;
      const val = typeof c[key] === "number" ? c[key] : "";
      return `<tr>
        <td>${esc(key)}</td>
        <td><input type="number" step="${step}" data-ckey="${esc(key)}" value="${val}" style="width:120px"></td>
        <td class="text-muted" style="font-size:11px">${esc(label)}</td>
      </tr>`;
    }).join("");

    table.querySelectorAll("[data-ckey]").forEach(inp => {
      inp.addEventListener("change", () => {
        if (!S.project.constants) S.project.constants = {};
        S.project.constants[inp.dataset.ckey] = parseFloat(inp.value) || 0;
        markDirty(true);
      });
    });
  }

  // Project manifest fields
  const nameInp = $("setting-project-name");
  const defInp  = $("setting-default-mission");
  const descInp = $("setting-project-desc");
  if (nameInp) {
    nameInp.value = S.project.manifest?.name ?? "";
    nameInp.addEventListener("change", () => {
      if (!S.project.manifest) S.project.manifest = {};
      S.project.manifest.name = nameInp.value;
      $("project-name").textContent = nameInp.value;
      markDirty(true);
    });
  }
  if (defInp) {
    defInp.value = S.project.defaultMissionId ?? "";
    defInp.addEventListener("change", () => {
      S.project.defaultMissionId = defInp.value.trim();
      markDirty(true);
    });
  }
  if (descInp) {
    descInp.value = S.project.manifest?.description ?? "";
    descInp.addEventListener("change", () => {
      if (!S.project.manifest) S.project.manifest = {};
      S.project.manifest.description = descInp.value;
      markDirty(true);
    });
  }

  setupAppearanceSettings();
  setupProgressionSettings();
  setupAiSettings();
  setupMcpSettings();
}

function setupProgressionSettings() {
  const difficultyInput = $("setting-difficulties-json");
  const metaInput = $("setting-meta-json");
  const defaultSelect = $("setting-default-difficulty");
  const difficultyStatus = $("setting-difficulties-status");
  const metaStatus = $("setting-meta-status");
  const ensureDifficulties = () => {
    if (!Array.isArray(S.project.difficulties) || !S.project.difficulties.length) S.project.difficulties = [{ id: "normal", label: "Normal" }];
    if (!S.project.defaultDifficultyId || !S.project.difficulties.some((item) => item.id === S.project.defaultDifficultyId)) S.project.defaultDifficultyId = S.project.difficulties[0].id;
  };
  const renderDefault = () => {
    ensureDifficulties();
    if (!defaultSelect) return;
    defaultSelect.innerHTML = S.project.difficulties.map((item) => `<option value="${esc(item.id)}">${esc(item.label || item.id)}</option>`).join("");
    defaultSelect.value = S.project.defaultDifficultyId;
  };
  ensureDifficulties();
  S.project.metaProgression ??= { currencies: [], upgrades: {}, rewardsByMission: {} };
  if (difficultyInput) difficultyInput.value = JSON.stringify(S.project.difficulties, null, 2);
  if (metaInput) metaInput.value = JSON.stringify(S.project.metaProgression, null, 2);
  renderDefault();
  if (defaultSelect) defaultSelect.onchange = () => { S.project.defaultDifficultyId = defaultSelect.value; markDirty(true); };
  if (difficultyInput) difficultyInput.onchange = () => {
    try {
      const value = JSON.parse(difficultyInput.value);
      if (!Array.isArray(value) || !value.length || value.some((item) => !item || typeof item.id !== "string" || !item.id.trim())) throw new Error("Use a non-empty array; every profile needs an id.");
      S.project.difficulties = value;
      ensureDifficulties();
      renderDefault();
      difficultyStatus.textContent = `${value.length} profiles ready`;
      markDirty(true);
    } catch (error) { difficultyStatus.textContent = error.message; difficultyInput.focus(); }
  };
  if (metaInput) metaInput.onchange = () => {
    try {
      const value = JSON.parse(metaInput.value);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Meta progression must be an object.");
      value.currencies ??= [];
      value.upgrades ??= {};
      value.rewardsByMission ??= {};
      S.project.metaProgression = value;
      metaStatus.textContent = `${Object.keys(value.upgrades).length} upgrades ready`;
      markDirty(true);
    } catch (error) { metaStatus.textContent = error.message; metaInput.focus(); }
  };
}

function setupAppearanceSettings() {
  const languageSel = $("setting-language"), themeSel = $("setting-theme"), densitySel = $("setting-density");
  if (languageSel) {
    languageSel.innerHTML = LANGUAGES.map(({ id, label }) => `<option value="${id}">${label}</option>`).join("");
    languageSel.value = getLanguage();
    languageSel.onchange = () => setLanguage(languageSel.value);
  }
  if (themeSel) { themeSel.value = currentTheme(); themeSel.onchange = () => applyTheme(themeSel.value); }
  if (densitySel) { densitySel.value = localStorage.getItem("towerforge:density") || "comfortable"; densitySel.onchange = () => applyDensity(densitySel.value); }
}

function setupAiSettings() {
  ensureAiInitialized();
  const connections = $("ai-connections-list");
  if (connections) connections.onclick = async (event) => {
    const connect = event.target.closest?.("[data-ai-connect]");
    if (connect) {
      connect.disabled = true;
      await aiRuntimeConnect(connect.dataset.aiConnect);
      return;
    }
    const disconnect = event.target.closest?.("[data-ai-disconnect]");
    if (disconnect) {
      disconnect.disabled = true;
      await aiRuntimeDisconnect(disconnect.dataset.aiDisconnect);
      return;
    }
    const saveKey = event.target.closest?.("[data-ai-save-key]");
    if (saveKey) {
      const provider = saveKey.dataset.aiSaveKey;
      const input = connections.querySelector(`[data-ai-key-input="${CSS.escape(provider)}"]`);
      const value = input?.value.trim() || "";
      if (!value) {
        toast(`Enter a ${aiProviderInfo(provider).keyLabel}.`, "warn");
        input?.focus();
        return;
      }
      if (input) input.value = "";
      aiSetKey(provider, value);
      setAiProvider(provider, { announce: false });
      updateAiUi();
      toast(`${aiProviderInfo(provider).label} key saved on this device.`, "ok");
      return;
    }
    const removeKey = event.target.closest?.("[data-ai-remove-key]");
    if (removeKey) await removeAiKey(removeKey.dataset.aiRemoveKey);
  };

  const provider = $("setting-ai-provider");
  if (provider) provider.onchange = () => setAiProvider(provider.value);
  const model = $("setting-ai-model");
  if (model) model.onchange = () => {
    if (!model.value) return;
    aiSetStoredModel(aiProvider(), model.value);
    renderAiModelOptions(aiProvider());
    updateAiUi();
  };
  const reasoning = $("setting-ai-reasoning");
  if (reasoning) reasoning.onchange = () => {
    aiSetStoredReasoning(aiProvider(), reasoning.value);
    renderAiReasoningOptions(aiProvider());
  };
  if ($("setting-ai-add-model")) $("setting-ai-add-model").onclick = saveAiCustomModel;
  if ($("setting-ai-open-chat")) $("setting-ai-open-chat").onclick = () => setAiDockOpen(true);

  Promise.all([
    loadAiRuntimeStatus("codex"),
    loadAiRuntimeStatus("claude-code")
  ]).then(updateAiUi);
}

// ── MCP integration toggle ──────────────────────────────────────────────────
async function setupMcpSettings() {
  const cb     = $("mcp-enabled");
  const hint   = $("mcp-hint");
  const cfgBox = $("mcp-config");
  const pathEl = $("mcp-path");
  const copyBtn = $("btn-copy-mcp");
  const clientSel = $("mcp-client");
  const clientHow = $("mcp-client-how");
  const connectBtn = $("btn-connect-mcp");
  if (!cb) return;

  let clients = [];
  const currentClient = () => clients.find((c) => c.id === clientSel?.value) ?? clients[0];

  // Show the selected client's ready-made snippet (Claude Code / Codex / Claude Desktop / Cursor /
  // VS Code), its target file, and — for project-scoped clients — a one-click write button.
  const renderClient = () => {
    const client = currentClient();
    if (!client) return;
    if (cfgBox) cfgBox.value = client.snippet;
    if (pathEl) pathEl.textContent = client.file;
    if (clientHow) clientHow.textContent = client.how;
    if (connectBtn) {
      connectBtn.hidden = !client.writable;
      connectBtn.textContent = `Write ${client.file} into project`;
    }
  };

  const apply = (state) => {
    cb.checked = !!state.enabled;
    if (Array.isArray(state.clients) && state.clients.length) {
      clients = state.clients;
      if (clientSel && clientSel.options.length !== clients.length) {
        clientSel.innerHTML = clients.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join("");
      }
      renderClient();
    } else if (cfgBox) {
      cfgBox.value = JSON.stringify(state.config ?? {}, null, 2);
      if (pathEl) pathEl.textContent = state.mcpJsonPath ?? ".mcp.json";
    }
    if (hint) {
      hint.textContent = state.parseError
        ? `⚠ ${state.mcpJsonPath} exists but is not valid JSON. Fix or remove it before toggling MCP.`
        : state.enabled
          ? `Active — agents that read ${state.mcpJsonPath} can now call the constructor tools.`
          : "Disabled — turn on to expose the constructor tools to AI agents.";
    }
    if (cb) cb.disabled = !!state.parseError;
  };

  if (clientSel) clientSel.onchange = renderClient;
  if (connectBtn) {
    connectBtn.onclick = async () => {
      const client = currentClient();
      if (!client) return;
      connectBtn.disabled = true;
      try {
        const result = await apiPost("/api/mcp/connect-client", { clientId: client.id });
        toast(`Wrote ${result.filePath} — ${client.label} will pick it up on next launch.`, "ok");
        if (result.state) apply(result.state); // .mcp.json write flips the enable toggle too
      } catch (e) {
        toast("Connect failed: " + e.message, "err");
      } finally {
        connectBtn.disabled = false;
      }
    };
  }

  try {
    apply(await apiGet("/api/mcp"));
  } catch (e) {
    if (hint) hint.textContent = "Could not read MCP status: " + e.message;
  }

  cb.onchange = async () => {
    cb.disabled = true;
    try {
      const state = await apiPost("/api/mcp", { enabled: cb.checked });
      apply(state);
      toast(state.enabled ? "MCP server enabled for AI agents." : "MCP server disabled.", "ok");
    } catch (e) {
      toast("MCP toggle failed: " + e.message, "err");
      try { apply(await apiGet("/api/mcp")); } catch { /* ignore */ }
    } finally {
      cb.disabled = false;
    }
  };

  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(cfgBox?.value ?? "");
        toast("MCP config copied.", "ok");
      } catch {
        toast("Copy failed — select the text manually.", "warn");
      }
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD TARGETS
// ─────────────────────────────────────────────────────────────────────────────
function renderBuildTargetsTab() {
  const bt   = S.project.buildTargets ?? { schemaVersion: 1, targets: {} };
  const body = $("buildtargets-body");
  if (!body) return;
  body.innerHTML = "";

  for (const [tid, target] of Object.entries(bt.targets ?? {})) {
    const card = document.createElement("div");
    card.className = "target-card";
    card.innerHTML = `
      <div class="target-card-head">
        <div class="target-card-title">${esc(tid)}</div>
        <span class="badge ${target.platform === "web" ? "badge-ok" : "badge-dim"}">${esc(target.platform ?? "?")}</span>
        <button class="btn btn-outline btn-target-build" data-tid="${esc(tid)}">Build</button>
        <button class="btn btn-outline btn-target-package" data-tid="${esc(tid)}" data-kind="mobile" title="Wrap the web build into a Capacitor mobile app (Android/iOS)">Package mobile</button>
        <button class="btn btn-outline btn-target-package" data-tid="${esc(tid)}" data-kind="desktop" title="Wrap the web build into a Tauri desktop app (Windows/macOS/Linux)">Package desktop</button>
        <button class="btn btn-danger btn-target-del" data-tid="${esc(tid)}">Remove</button>
      </div>
      <div class="form-row">
        <div class="field"><label>Target ID</label><input class="bt-field" data-tid="${esc(tid)}" data-f="id" value="${esc(tid)}"></div>
        <div class="field"><label>Platform</label>
          <select class="bt-field" data-tid="${esc(tid)}" data-f="platform">
            <option value="web"${target.platform==="web"?" selected":""}>web</option>
            <option value="android"${target.platform==="android"?" selected":""}>android</option>
            <option value="ios"${target.platform==="ios"?" selected":""}>ios</option>
          </select>
        </div>
        <div class="field"><label>Renderer${helpIcon("canvas = lightweight zero-dependency player. phaser = vendored Phaser 3 engine (~1.1MB, still offline-capable).")}</label>
          <select class="bt-field" data-tid="${esc(tid)}" data-f="renderer">
            <option value="canvas"${(target.renderer??"canvas")==="canvas"?" selected":""}>canvas (light)</option>
            <option value="phaser"${target.renderer==="phaser"?" selected":""}>phaser</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="field"><label>Market</label><input class="bt-field" data-tid="${esc(tid)}" data-f="market" value="${esc(target.market??"")}"></div>
      </div>
      <div class="form-row">
        ${["appId","appName","appTitle","storeChannel"].map(f => `
          <div class="field"><label>${f}</label><input class="bt-field" data-tid="${esc(tid)}" data-f="${f}" value="${esc(target[f]??"")}"></div>`).join("")}
      </div>
      <div class="form-row">
        ${["webDir","backgroundColor","appVersion"].map(f => `
          <div class="field"><label>${f}</label><input class="bt-field" data-tid="${esc(tid)}" data-f="${f}" value="${esc(target[f]??"")}"></div>`).join("")}
      </div>`;
    body.appendChild(card);
  }

  body.querySelectorAll(".bt-field").forEach(inp => {
    inp.addEventListener("change", () => {
      const tid = inp.dataset.tid;
      const f   = inp.dataset.f;
      const t   = bt.targets[tid];
      if (!t) return;
      if (f === "id") {
        // Rename key
        const newId = inp.value.trim();
        if (newId && newId !== tid) {
          bt.targets[newId] = { ...t, id: newId };
          delete bt.targets[tid];
        }
      } else { t[f] = inp.value; }
      markDirty(true);
    });
  });

  body.querySelectorAll(".btn-target-del").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!(await confirmDialog({ title: `Remove build target "${btn.dataset.tid}"?`, message: "This build target configuration will be removed." }))) return;
      delete bt.targets[btn.dataset.tid];
      markDirty(true); renderBuildTargetsTab();
    });
  });

  body.querySelectorAll(".btn-target-build").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (S.dirty) {
        toast("Save changes before building.", "warn");
        return;
      }
      const tid = btn.dataset.tid;
      setStatus(`Building ${tid}…`);
      await withButtonSpinner(btn, async () => {
        try {
          const result = await apiPost(`/api/build/${encodeURIComponent(tid)}`, {});
          toast("Build complete.", "ok");
          setStatus("Build complete");
          showBuildResult(tid, result.output, result.previewUrl);
        } catch (e) {
          toast("Build failed: " + e.message, "err");
          setStatus("Build failed");
        }
      });
    });
  });

  document.querySelectorAll(".btn-target-package").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (S.dirty) { toast("Save changes before packaging.", "warn"); return; }
      const tid = btn.dataset.tid;
      const kind = btn.dataset.kind === "desktop" ? "desktop" : "mobile";
      const tool = kind === "desktop" ? "Tauri desktop" : "Capacitor mobile";
      setStatus(`Packaging ${tid} for ${kind}…`);
      await withButtonSpinner(btn, async () => {
        try {
          const result = await apiPost(`/api/package/${encodeURIComponent(tid)}`, { kind });
          toast(`${kind === "desktop" ? "Desktop" : "Mobile"} project ready → ${result.outDir?.split("/").pop() || kind}/`, "ok");
          setStatus(`${kind} package ready`);
          showBuildResult(tid, `${tool} project → ${result.outDir}\nApp id: ${result.app?.appId}  version ${result.app?.version}\n\nNext:\n  ${(result.nextSteps || []).join("\n  ")}\n\nSee ${kind}/README.md for the full checklist.`);
        } catch (e) {
          toast("Packaging failed: " + e.message, "err");
          setStatus("Packaging failed");
        }
      });
    });
  });

  const addBtn = $("btn-add-target");
  if (addBtn) {
    addBtn.onclick = () => {
      const id = "target_" + Math.random().toString(36).slice(-6);
      bt.targets[id] = { id, platform: "web", market: "pwa", storeChannel: "pwa", appId: "com.example.game", appName: "My Game", appTitle: "My Game", webDir: "dist", backgroundColor: "#111111", appVersion: "0.1.0" };
      if (!S.project.buildTargets) S.project.buildTargets = bt;
      markDirty(true); renderBuildTargetsTab();
    };
  }
}

function showBuildResult(targetId, output, previewUrl = null) {
  const overlay = $("validation-overlay");
  const div     = $("validation-results");
  const title   = $("val-title");
  const icon    = $("val-icon");
  if (!overlay || !div) return;
  title.textContent = `Build: ${targetId}`;
  icon.innerHTML = ICO.check;
  div.innerHTML = `<div class="val-item ok">${ICO.check}<span>Build completed.</span></div>
    <pre class="build-output">${esc(output || "No build output.")}</pre>
    ${previewUrl ? `<div class="validation-actions"><button id="build-open-preview" class="btn btn-primary" type="button">Open preview</button></div>` : ""}`;
  $("build-open-preview")?.addEventListener("click", () => {
    overlay.classList.add("hidden");
    $("build-preview-title").textContent = `Preview: ${targetId}`;
    $("build-preview-frame").src = `${previewUrl}${previewUrl.includes("?") ? "&" : "?"}build=${Date.now()}`;
    $("build-preview-overlay").classList.remove("hidden");
  });
  overlay.classList.remove("hidden");
}

function closeBuildPreview() {
  $("build-preview-overlay")?.classList.add("hidden");
  const frame = $("build-preview-frame");
  if (frame) frame.src = "about:blank";
}
$("build-preview-close")?.addEventListener("click", closeBuildPreview);
$("build-preview-overlay")?.addEventListener("click", (event) => { if (event.target === $("build-preview-overlay")) closeBuildPreview(); });

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATE / SIM
// ─────────────────────────────────────────────────────────────────────────────
async function validateProject() {
  setStatus("Validating…");
  showOverlayLoading("validation-overlay", "validation-results", "Running full validation…", "val-title", "Validating");
  try {
    const result = await apiGet("/api/validate");
    S.serverValidation = result;
    showValidation(result);
    const ec = result.issues.filter(i => i.severity === "error").length;
    const wc = result.issues.filter(i => i.severity === "warning").length;
    recordActivity("Project validation", ec ? "error" : wc ? "warning" : "ok", `${ec} errors, ${wc} warnings`);
    renderWorkbench();
    setStatus(ec === 0 ? "Validation: OK" : `Validation: ${ec} error(s)`);
  } catch (e) {
    recordActivity("Project validation", "error", e.message);
    toast("Validation error: " + e.message, "err");
    setStatus("Validation error");
  }
}
$("btn-validate")?.addEventListener("click", () => runStudioCommand("project.validate"));

function showValidation(result) {
  const errors   = result.issues.filter(i => i.severity === "error");
  const warnings = result.issues.filter(i => i.severity === "warning");
  const overlay  = $("validation-overlay");
  const div      = $("validation-results");
  const title    = $("val-title");
  const icon     = $("val-icon");

  if (!overlay || !div) return;
  div.className = "overlay-body";
  title.textContent = result.ok
    ? "Validation Passed"
    : `${errors.length} error(s), ${warnings.length} warning(s)`;
  icon.innerHTML = result.ok
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--ok)"><polyline points="20 6 9 17 4 12"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="color:var(--err)"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

  let html = result.ok && !result.issues.length
    ? `<div class="val-item ok">${ICO.check} All validation checks passed.</div>`
    : "";
  for (const i of result.issues) {
    const ico = i.severity === "error" ? ICO.err : ICO.warn;
    html += `<div class="val-item ${i.severity}">${ico}<span>${esc(i.message)}</span></div>`;
  }
  const aiLabel = result.ok ? "Ask AI to review" : "Ask AI to fix";
  html += `<div class="validation-actions"><button id="validation-ask-ai" class="btn btn-outline" type="button">${aiLabel}</button></div>`;
  div.innerHTML = html;
  $("validation-ask-ai")?.addEventListener("click", () => {
    const issueText = result.issues.length
      ? result.issues.map((issue) => `[${issue.severity}] ${issue.code ? `${issue.code}: ` : ""}${issue.message}`).join("\n")
      : "No validation issues were reported.";
    overlay.classList.add("hidden");
    openAiWithPrompt(`Review the current TowerForge project validation result. Explain root causes and the smallest safe next steps. Do not edit yet.\n\n${issueText}`, { mode: "ask" });
  });
  overlay.classList.remove("hidden");
}

$("btn-close-validation")?.addEventListener("click", () => $("validation-overlay").classList.add("hidden"));
$("validation-overlay")?.addEventListener("click", e => { if (e.target === $("validation-overlay")) $("validation-overlay").classList.add("hidden"); });

async function simulateSelectedMission() {
  const missionId = S.waveMissionId ?? S.selectedMissionEdId;
  if (!missionId) { toast("Select a mission first.", "warn"); return; }
  showOverlayLoading("sim-overlay", "sim-results", "Running headless simulation…", "sim-title", "Simulating");
  try {
    const result = await apiGet(`/api/sim/${encodeURIComponent(missionId)}`);
    S.lastSimulation = result;
    recordActivity("Mission simulation", result.outcome === "victory" ? "ok" : "warning", `${missionId}: ${result.outcome}, core ${result.coreHp}/${result.maxCoreHp}`);
    showSimResult(result);
  } catch (e) { recordActivity("Mission simulation", "error", `${missionId}: ${e.message}`); toast("Sim error: " + e.message, "err"); $("sim-overlay")?.classList.add("hidden"); }
}
$("btn-sim")?.addEventListener("click", () => runStudioCommand("project.simulate"));

function showSimResult(result) {
  const overlay = $("sim-overlay");
  const div     = $("sim-results");
  const title   = $("sim-title");
  if (!overlay || !div) return;
  div.className = "overlay-body";
  title.textContent = result.ok ? `Sim: ${result.label ?? result.missionId}` : "Sim Error";
  if (!result.ok) {
    div.innerHTML = `<div class="val-item error">${ICO.err} ${esc(result.error)}</div>`;
    overlay.classList.remove("hidden");
    return;
  }

  const waves = result.waveStats ?? [];
  const totalEnemies = waves.reduce((s, w) => s + (w.count ?? 0), 0);
  const totalHp = waves.reduce((s, w) => s + (w.totalHp ?? 0), 0);
  const outcomeIcon = result.outcome === "victory" ? ICO.check : result.outcome === "defeat" ? ICO.err : ICO.warn;
  const outcomeLabel = result.outcome === "victory" ? "Victory — towers held the line"
    : result.outcome === "defeat" ? "Defeat — the core fell"
    : "Still playing when the sim ended (try a longer duration or stronger towers)";

  let html = `<div class="sim-outcome-banner ${esc(result.outcome)}">${outcomeIcon}<span>${esc(outcomeLabel)}</span></div>`;

  const kpi = (v, k) => `<div class="sim-kpi"><div class="kpi-v">${esc(String(v))}</div><div class="kpi-k">${esc(k)}</div></div>`;
  html += `<div class="sim-kpis">
    ${kpi(`${Math.round(result.coreHp)}/${result.maxCoreHp ?? "?"}`, "Core HP")}
    ${kpi(`${result.startedWaveCount}/${result.totalWaves}`, "Waves")}
    ${kpi(result.towersBuilt ?? 0, "Towers")}
    ${kpi(totalEnemies, "Enemies")}
    ${kpi(totalHp, "Total HP")}
    ${kpi(result.coins ?? result.startingResources?.coins ?? 0, "Coins")}
  </div>`;

  if (waves.length) {
    html += `<div class="sim-chart-title">Wave pressure — total HP per wave</div>`;
    html += svgBarChart(waves);
    html += `<div class="sim-chart-title" style="margin-top:14px">Difficulty curve — threat per wave</div>`;
    html += svgCurve(waves, "totalThreat", "threat");
    html += `<div class="chart-legend"><span><span class="sw" style="background:var(--err)"></span>Wave HP</span><span><span class="sw" style="background:var(--blue)"></span>Threat to core</span></div>`;
  }

  html += `<div class="sim-stat"><span class="k">Map</span><span class="v">${esc(result.mapId)} (${esc(result.mapSize)})</span></div>`;
  html += `<div class="sim-stat"><span class="k">Elapsed</span><span class="v">${esc(String(result.elapsed))}/${esc(String(result.duration))} units</span></div>`;
  html += `<div class="sim-stat"><span class="k">Available towers</span><span class="v">${esc((result.availableTowers ?? []).join(", ") || "none")}</span></div>`;

  if (result.eventCounts && Object.keys(result.eventCounts).length) {
    html += `<div class="form-section-title" style="margin-top:14px">Events</div>`;
    for (const [eventType, count] of Object.entries(result.eventCounts).sort())
      html += `<div class="sim-stat"><span class="k">${esc(eventType)}</span><span class="v">${esc(String(count))}</span></div>`;
  }
  div.innerHTML = html;
  overlay.classList.remove("hidden");
}

$("btn-close-sim")?.addEventListener("click", () => $("sim-overlay").classList.add("hidden"));
$("sim-overlay")?.addEventListener("click", e => { if (e.target === $("sim-overlay")) $("sim-overlay").classList.add("hidden"); });

// ─────────────────────────────────────────────────────────────────────────────
// KEYBOARD SHORTCUTS
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener("keydown", e => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && (e.key === "s" || e.key === "S")) { e.preventDefault(); runStudioCommand("file.save"); }
  if (ctrl && e.shiftKey && e.key === "V")       { e.preventDefault(); runStudioCommand("project.validate"); }
  if (e.key === "Escape") {
    $("validation-overlay")?.classList.add("hidden");
    $("sim-overlay")?.classList.add("hidden");
    closeRecipePicker();
    closeBuildPreview();
  }
  if (ctrl && (e.key === "r" || e.key === "R")) {
    if (S.dirty && !confirm("You have unsaved changes. Reload anyway?")) { e.preventDefault(); return; }
    e.preventDefault(); load();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATION WIRING
// ─────────────────────────────────────────────────────────────────────────────
$("btn-save")?.addEventListener("click", () => runStudioCommand("file.save"));
document.querySelectorAll(".nav-tab").forEach(btn => {
  if (btn.dataset.tab) btn.addEventListener("click", () => runStudioCommand(`navigate.${btn.dataset.tab}`));
});

// ═════════════════════════════════════════════════════════════════════════════
// ACCESSIBILITY — keyboard-operable list items (role/tabindex + Enter/Space)
// ═════════════════════════════════════════════════════════════════════════════
const A11Y_SEL = ".entity-item, .mission-item, .wm-item, .pt-tower";
(function setupA11y() {
  const main = $("main-content");
  if (main) {
    const obs = new MutationObserver(muts => {
      for (const m of muts) for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const els = node.matches?.(A11Y_SEL) ? [node] : [...(node.querySelectorAll?.(A11Y_SEL) ?? [])];
        for (const el of els) {
          if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
          if (!el.hasAttribute("role")) el.setAttribute("role", "button");
        }
      }
    });
    obs.observe(main, { childList: true, subtree: true });
  }
  document.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = e.target;
    if (el && el.matches && el.matches(A11Y_SEL)) { e.preventDefault(); el.click(); }
  });
})();

// ═════════════════════════════════════════════════════════════════════════════
// STYLED CONFIRM DIALOG (+ reference awareness)
// ═════════════════════════════════════════════════════════════════════════════
let confirmResolver = null;
function confirmDialog({ title, message = "", refs = [], confirmLabel = "Delete", danger = true } = {}) {
  const overlay = $("confirm-overlay"), body = $("confirm-body"), okBtn = $("confirm-ok");
  if (!overlay || !body || !okBtn) return Promise.resolve(window.confirm(title));
  let html = `<div class="c-title">${esc(title)}</div>`;
  if (message) html += `<div>${esc(message)}</div>`;
  if (refs && refs.length) {
    html += `<div class="confirm-refs">${ICO.warn} Still referenced by:<ul>${refs.map(r => `<li>${esc(r)}</li>`).join("")}</ul>Deleting leaves dangling references that validation will flag.</div>`;
  }
  body.innerHTML = html;
  okBtn.textContent = confirmLabel;
  okBtn.className = danger ? "btn btn-danger" : "btn btn-primary";
  overlay.classList.remove("hidden");
  okBtn.focus();
  return new Promise(resolve => { confirmResolver = resolve; });
}
function closeConfirm(result) {
  $("confirm-overlay")?.classList.add("hidden");
  const r = confirmResolver; confirmResolver = null;
  if (r) r(result);
}
$("confirm-ok")?.addEventListener("click", () => closeConfirm(true));
$("confirm-cancel")?.addEventListener("click", () => closeConfirm(false));
$("confirm-overlay")?.addEventListener("click", e => { if (e.target === $("confirm-overlay")) closeConfirm(false); });

function findReferences(kind, id) {
  const P = S.project, refs = [];
  if (!P) return refs;
  if (kind === "enemy") {
    for (const [wsId, waves] of Object.entries(P.waveSets ?? {}))
      for (const w of waves ?? [])
        for (const g of w.groups ?? [])
          if (g.enemyId === id) refs.push(`wave "${w.label ?? w.id}" (set ${wsId})`);
    for (const [eid, e] of Object.entries(P.enemies ?? {})) {
      if (eid === id) continue;
      if (e.spawnOnDeath?.enemyId === id) refs.push(`enemy "${eid}" (spawn-on-death)`);
      for (const ph of e.phaseSpawns ?? []) if (ph.enemyId === id) refs.push(`enemy "${eid}" (phase-spawn)`);
    }
  } else if (kind === "tower") {
    for (const [mid, m] of Object.entries(P.missions ?? {}))
      if ((m.buildTowerIds ?? []).includes(id)) refs.push(`mission "${m.label ?? mid}"`);
    for (const [tid, t] of Object.entries(P.towers ?? {})) {
      if (tid === id) continue;
      const a = t.attack ?? {};
      if (t.requiresAuraFrom === id) refs.push(`tower "${tid}" (requires aura)`);
      if ((a.unlocksTowerIds ?? []).includes(id)) refs.push(`tower "${tid}" (unlocks)`);
      if ((a.affectsTowerIds ?? []).includes(id)) refs.push(`tower "${tid}" (buffs)`);
    }
  } else if (kind === "mission") {
    if (P.defaultMissionId === id) refs.push("the default mission");
    for (const node of P.worldMap?.missionNodes ?? []) {
      if (node.missionId === id) refs.push("a world-map node");
      if ((node.unlockRequiresMissionIds ?? []).includes(id)) refs.push(`unlock requirement of "${node.missionId}"`);
    }
  }
  return [...new Set(refs)].slice(0, 12);
}

// ═════════════════════════════════════════════════════════════════════════════
// LOADING STATES
// ═════════════════════════════════════════════════════════════════════════════
function showOverlayLoading(overlayId, bodyId, label, titleId, title) {
  const overlay = $(overlayId), body = $(bodyId);
  if (titleId && $(titleId) && title) $(titleId).textContent = title;
  if (body) { body.className = "overlay-body loading"; body.innerHTML = `<span class="spinner"></span> ${esc(label)}`; }
  overlay?.classList.remove("hidden");
}
async function withButtonSpinner(btn, fn) {
  if (!btn) return fn();
  const prev = btn.innerHTML, wasDisabled = btn.disabled;
  btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>`;
  try { return await fn(); }
  finally { btn.innerHTML = prev; btn.disabled = wasDisabled; }
}

// ═════════════════════════════════════════════════════════════════════════════
// CONTINUOUS CLIENT-SIDE VALIDATION (cross-references on the unsaved project)
// ═════════════════════════════════════════════════════════════════════════════
let validationTimer = null;
function scheduleValidation() { clearTimeout(validationTimer); validationTimer = setTimeout(refreshValidationUI, 250); }

function validateClient(P) {
  const issues = [];
  if (!P) return issues;
  const has = obj => new Set(Object.keys(obj ?? {}));
  const enemyIds = has(P.enemies), towerIds = has(P.towers), mapIds = has(P.maps);
  const waveSetIds = has(P.waveSets), abilityIds = has(P.abilities), missionIds = has(P.missions);
  const add = (kind, entityId, message) => issues.push({ kind, entityId, message });

  for (const [wsId, waves] of Object.entries(P.waveSets ?? {}))
    for (const w of waves ?? [])
      for (const g of w.groups ?? [])
        if (g.enemyId && !enemyIds.has(g.enemyId)) add("waveSet", wsId, `Wave "${w.label ?? w.id}" references unknown enemy "${g.enemyId}".`);

  for (const [mid, m] of Object.entries(P.missions ?? {})) {
    if (m.mapId && !mapIds.has(m.mapId)) add("mission", mid, `References unknown map "${m.mapId}".`);
    if (m.waveSetId && !waveSetIds.has(m.waveSetId)) add("mission", mid, `References unknown wave set "${m.waveSetId}".`);
    for (const tid of m.buildTowerIds ?? []) if (!towerIds.has(tid)) add("mission", mid, `Lists unknown tower "${tid}".`);
    for (const aid of m.abilityIds ?? []) if (!abilityIds.has(aid)) add("mission", mid, `Lists unknown ability "${aid}".`);
    if (!(m.buildTowerIds ?? []).length) add("mission", mid, `Has no buildable towers.`);
  }
  for (const [tid, t] of Object.entries(P.towers ?? {})) {
    const a = t.attack ?? {};
    if (t.requiresAuraFrom && !towerIds.has(t.requiresAuraFrom)) add("tower", tid, `Requires unknown aura tower "${t.requiresAuraFrom}".`);
    for (const u of a.unlocksTowerIds ?? []) if (!towerIds.has(u)) add("tower", tid, `Unlocks unknown tower "${u}".`);
    for (const u of a.affectsTowerIds ?? []) if (!towerIds.has(u)) add("tower", tid, `Buffs unknown tower "${u}".`);
  }
  for (const [eid, e] of Object.entries(P.enemies ?? {})) {
    if (e.spawnOnDeath?.enemyId && !enemyIds.has(e.spawnOnDeath.enemyId)) add("enemy", eid, `spawnOnDeath references unknown enemy "${e.spawnOnDeath.enemyId}".`);
    for (const ph of e.phaseSpawns ?? []) if (ph.enemyId && !enemyIds.has(ph.enemyId)) add("enemy", eid, `phaseSpawn references unknown enemy "${ph.enemyId}".`);
  }
  if (P.defaultMissionId && !missionIds.has(P.defaultMissionId)) add("mission", P.defaultMissionId, `Default mission "${P.defaultMissionId}" is not defined.`);
  for (const node of P.worldMap?.missionNodes ?? [])
    if (node.missionId && !missionIds.has(node.missionId)) add("worldMap", node.missionId, `World-map node references unknown mission "${node.missionId}".`);
  return issues;
}

function refreshValidationUI() {
  if (!S.project) return;
  const issues = validateClient(S.project);
  S.clientIssues = issues;
  S.errorEntities = new Set(issues.map(i => `${i.kind}:${i.entityId}`));
  const pill = $("error-pill");
  if (pill) {
    pill.classList.add("visible");
    if (issues.length) {
      pill.classList.remove("is-ok");
      pill.innerHTML = `${ICO.warn}<span>${issues.length}</span>`;
      pill.title = `${issues.length} live reference issue(s) — click for details`;
    } else {
      pill.classList.add("is-ok");
      pill.innerHTML = `${ICO.check}<span>OK</span>`;
      pill.title = "No reference issues in the unsaved project";
    }
  }
  renderWorkbench();
  markEntityErrors();
}
function markEntityErrors() {
  const errs = S.errorEntities ?? new Set();
  const mark = (sel, kind) => document.querySelectorAll(sel).forEach(it => it.classList.toggle("has-error", errs.has(`${kind}:${it.dataset.eid}`)));
  mark("#enemy-list .entity-item", "enemy");
  mark("#tower-list .entity-item", "tower");
  mark("#mission-list .entity-item", "mission");
  mark("#wave-mission-list .mission-item", "mission");
}
function jumpToEntity(kind, id) {
  if (kind === "enemy") { switchTab("enemies"); S.selectedEnemyId = id; renderEnemiesTab(); }
  else if (kind === "tower") { switchTab("towers"); S.selectedTowerId = id; renderTowersTab(); }
  else if (kind === "mission" || kind === "worldMap") { switchTab(kind === "mission" ? "missions" : "worldmap"); if (kind === "mission") { S.selectedMissionEdId = id; renderMissionsTab(); } }
  else if (kind === "waveSet") switchTab("waves");
}
function showClientValidation() {
  const issues = S.clientIssues ?? [];
  const overlay = $("validation-overlay"), div = $("validation-results"), title = $("val-title"), icon = $("val-icon");
  if (!overlay || !div) return;
  div.className = "overlay-body";
  title.textContent = issues.length ? `${issues.length} live reference issue(s)` : "No live issues";
  icon.innerHTML = issues.length ? ICO.warn : ICO.check;
  div.innerHTML = issues.length
    ? issues.map(i => `<div class="val-item error" data-jk="${esc(i.kind)}" data-ji="${esc(i.entityId)}" style="cursor:pointer">${ICO.err}<span><strong>${esc(i.entityId)}</strong> — ${esc(i.message)}</span></div>`).join("")
    : `<div class="val-item ok">${ICO.check} No reference issues in your unsaved project. Use Validate for the full engine check.</div>`;
  div.querySelectorAll("[data-jk]").forEach(el => el.addEventListener("click", () => { jumpToEntity(el.dataset.jk, el.dataset.ji); overlay.classList.add("hidden"); }));
  overlay.classList.remove("hidden");
}
$("error-pill")?.addEventListener("click", () => setWorkbench(true, "problems"));

// ═════════════════════════════════════════════════════════════════════════════
// SIM VISUALIZATION (zero-dependency SVG charts)
// ═════════════════════════════════════════════════════════════════════════════
function svgBarChart(waveStats) {
  const W = 480, H = 150, pad = { l: 38, r: 10, t: 8, b: 22 };
  const n = waveStats.length || 1;
  const maxHp = Math.max(1, ...waveStats.map(w => w.totalHp ?? 0));
  const bw = (W - pad.l - pad.r) / n;
  const y = v => pad.t + (1 - v / maxHp) * (H - pad.t - pad.b);
  let grid = "", bars = "", labels = "";
  for (let g = 0; g <= 4; g++) {
    const gy = pad.t + (g / 4) * (H - pad.t - pad.b);
    grid += `<line class="grid" x1="${pad.l}" y1="${gy}" x2="${W - pad.r}" y2="${gy}"/>`;
    grid += `<text x="${pad.l - 5}" y="${gy + 3}" text-anchor="end">${Math.round(maxHp * (1 - g / 4))}</text>`;
  }
  waveStats.forEach((w, i) => {
    const x = pad.l + i * bw, top = y(w.totalHp ?? 0), h = (H - pad.b) - top;
    bars += `<rect class="bar-hp" x="${(x + bw * 0.2).toFixed(1)}" y="${top.toFixed(1)}" width="${(bw * 0.6).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="2"><title>${esc(w.label ?? w.id)}: ${w.totalHp} HP, ${w.count} enemies</title></rect>`;
    labels += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle">${i + 1}</text>`;
  });
  return `<svg class="sim-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Total HP per wave">${grid}<line class="axis" x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}"/>${bars}${labels}</svg>`;
}
function svgCurve(waveStats, key, unit) {
  const W = 480, H = 110, pad = { l: 38, r: 10, t: 8, b: 22 };
  const n = waveStats.length;
  if (!n) return "";
  const max = Math.max(1, ...waveStats.map(w => w[key] ?? 0));
  const x = i => pad.l + (n === 1 ? 0.5 : i / (n - 1)) * (W - pad.l - pad.r);
  const y = v => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const pts = waveStats.map((w, i) => `${x(i).toFixed(1)},${y(w[key] ?? 0).toFixed(1)}`).join(" ");
  const dots = waveStats.map((w, i) => `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(w[key] ?? 0).toFixed(1)}" r="3"><title>${esc(w.label ?? w.id)}: ${w[key] ?? 0} ${unit}</title></circle>`).join("");
  return `<svg class="sim-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(unit)} per wave"><line class="axis" x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}"/><polyline class="curve" points="${pts}"/>${dots}</svg>`;
}

// ═════════════════════════════════════════════════════════════════════════════
// LIVE PLAYTEST
// ═════════════════════════════════════════════════════════════════════════════
const PT = {
  mod: null, rmod: null, content: null, game: null, renderer: null, raf: null,
  towerId: null, missionId: null, difficultyId: null, keyboardCoord: null, dirty: true, lastFrame: 0, error: null,
  events: [], selectedDebug: null, resumeSpeed: 1, lastDebugRender: 0
};
const PT_KIND_COLOR = { single: "#e8a44a", pulse: "#a07ec8", sniper: "#7eb87e", antiair: "#e8c84a", splash: "#6ea8d8", support: "#7ec8b8", support_buff: "#c87e9c", pipeline: "#79c8d3" };
const PT_TARGET_MODES = [["first", "First"], ["last", "Last"], ["closest", "Closest"], ["furthest", "Furthest"], ["strongest", "Strongest"], ["weakest", "Weakest"]];

function assembleBalance() {
  const P = S.project;
  return {
    constants: P.constants ?? {},
    currencies: projCurrencies(),
    defaultDifficultyId: P.defaultDifficultyId ?? P.difficulties?.[0]?.id ?? "normal",
    difficulties: P.difficulties ?? [{ id: "normal", label: "Normal" }],
    metaProgression: P.metaProgression ?? { currencies: [], upgrades: {}, rewardsByMission: {} },
    terrainTypes: P.terrainTypes ?? {},
    defaultMissionId: P.defaultMissionId ?? Object.keys(P.missions ?? {})[0] ?? "",
    abilities: P.abilities ?? {}, enemies: P.enemies ?? {}, towers: P.towers ?? {},
    waveSets: P.waveSets ?? {}, missions: P.missions ?? {}
  };
}
async function ensurePlaytestEngine() {
  if (PT.mod && PT.rmod) return true;
  try {
    PT.mod = await import("/engine/index.js");
    PT.rmod = await import("/renderer/index.mjs");
    try { PT.amod = await import("/renderer/audio.mjs"); } catch { PT.amod = null; }
    return true;
  } catch { PT.error = "Engine is still compiling — wait a moment and reopen Playtest."; return false; }
}
function buildPlaytestContent() {
  PT.error = null;
  try {
    PT.content = PT.mod.createGameContentRegistry({
      balance: assembleBalance(),
      maps: S.project.maps ?? {},
      worldMap: S.project.worldMap ?? { width: 800, height: 600, regions: [], missionNodes: [] },
      scripts: S.project.scripts ?? {},
      visuals: S.project.visuals ?? {}
    });
    return true;
  } catch (e) { PT.error = "Cannot build game from project: " + e.message; PT.content = null; return false; }
}
async function refreshPlaytestMaps() {
  const mapSources = S.project.mapSources ?? {};
  if (!Object.keys(mapSources).length) return;
  const result = await apiPost("/api/maps/preview", { mapSources });
  S.project.maps = result.maps;
}
function newPlaytestGame() {
  if (!PT.content) return null;
  const ids = Object.keys(PT.content.missions ?? {});
  if (!PT.missionId || !PT.content.missions[PT.missionId])
    PT.missionId = (PT.content.defaultMissionId && PT.content.missions[PT.content.defaultMissionId]) ? PT.content.defaultMissionId : ids[0];
  if (!PT.missionId) { PT.error = "No playable missions in this project."; PT.game = null; return null; }
  const difficultyIds = PT.content.difficulties.map((item) => item.id);
  if (!difficultyIds.includes(PT.difficultyId)) PT.difficultyId = PT.content.defaultDifficultyId;
  try { PT.game = new PT.mod.TowerDefenseGame({ missionId: PT.missionId, content: PT.content, difficultyId: PT.difficultyId }); }
  catch (e) { PT.error = "Cannot start mission: " + e.message; PT.game = null; return null; }
  const m = PT.content.missions[PT.missionId];
  const tids = (m.buildTowerIds?.length ? m.buildTowerIds : Object.keys(PT.content.towers));
  PT.towerId = tids[0] ?? null;
  PT.events = [];
  PT.selectedDebug = null;
  PT.keyboardCoord = null;
  syncPlaytestKeyboardCoord(ensurePlaytestKeyboardCoord());
  renderPlaytestDebugger(PT.game.getSnapshot());
  return PT.game;
}
async function renderPlaytestTab() {
  const empty = $("playtest-empty"), stage = $("playtest-stage"), side = $("playtest-side");
  const fail = msg => { empty.style.display = "flex"; empty.querySelector("p").textContent = msg; stage.style.display = "none"; side.style.display = "none"; stopPlaytestLoop(); };
  if (!(await ensurePlaytestEngine())) return fail(PT.error);
  if (PT.dirty || !PT.game) {
    PT.error = null;
    try { await refreshPlaytestMaps(); }
    catch (e) { PT.error = "Cannot preview current map sources: " + e.message; }
    if (!PT.error && buildPlaytestContent()) { PT.renderer = null; newPlaytestGame(); }
    PT.dirty = false;
  }
  if (PT.error || !PT.game) return fail(PT.error ?? "No playable mission.");
  empty.style.display = "none"; stage.style.display = "flex"; side.style.display = "flex";
  const canvas = $("playtest-canvas");
  if (!PT.renderer) PT.renderer = PT.rmod.createCanvasRenderer({ canvas, content: PT.content, assetBase: "/project-file/", theme: PT.content.visuals?.theme?.renderer });
  else PT.renderer.content = PT.content;
  syncPlaytestKeyboardCoord(ensurePlaytestKeyboardCoord());
  if (PT.amod) {
    if (!PT.audio) PT.audio = PT.amod.createAudioPlayer({ audio: PT.content.visuals?.audio, assetBase: "/project-file/" });
    else PT.audio.setCatalog(PT.content.visuals?.audio, "/project-file/");
  }
  PT.renderer.resize();
  const sel = $("pt-mission");
  if (sel) { sel.innerHTML = Object.keys(PT.content.missions).map(id => `<option value="${esc(id)}"${id === PT.missionId ? " selected" : ""}>${esc(PT.content.missions[id]?.label || id)}</option>`).join(""); sel.value = PT.missionId; }
  const difficulty = $("pt-difficulty");
  if (difficulty) {
    difficulty.innerHTML = PT.content.difficulties.map(item => `<option value="${esc(item.id)}">${esc(item.label)}</option>`).join("");
    difficulty.value = PT.difficultyId;
  }
  renderPlaytestPalette();
  startPlaytestLoop();
}
function renderPlaytestPalette() {
  const list = $("pt-tower-list");
  if (!list || !PT.content) return;
  const m = PT.content.missions[PT.missionId];
  const ids = (m?.buildTowerIds?.length ? m.buildTowerIds : Object.keys(PT.content.towers));
  list.innerHTML = "";
  for (const tid of ids) {
    const t = PT.content.towers[tid];
    if (!t) continue;
    const btn = document.createElement("button");
    btn.className = "pt-tower" + (tid === PT.towerId && !PT.armed ? " active" : "");
    btn.innerHTML = `<span class="sw" style="background:${PT_KIND_COLOR[t.attack?.kind] ?? "#7eb87e"}"></span><span class="pt-tname">${esc(t.label || tid)}</span><span class="pt-tcost">${t.cost?.coins ?? 0}c</span>`;
    btn.addEventListener("click", () => { PT.towerId = tid; PT.armed = null; if ($("pt-interaction-mode")) $("pt-interaction-mode").value = "build"; renderPlaytestPalette(); });
    list.appendChild(btn);
  }
  // Mission abilities — click to arm, then click the map to use.
  const abilities = Object.values(PT.game?.getSnapshot().abilities ?? {});
  if (abilities.length) {
    const sep = document.createElement("div");
    sep.className = "pt-ability-sep";
    sep.textContent = "Abilities";
    list.appendChild(sep);
    for (const a of abilities) {
      const btn = document.createElement("button");
      btn.className = "pt-tower pt-ability" + (PT.armed === a.id ? " active" : "");
      btn.dataset.aid = a.id;
      btn.innerHTML = `<span class="sw" style="background:#8db0ff"></span><span class="pt-tname">✦ ${esc(a.label || a.id)}</span><span class="pt-tcost">r${a.radius}</span>`;
      btn.addEventListener("click", () => {
        PT.armed = PT.armed === a.id ? null : a.id;
        if ($("pt-interaction-mode")) $("pt-interaction-mode").value = "build";
        renderPlaytestPalette();
        const el = $("pt-msg"); if (el) el.textContent = PT.armed ? `Click the map to use ${a.label || a.id}.` : "Ability disarmed.";
      });
      list.appendChild(btn);
    }
  }
}

function playtestEventTarget(event) {
  if (event.towerId) return { kind: "tower", id: event.towerId };
  if (event.enemyId) return { kind: "enemy", id: event.enemyId };
  if (event.towerIds?.[0]) return { kind: "tower", id: event.towerIds[0] };
  if (event.enemyIds?.[0]) return { kind: "enemy", id: event.enemyIds[0] };
  return null;
}

function recordPlaytestEvents(events, snapshot) {
  for (const event of events) {
    PT.events.unshift({ time: snapshot.missionElapsed, type: event.type, target: playtestEventTarget(event), event: deep(event) });
  }
  if (PT.events.length > 120) PT.events.length = 120;
}

function renderPlaytestDebugger(snapshot = PT.game?.getSnapshot()) {
  const inspector = $("pt-inspector");
  const timeline = $("pt-event-timeline");
  if (!inspector || !timeline || !snapshot) return;
  const selected = PT.selectedDebug;
  if (!selected) inspector.innerHTML = "Click Inspect, then choose a tower or enemy.";
  else if (selected.kind === "tower") {
    const tower = snapshot.towers.find((item) => item.id === selected.id);
    const type = tower && PT.content?.towers?.[tower.typeId];
    const refund = tower ? PT.game?.getTowerSellRefund(tower) : null;
    const targetMode = tower?.targetMode;
    const targetOptions = targetMode
      ? [...PT_TARGET_MODES, ...(!PT_TARGET_MODES.some(([mode]) => mode === targetMode) ? [[targetMode, targetMode]] : [])]
        .map(([mode, label]) => `<option value="${esc(mode)}"${mode === targetMode ? " selected" : ""}>${esc(label)}</option>`).join("")
      : "";
    inspector.innerHTML = tower
      ? `<div class="pt-inspector-head"><span><strong>${esc(type?.label || tower.typeId)}</strong> <code>${esc(tower.id)}</code></span><button class="btn btn-danger" type="button" data-pt-sell>Sell ${esc(Object.entries(refund ?? {}).filter(([, value]) => value > 0).map(([resourceId, value]) => `${value} ${resourceId}`).join(" + ") || "tower")}</button></div><div>level ${tower.level} · cooldown ${tower.cooldown.toFixed(2)}${tower.hp != null ? ` · HP ${Math.ceil(tower.hp)}/${type?.maxHp ?? "?"}` : ""}${tower.disabledFor ? ` · disabled ${tower.disabledFor.toFixed(1)}` : ""}</div>${targetMode ? `<label class="pt-target-mode">Target priority<select data-pt-target-mode>${targetOptions}</select></label>` : ""}`
      : `<code>${esc(selected.id)}</code> is no longer active.`;
    inspector.querySelector("[data-pt-sell]")?.addEventListener("click", () => {
      const result = PT.game?.sellTower(selected.id) ?? { ok: false, reason: "No active game." };
      ptMsg(result, "Tower sold.");
      if (result.ok) PT.selectedDebug = null;
      renderPlaytestDebugger(PT.game?.getSnapshot());
    });
    inspector.querySelector("[data-pt-target-mode]")?.addEventListener("change", (event) => {
      const result = PT.game?.setTowerTargetMode(selected.id, event.target.value) ?? { ok: false, reason: "No active game." };
      ptMsg(result, `Target priority: ${event.target.selectedOptions[0]?.textContent ?? event.target.value}.`);
      renderPlaytestDebugger(PT.game?.getSnapshot());
    });
  } else {
    const enemy = snapshot.enemies.find((item) => item.id === selected.id);
    const type = enemy && PT.content?.enemies?.[enemy.typeId];
    const statuses = enemy ? Object.entries(enemy.statuses ?? {}).filter(([, value]) => value && value.remaining > 0).map(([name, value]) => `${name} ${value.remaining.toFixed(1)}`).join(", ") : "";
    inspector.innerHTML = enemy
      ? `<strong>${esc(type?.label || enemy.typeId)}</strong> <code>${esc(enemy.id)}</code><br>HP ${Math.ceil(enemy.hp)}/${type?.maxHp ?? "?"} · progress ${enemy.pathProgress.toFixed(2)}${statuses ? ` · ${esc(statuses)}` : ""}`
      : `<code>${esc(selected.id)}</code> is no longer active.`;
  }
  timeline.innerHTML = PT.events.length ? PT.events.map((item, index) => {
    const tag = item.target ? "button" : "div";
    return `<${tag} class="pt-event-row"${item.target ? ` type="button" data-pt-event-index="${index}"` : ""}><span class="pt-event-time">${item.time.toFixed(2)}</span><span class="pt-event-type" title="${esc(JSON.stringify(item.event))}">${esc(item.type)}</span></${tag}>`;
  }).join("") : `<div class="pt-event-row"><span class="pt-event-time">0.00</span><span class="pt-event-type">No events yet</span></div>`;
}

function presentPlaytestSnapshot(snapshot, events) {
  recordPlaytestEvents(events, snapshot);
  snapshot.lastEvents = events;
  PT.renderer.drawSnapshot(snapshot);
  if (PT.audio && $("pt-sound")?.checked) PT.audio.handleEvents(events);
  updatePlaytestHud(snapshot);
  const now = performance.now();
  if (events.length || (PT.selectedDebug && now - PT.lastDebugRender > 200)) {
    renderPlaytestDebugger(snapshot);
    PT.lastDebugRender = now;
  }
}

function syncPlaytestPauseButton() {
  const paused = Number($("pt-speed")?.value) === 0;
  const button = $("pt-pause");
  button?.setAttribute("aria-pressed", String(paused));
  button?.setAttribute("aria-label", paused ? "Resume" : "Pause");
  if (button) button.title = paused ? "Resume" : "Pause";
}
function startPlaytestLoop() {
  stopPlaytestLoop();
  PT.lastFrame = performance.now();
  const loop = now => {
    if (S.activeTab !== "playtest" || !PT.game) { PT.raf = null; return; }
    const dt = Math.min(0.05, (now - PT.lastFrame) / 1000);
    PT.lastFrame = now;
    const speed = Number($("pt-speed")?.value) || 0;
    // Capture player-action events before tick() clears them, so their sounds/effects fire.
    let rsnap = PT.game.getRenderSnapshot();
    const pending = rsnap.lastEvents;
    const ticked = speed > 0 && rsnap.outcome === "playing";
    if (ticked) {
      const tu = PT.content.constants.timeUnitSeconds || 1;
      PT.game.tick((dt / tu) * speed);
      rsnap = PT.game.getRenderSnapshot();
    }
    const events = ticked ? pending.concat(rsnap.lastEvents) : pending;
    PT.game.lastEvents = []; // consumed this frame — clear so nothing replays next frame
    rsnap.lastEvents = events;
    presentPlaytestSnapshot(rsnap, events);
    PT.raf = requestAnimationFrame(loop);
  };
  PT.raf = requestAnimationFrame(loop);
}
function stopPlaytestLoop() { if (PT.raf) { cancelAnimationFrame(PT.raf); PT.raf = null; } }
function updatePlaytestHud(s = PT.game.getSnapshot()) {
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  const out = $("pt-outcome");
  if (out) { out.textContent = s.outcome; out.className = "v " + (s.outcome === "victory" ? "text-ok" : s.outcome === "defeat" ? "text-err" : ""); }
  set("pt-core", `${Math.ceil(s.coreHp)}/${s.maxCoreHp}`);
  set("pt-res", Object.entries(s.resources).map(([k, v]) => `${k}:${Math.floor(v)}`).join("  "));
  set("pt-wave", `${s.startedWaveCount}/${s.totalWaves} ${s.waveState}`);
  set("pt-enemies", String(s.enemies.length));
  set("pt-towers-count", String(s.towers.length));
  set("pt-kills-leaks", `${s.killCount ?? 0} / ${s.leakCount ?? 0}`);
  const objectives = s.objectiveProgress ?? [];
  const objectiveCount = objectives.filter((item) => item.complete).length;
  const stars = s.stars ?? [];
  const starCount = stars.filter((item) => item.achieved).length;
  set("pt-objectives", `${objectiveCount}/${objectives.length}${stars.length ? ` | ${starCount}/${stars.length} stars` : ""}`);
  for (const btn of document.querySelectorAll(".pt-ability")) {
    const a = s.abilities?.[btn.dataset.aid];
    const cd = Math.ceil(a?.cooldownRemaining ?? 0);
    btn.disabled = !(a && a.ready);
    const cost = btn.querySelector(".pt-tcost");
    if (cost) cost.textContent = cd > 0 ? cd + "s" : "r" + (a?.radius ?? "");
    if (btn.disabled && PT.armed === btn.dataset.aid) { PT.armed = null; btn.classList.remove("active"); }
  }
}
function ptMsg(result, success = "Action completed.") { const el = $("pt-msg"); if (el) el.textContent = result.ok ? success : (result.reason || "Action rejected."); }
$("pt-mission")?.addEventListener("change", () => { PT.missionId = $("pt-mission").value; newPlaytestGame(); renderPlaytestPalette(); const el = $("pt-msg"); if (el) el.textContent = "Mission loaded — place towers and start a wave."; });
$("pt-difficulty")?.addEventListener("change", () => { PT.difficultyId = $("pt-difficulty").value; newPlaytestGame(); renderPlaytestPalette(); const el = $("pt-msg"); if (el) el.textContent = `Difficulty: ${PT.game?.getSnapshot().difficultyLabel ?? PT.difficultyId}.`; });
$("pt-start")?.addEventListener("click", () => { PT.audio?.resume(); if (PT.game) ptMsg(PT.game.startNextWave(), "Wave started."); });
$("pt-reset")?.addEventListener("click", () => { if (buildPlaytestContent()) { newPlaytestGame(); renderPlaytestPalette(); } const el = $("pt-msg"); if (el) el.textContent = "Run reset."; });
$("pt-speed")?.addEventListener("input", () => { const o = $("pt-speed-out"); if (o) o.textContent = $("pt-speed").value + "×"; if (Number($("pt-speed").value) > 0) PT.resumeSpeed = Number($("pt-speed").value); syncPlaytestPauseButton(); });
$("pt-pause")?.addEventListener("click", () => {
  const speed = $("pt-speed");
  if (!speed) return;
  if (Number(speed.value) === 0) speed.value = String(PT.resumeSpeed || 1);
  else { PT.resumeSpeed = Number(speed.value); speed.value = "0"; }
  speed.dispatchEvent(new Event("input"));
});
$("pt-step")?.addEventListener("click", () => {
  if (!PT.game || PT.game.getSnapshot().outcome !== "playing") return;
  const speed = $("pt-speed");
  if (speed) { speed.value = "0"; speed.dispatchEvent(new Event("input")); }
  const pending = PT.game.getRenderSnapshot().lastEvents;
  PT.game.tick(0.1);
  const snapshot = PT.game.getRenderSnapshot();
  const events = pending.concat(snapshot.lastEvents);
  PT.game.lastEvents = [];
  presentPlaytestSnapshot(snapshot, events);
});
$("pt-interaction-mode")?.addEventListener("change", () => {
  PT.armed = null;
  renderPlaytestPalette();
  const el = $("pt-msg");
  if (el) el.textContent = $("pt-interaction-mode").value === "inspect" ? "Click a tower or enemy to inspect it." : "Build mode active.";
});
$("pt-sound")?.addEventListener("change", () => { if ($("pt-sound").checked) PT.audio?.resume(); });
$("pt-event-timeline")?.addEventListener("click", (event) => {
  const row = event.target.closest?.("[data-pt-event-index]");
  const item = row && PT.events[Number(row.dataset.ptEventIndex)];
  if (!item?.target) return;
  PT.selectedDebug = item.target;
  renderPlaytestDebugger();
});
function actAtPlaytestCoord(coord) {
  if (!coord || !PT.game) return;
  syncPlaytestKeyboardCoord(coord);
  if ($("pt-interaction-mode")?.value === "inspect") {
    const snapshot = PT.game.getSnapshot();
    const tower = snapshot.towers.find((item) => item.coord.q === coord.q && item.coord.r === coord.r);
    const enemy = snapshot.enemies.find((item) => { const at = PT.game.enemyCoord(item); return at.q === coord.q && at.r === coord.r; });
    PT.selectedDebug = tower ? { kind: "tower", id: tower.id } : enemy ? { kind: "enemy", id: enemy.id } : null;
    renderPlaytestDebugger(snapshot);
    const el = $("pt-msg"); if (el) el.textContent = PT.selectedDebug ? `${PT.selectedDebug.kind} selected.` : "Nothing active on this tile.";
    return;
  }
  if (PT.armed) { const result = PT.game.useAbility(PT.armed, coord); ptMsg(result, "Ability used."); if (result.ok) PT.armed = null; renderPlaytestPalette(); return; }
  if (PT.towerId) ptMsg(PT.game.placeTower(PT.towerId, coord), "Tower planted.");
}

function ensurePlaytestKeyboardCoord() {
  const tiles = PT.game?.getSnapshot().tiles ?? [];
  if (PT.keyboardCoord && tiles.some(tile => tile.q === PT.keyboardCoord.q && tile.r === PT.keyboardCoord.r)) return PT.keyboardCoord;
  const tile = tiles.find(item => item.terrain === "buildable") ?? tiles[0];
  return tile ? { q: tile.q, r: tile.r } : null;
}

function syncPlaytestKeyboardCoord(coord) {
  PT.keyboardCoord = coord ? { q: coord.q, r: coord.r } : null;
  PT.renderer?.setFocusCoord(PT.keyboardCoord);
  const tile = PT.keyboardCoord && PT.game?.getSnapshot().tiles.find(item => item.q === PT.keyboardCoord.q && item.r === PT.keyboardCoord.r);
  $("playtest-canvas")?.setAttribute("aria-label", tile
    ? `Hex battlefield. Selected tile q ${tile.q}, r ${tile.r}, ${tile.terrain}. Arrow keys move; Enter acts; Escape cancels.`
    : "Hex battlefield. Arrow keys move between tiles; Enter acts; Escape cancels.");
}

function movePlaytestKeyboardCoord(dq, dr) {
  const current = ensurePlaytestKeyboardCoord();
  if (!current) return;
  const target = PT.game.getSnapshot().tiles.find(tile => tile.q === current.q + dq && tile.r === current.r + dr);
  if (target) syncPlaytestKeyboardCoord(target);
}

$("playtest-canvas")?.addEventListener("focus", () => syncPlaytestKeyboardCoord(ensurePlaytestKeyboardCoord()));
$("playtest-canvas")?.addEventListener("keydown", event => {
  const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (moves[event.key]) { event.preventDefault(); movePlaytestKeyboardCoord(...moves[event.key]); }
  else if (event.key === "Enter") { event.preventDefault(); actAtPlaytestCoord(ensurePlaytestKeyboardCoord()); }
  else if (event.key === "Escape") {
    event.preventDefault();
    PT.armed = null;
    renderPlaytestPalette();
    const el = $("pt-msg"); if (el) el.textContent = "Build action cancelled.";
  }
});
$("playtest-canvas")?.addEventListener("click", e => {
  PT.audio?.resume();
  if (!PT.game) return;
  const coord = PT.renderer.pickTile(e, PT.game.getSnapshot().tiles);
  if (!coord) return;
  actAtPlaytestCoord(coord);
});
window.addEventListener("resize", () => { if (S.activeTab === "playtest" && PT.renderer) PT.renderer.resize(); });

// ═════════════════════════════════════════════════════════════════════════════
// UNDO / REDO  (coalesced snapshots of the in-memory project)
// ═════════════════════════════════════════════════════════════════════════════
const H = { undo: [], redo: [], committed: null, timer: null, MAX: 60 };
function historyInit() { H.undo = []; H.redo = []; clearTimeout(H.timer); H.timer = null; H.committed = S.project ? deep(S.project) : null; }
function scheduleHistoryCommit() { clearTimeout(H.timer); H.timer = setTimeout(historyCommit, 400); }
function historyCommit() {
  clearTimeout(H.timer); H.timer = null;
  if (!S.project) return;
  const snap = JSON.stringify(S.project);
  if (H.committed && JSON.stringify(H.committed) === snap) return;
  if (H.committed) { H.undo.push(H.committed); if (H.undo.length > H.MAX) H.undo.shift(); }
  H.redo = [];
  H.committed = JSON.parse(snap);
  scheduleDesktopUiSync();
}
function historyUndo() {
  historyCommit();
  if (!H.undo.length) { toast("Nothing to undo.", "warn"); return; }
  H.redo.push(deep(S.project));
  S.project = H.undo.pop();
  H.committed = deep(S.project);
  afterHistoryRestore("Undo");
}
function historyRedo() {
  if (!H.redo.length) { toast("Nothing to redo.", "warn"); return; }
  H.undo.push(deep(S.project));
  S.project = H.redo.pop();
  H.committed = deep(S.project);
  afterHistoryRestore("Redo");
}
function afterHistoryRestore(label) {
  markDirty(true, true);
  PT.dirty = true;
  renderActiveTab();
  toast(label + ".", "ok");
}
document.addEventListener("keydown", e => {
  const ctrl = e.ctrlKey || e.metaKey;
  const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
  if (ctrl && !e.shiftKey && (e.key === "z" || e.key === "Z")) { if (inField) return; e.preventDefault(); runStudioCommand("edit.undo"); }
  else if (ctrl && ((e.shiftKey && (e.key === "z" || e.key === "Z")) || e.key === "y" || e.key === "Y")) { if (inField) return; e.preventDefault(); runStudioCommand("edit.redo"); }
  if (e.key === "Escape" && !$("confirm-overlay")?.classList.contains("hidden")) closeConfirm(false);
});

// ═════════════════════════════════════════════════════════════════════════════
// CONTEXTUAL HELP + VISUAL IDENTITY
// ═════════════════════════════════════════════════════════════════════════════
function helpIcon(text) {
  return `<span class="help" tabindex="0" role="img" aria-label="${esc(text)}" title="${esc(text)}">?</span>`;
}
const ATTACK_HELP = {
  single: "Single-target. Damage scales with the number of stacks; upgrading adds stacks.",
  pulse: "Area pulse that leaves lingering damage-over-time on enemies after they leave the aura.",
  sniper: "Long-range single-target sniper — the only weapon that fully pierces pierce-only armor.",
  antiair: "Anti-air. Hits multiple flying targets per volley (count scales by level).",
  splash: "Splash + slow. Damages nearby enemies and slows them; chips armored enemies.",
  pipeline: "Universal data-driven tower: targeting selects enemies, delivery expands the target set, and ordered effects apply damage, status, or resources.",
  support: "Aura tower. Unlocks dependent towers placed within its radius (no direct damage).",
  support_buff: "Aura tower. Multiplies the fire rate of affected towers within range."
};
function enemyColorHex(e) {
  return typeof e?.color === "number" ? "#" + e.color.toString(16).padStart(6, "0") : (e?.color ?? "#888888");
}
function towerColorHex(t) { return PT_KIND_COLOR[t?.attack?.kind] ?? "#7eb87e"; }
function spriteSrcFor(kind, id) {
  const v = S.project?.visuals;
  const sid = v?.bindings?.[kind]?.[id];
  const src = sid && v?.sprites?.[sid]?.src;
  return src ? "/project-file/" + String(src).split("/").map(encodeURIComponent).join("/") : null;
}
function entityVisual(kind, id, color, large) {
  const src = spriteSrcFor(kind, id);
  if (src) return `<img class="${large ? "detail-head-icon" : "ent-thumb"}" src="${esc(src)}" alt="" onerror="this.style.display='none'">`;
  if (large) return `<span class="detail-head-dot" style="background:${esc(color)}"></span>`;
  return `<span class="${kind === "towers" ? "ent-swatch" : "ent-dot"}" style="background:${esc(color)}"></span>`;
}

// ═════════════════════════════════════════════════════════════════════════════
// STRUCTURED ATTACK-MODEL EDITORS (level arrays, cost ladders, tower pickers)
// ═════════════════════════════════════════════════════════════════════════════
function levelArrayEditor(key, values, { step = 0.05, int = false } = {}) {
  const rows = (values ?? []).map((v, i) =>
    `<div class="lvl-row"><span class="level-idx">Lv ${i + 1}</span><input class="af-lvl" data-arrkey="${esc(key)}" data-idx="${i}" type="number" step="${int ? 1 : step}" value="${v}">${iconBtn("trash", "Remove level", "af-lvl-del")}</div>`
  ).join("");
  return `<div class="lvl-array" data-arrkey="${esc(key)}">${rows}<button type="button" class="add-btn arr-add af-lvl-add" data-arrkey="${esc(key)}" data-int="${int ? 1 : 0}">${ICO.plus} Level</button></div>`;
}
function costArrayEditor(costs) {
  const rows = (costs ?? []).map((c, i) =>
    `<div class="cost-row" data-idx="${i}"><span class="level-idx">${i + 1}→${i + 2}</span>${projCurrencies().map(cur => `<input class="af-cost" data-idx="${i}" data-field="${esc(cur.id)}" type="number" min="0" step="1" value="${(c && c[cur.id]) || 0}"><span class="cost-unit">${esc(cur.label)}</span>`).join("")}${iconBtn("trash", "Remove level", "af-cost-del")}</div>`
  ).join("");
  return `<div class="cost-array">${rows}<button type="button" class="add-btn arr-add af-cost-add">${ICO.plus} Upgrade level</button></div>`;
}
function towerCheckGrid(key, selected) {
  const sel = new Set(selected ?? []);
  const ids = Object.keys(S.project.towers ?? {});
  const items = ids.map(tid => `<label class="check-item"><input type="checkbox" class="af-towers" data-arrkey="${esc(key)}" data-tid="${esc(tid)}"${sel.has(tid) ? " checked" : ""}> ${esc(tid)}</label>`).join("");
  return `<div class="check-grid">${items || `<span class="text-muted" style="font-size:11px;padding:4px">No other towers defined.</span>`}</div>`;
}

// ═════════════════════════════════════════════════════════════════════════════
// EMPTY-STATE CTAs (delegated)
// ═════════════════════════════════════════════════════════════════════════════
function detailEmpty(text, addKind, addLabel) {
  return `<div class="empty-state">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
    <p>${esc(text)}</p>
    <button class="btn btn-outline empty-cta" data-add="${esc(addKind)}">${ICO.plus} ${esc(addLabel)}</button>
  </div>`;
}
document.addEventListener("click", e => {
  const cta = e.target.closest?.(".empty-cta[data-add]");
  if (cta) $("btn-add-" + cta.dataset.add)?.click();
});

// ═════════════════════════════════════════════════════════════════════════════
// COMMAND PALETTE (⌘K) — jump to any entity or run an action
// ═════════════════════════════════════════════════════════════════════════════
let cmdkActive = 0;
function buildCmdkItems() {
  const items = [];
  for (const [t, label] of STUDIO_TABS) items.push({ kind: "Go", label: "Go to " + label, run: () => runStudioCommand(`navigate.${t}`) });
  items.push({ kind: "Go", label: "Open AI Chat", run: () => runStudioCommand("project.ai_designer") });
  items.push({ kind: "Run", label: "Run balance analysis", run: () => runStudioCommand("project.balance") });
  items.push({ kind: "New", label: "Add enemy", run: () => { switchTab("enemies"); $("btn-add-enemy")?.click(); } });
  items.push({ kind: "New", label: "Add tower", run: () => { switchTab("towers"); $("btn-add-tower")?.click(); } });
  items.push({ kind: "New", label: "Add mission", run: () => { switchTab("missions"); $("btn-add-mission")?.click(); } });
  if (S.selectedEnemyId) items.push({ kind: "Edit", label: "Duplicate selected enemy", sub: S.selectedEnemyId, run: () => runStudioCommand("entity.duplicate", { collection: "enemies", id: S.selectedEnemyId }) });
  if (S.selectedTowerId) items.push({ kind: "Edit", label: "Duplicate selected tower", sub: S.selectedTowerId, run: () => runStudioCommand("entity.duplicate", { collection: "towers", id: S.selectedTowerId }) });
  if (S.selectedMissionEdId) items.push({ kind: "Edit", label: "Duplicate selected mission", sub: S.selectedMissionEdId, run: () => runStudioCommand("entity.duplicate", { collection: "missions", id: S.selectedMissionEdId }) });
  items.push({ kind: "Run", label: "Validate project", hint: "⌘⇧V", run: () => runStudioCommand("project.validate") });
  items.push({ kind: "Run", label: "Run simulation", run: () => runStudioCommand("project.simulate") });
  items.push({ kind: "Run", label: "Save project", hint: "⌘S", run: () => runStudioCommand("file.save") });
  items.push({ kind: "Run", label: "Undo", hint: "⌘Z", run: () => runStudioCommand("edit.undo") });
  items.push({ kind: "Run", label: "Redo", hint: "⌘⇧Z", run: () => runStudioCommand("edit.redo") });
  for (const [id, e] of Object.entries(S.project?.enemies ?? {})) items.push({ kind: "Enemy", label: e.label || id, sub: id, color: enemyColorHex(e), run: () => jumpToEntity("enemy", id) });
  for (const [id, t] of Object.entries(S.project?.towers ?? {})) items.push({ kind: "Tower", label: t.label || id, sub: id, color: towerColorHex(t), run: () => jumpToEntity("tower", id) });
  for (const [id, m] of Object.entries(S.project?.missions ?? {})) items.push({ kind: "Mission", label: m.label || id, sub: id, run: () => jumpToEntity("mission", id) });
  return items;
}
function openCmdk() {
  if (!S.project) return;
  S.cmdkItems = buildCmdkItems();
  cmdkActive = 0;
  $("cmdk-input").value = "";
  renderCmdk("");
  $("cmdk-overlay").classList.remove("hidden");
  $("cmdk-input").focus();
}
function closeCmdk() { $("cmdk-overlay")?.classList.add("hidden"); }
function filteredCmdk(q) {
  const all = S.cmdkItems ?? [];
  q = q.trim().toLowerCase();
  if (!q) return all.slice(0, 60);
  return all.filter(it => `${it.label} ${it.sub ?? ""} ${it.kind}`.toLowerCase().includes(q)).slice(0, 60);
}
function renderCmdk(q) {
  const list = filteredCmdk(q);
  const box = $("cmdk-results");
  box._list = list;
  cmdkActive = Math.max(0, Math.min(cmdkActive, list.length - 1));
  if (!list.length) { box.innerHTML = `<div class="cmdk-empty">No matches.</div>`; return; }
  box.innerHTML = list.map((it, i) =>
    `<div class="cmdk-item${i === cmdkActive ? " active" : ""}" data-i="${i}" role="option">${it.color ? `<span class="ci-sw" style="background:${esc(it.color)}"></span>` : ""}<span class="ci-kind">${esc(it.kind)}</span><span class="ci-label">${esc(it.label)}${it.sub ? ` <span class="text-dim mono" style="font-size:10px">${esc(it.sub)}</span>` : ""}</span>${it.hint ? `<span class="ci-hint">${esc(it.hint)}</span>` : ""}</div>`
  ).join("");
  box.querySelectorAll(".cmdk-item").forEach(el => {
    el.addEventListener("mousemove", () => { if (cmdkActive !== +el.dataset.i) { cmdkActive = +el.dataset.i; box.querySelectorAll(".cmdk-item").forEach(x => x.classList.toggle("active", x === el)); } });
    el.addEventListener("click", () => runCmdk(+el.dataset.i));
  });
  box.querySelector(".cmdk-item.active")?.scrollIntoView({ block: "nearest" });
}
function runCmdk(i) {
  const it = ($("cmdk-results")._list || [])[i];
  if (!it) return;
  closeCmdk();
  Promise.resolve().then(() => it.run()).catch(e => toast("Command failed: " + e.message, "err"));
}
$("cmdk-input")?.addEventListener("input", () => { cmdkActive = 0; renderCmdk($("cmdk-input").value); });
$("cmdk-input")?.addEventListener("keydown", e => {
  const len = ($("cmdk-results")._list || []).length;
  if (e.key === "ArrowDown") { e.preventDefault(); cmdkActive = Math.min(cmdkActive + 1, len - 1); renderCmdk($("cmdk-input").value); }
  else if (e.key === "ArrowUp") { e.preventDefault(); cmdkActive = Math.max(cmdkActive - 1, 0); renderCmdk($("cmdk-input").value); }
  else if (e.key === "Enter") { e.preventDefault(); runCmdk(cmdkActive); }
  else if (e.key === "Escape") { e.preventDefault(); closeCmdk(); }
});
$("cmdk-overlay")?.addEventListener("click", e => { if (e.target === $("cmdk-overlay")) closeCmdk(); });
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    runStudioCommand("view.command_palette");
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// AUTOSAVE DRAFT + RECOVERY (localStorage)
// ═════════════════════════════════════════════════════════════════════════════
let autosaveTimer = null;
function draftKey() { return "towerforge:draft:" + (S.project?.manifest?.name || "untitled"); }
function scheduleAutosave() { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(writeDraft, 800); }
function writeDraft() {
  if (!S.project) return;
  try { localStorage.setItem(draftKey(), JSON.stringify({ savedAt: Date.now(), baseHash: S.contentHash, project: S.project })); }
  catch { /* quota / unavailable — non-fatal */ }
}
function clearDraft() { try { localStorage.removeItem(draftKey()); } catch { /* ignore */ } }
async function maybeRecoverDraft() {
  let draft;
  try { draft = JSON.parse(localStorage.getItem(draftKey()) || "null"); } catch { draft = null; }
  if (!draft?.project) return;
  if (draft.baseHash !== S.contentHash) { clearDraft(); return; }          // server moved on — draft is stale
  if (JSON.stringify(draft.project) === JSON.stringify(S.project)) { clearDraft(); return; } // identical
  const when = new Date(draft.savedAt).toLocaleString();
  const ok = await confirmDialog({ title: "Recover unsaved changes?", message: `A local draft from ${when} has edits that were never saved. Recover them?`, confirmLabel: "Recover", danger: false });
  if (ok) { S.project = draft.project; markDirty(true); renderActiveTab(); toast("Recovered unsaved draft.", "ok"); }
  else clearDraft();
}

// ═════════════════════════════════════════════════════════════════════════════
// CHANGE REVIEW (dirty badge → per-section diff vs loaded server snapshot)
// ═════════════════════════════════════════════════════════════════════════════
function diffSection(base, cur) {
  base = base || {}; cur = cur || {};
  const bk = new Set(Object.keys(base)), ck = Object.keys(cur);
  let added = 0, removed = 0, changed = 0;
  for (const k of ck) { if (!bk.has(k)) added++; else if (JSON.stringify(base[k]) !== JSON.stringify(cur[k])) changed++; }
  for (const k of Object.keys(base)) if (!cur[k]) removed++;
  return { added, removed, changed, total: added + removed + changed };
}
function changeReviewRows(base, cur) {
  const mapSections = [["enemies", "Enemies"], ["towers", "Towers"], ["waveSets", "Wave sets"], ["missions", "Missions"], ["abilities", "Abilities"], ["maps", "Maps"], ["mapSources", "Map sources"]];
  const scalarSections = [["constants", "Constants"], ["currencies", "Currencies"], ["worldMap", "World map"], ["visuals", "Visuals"], ["buildTargets", "Build targets"], ["manifest", "Manifest"], ["defaultMissionId", "Default mission"]];
  let rows = "";
  for (const [key, label] of mapSections) {
    const d = diffSection(base[key], cur[key]);
    if (d.total) rows += `<div class="change-item"><span>${esc(label)}</span><span class="ch-counts">${d.added ? `<span class="ch-add">+${d.added}</span>` : ""}${d.changed ? `<span class="ch-chg">~${d.changed}</span>` : ""}${d.removed ? `<span class="ch-rem">−${d.removed}</span>` : ""}</span></div>`;
  }
  for (const [key, label] of scalarSections)
    if (JSON.stringify(base[key]) !== JSON.stringify(cur[key])) rows += `<div class="change-item"><span>${esc(label)}</span><span class="ch-counts ch-chg">changed</span></div>`;
  return rows;
}

function showChangeReviewBetween(base, cur, title = "Changes") {
  const overlay = $("validation-overlay"), div = $("validation-results");
  div.className = "overlay-body";
  $("val-title").textContent = title;
  $("val-icon").innerHTML = ICO.warn;
  div.innerHTML = changeReviewRows(base, cur) || `<div class="val-item ok">${ICO.check} No content differences detected.</div>`;
  overlay.classList.remove("hidden");
}

function showChangeReview() {
  showChangeReviewBetween(S.serverSnapshot || {}, S.project || {}, "Unsaved changes since load");
}
$("dirty-badge")?.addEventListener("click", () => { if (S.dirty) showChangeReview(); });

// ═════════════════════════════════════════════════════════════════════════════
// BALANCE — simulation-driven win-rate analysis + advisor
// ═════════════════════════════════════════════════════════════════════════════
function renderBalanceTab() {
  const btn = $("btn-run-balance");
  if (btn && !btn.dataset.wired) { btn.dataset.wired = "1"; btn.addEventListener("click", () => runStudioCommand("project.balance")); }
  const mission = $("balance-mission");
  if (mission) {
    const selected = mission.value;
    mission.innerHTML = `<option value="">All missions</option>${Object.entries(S.project?.missions ?? {}).map(([id, value]) => `<option value="${esc(id)}">${esc(value.label || id)}</option>`).join("")}`;
    mission.value = S.project?.missions?.[selected] ? selected : "";
  }
  const box = $("balance-results");
  if (!box) return;
  if (S.balanceReport) renderBalanceReport(S.balanceReport);
  else box.innerHTML = `<div class="empty-state">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18.7 8a6 6 0 1 1-11.4 0"/></svg>
    <p>Run a simulation sweep to grade every mission's difficulty and spot dominant or dead towers.</p>
    <button class="btn btn-outline empty-cta" onclick="document.getElementById('btn-run-balance').click()">Run analysis</button>
  </div>`;
}

async function runBalance() {
  const btn = $("btn-run-balance"), box = $("balance-results");
  if (S.dirty && !(await save())) return;
  if (passiveBalanceTimer) clearTimeout(passiveBalanceTimer);
  passiveBalanceTimer = null;
  balanceRequestSerial += 1;
  if (box) { box.innerHTML = `<div class="empty-state"><span class="spinner"></span><p>Simulating strategies across every mission…</p></div>`; }
  await withButtonSpinner(btn, async () => {
    try {
      const params = new URLSearchParams();
      if ($("balance-mission")?.value) params.set("mission", $("balance-mission").value);
      if ($("balance-seconds")?.value) params.set("seconds", $("balance-seconds").value);
      const report = await apiGet(`/api/balance?${params}`);
      S.previousBalanceReport = S.balanceReport;
      S.balanceReport = report;
      S.balanceReportRevision = S.contentHash;
      renderBalanceReport(report);
      updateBalanceWarningUi();
      const flagged = report.summary.flagged;
      recordActivity("Balance analysis", flagged ? "warning" : "ok", `${report.summary.missions} missions, ${flagged} flagged`);
      renderWorkbench();
      toast(flagged ? `Balance: ${flagged} mission(s) flagged.` : "Balance: no issues found.", flagged ? "warn" : "ok");
    } catch (e) {
      recordActivity("Balance analysis", "error", e.message);
      if (box) box.innerHTML = `<div class="val-item error">${ICO.err}<span>${esc(e.message)}</span></div>`;
      toast("Balance run failed: " + e.message, "err");
    }
  });
}

function balanceInsights(mission) {
  const results = mission.results ?? [];
  const insights = [];
  const nearWon = results.some((result) => result.strategy?.placement === "near_path" && result.win);
  const farLost = results.some((result) => result.strategy?.placement === "far_path" && !result.win);
  if (nearWon && farLost) insights.push("Placement-sensitive: near path wins, far path loses");
  const flat = results.find((result) => result.strategyId === "all_flat");
  const upgraded = results.find((result) => result.strategyId === "all_upgrade");
  if (flat && upgraded) {
    if (!flat.win && upgraded.win) insights.push("Upgrades are required for a reliable win");
    else if (flat.win && upgraded.win && upgraded.towersBuilt < flat.towersBuilt) insights.push("Upgrades reduce required tower count");
    else if (flat.win && !upgraded.win) insights.push("Upgrade economy is counterproductive");
  }
  if (mission.soloWinners?.length === 1) insights.push(`Only ${mission.soloWinners[0]} wins solo`);
  else if ((mission.soloWinners?.length ?? 0) > 1) insights.push(`${mission.soloWinners.length} towers can win solo`);
  const leaks = results.map((result) => result.leaks ?? 0);
  if (leaks.length && Math.max(...leaks) > 0) insights.push(`Leak range: ${Math.min(...leaks)}-${Math.max(...leaks)}`);
  return insights;
}

function missionBalanceSignals(mission) {
  const flags = [...(mission.flags ?? [])];
  const knownMessages = new Set(flags.map((flag) => flag.message));
  for (const message of balanceInsights(mission)) {
    if (!knownMessages.has(message)) flags.push({ code: "STRATEGY_INSIGHT", severity: "warning", message });
  }
  return flags;
}

function renderBalanceReport(report) {
  const box = $("balance-results");
  if (!box) return;
  const towerLabel = (id) => S.project?.towers?.[id]?.label || id;
  let html = `<div class="bal-meta" style="margin-bottom:14px"><span><b>${report.summary.missions}</b> missions</span><span><b>${report.summary.winnable}</b> winnable</span><span><b>${report.summary.flagged}</b> flagged</span><span class="text-dim">${report.generatedWith.strategiesPerMission} strategies × ${report.generatedWith.simSeconds}u each</span></div>`;

  for (const m of report.missions) {
    const pct = Math.round(m.winRate * 100);
    const cls = pct >= 70 ? "good" : pct >= 40 ? "warn" : "bad";
    const usage = Object.entries(m.towerUsage);
    const maxBuilt = Math.max(1, ...usage.map(([, u]) => u.built));
    const previous = S.previousBalanceReport?.missions?.find((item) => item.missionId === m.missionId);
    const delta = previous ? pct - Math.round(previous.winRate * 100) : null;
    const insights = balanceInsights(m);
    const strategyRows = (m.results ?? []).map((result) => `<tr>
      <td title="${esc(result.label)}">${esc(result.label)}</td>
      <td>${esc(result.strategy?.placement ?? "-")}</td>
      <td>${result.strategy?.upgrade ? "yes" : "no"}</td>
      <td class="${result.win ? "victory" : "defeat"}">${esc(result.outcome)}</td>
      <td>${Math.round((result.coreHpRemaining ?? 0) * 100)}%</td>
      <td>${result.leaks ?? 0}</td>
      <td>${result.elapsed ?? "-"}u</td>
    </tr>`).join("");
    html += `<div class="bal-card">
      <div class="bal-head"><span class="bal-name">${esc(m.label)}</span><span class="bal-id">${esc(m.missionId)}</span>${delta == null ? "" : `<span class="bal-delta ${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}">${delta > 0 ? "+" : ""}${delta}pp vs previous</span>`}</div>
      <div class="bal-winrate"><div class="bal-bar ${cls}"><span style="width:${pct}%"></span></div><span class="bal-winpct">${pct}%</span></div>
      <div class="bal-meta">
        <span>core left <b>${Math.round(m.avgCoreHpRemaining * 100)}%</b></span>
        ${m.avgClearTime != null ? `<span>clear <b>~${m.avgClearTime}u</b></span>` : ""}
        ${m.soloWinners.length ? `<span>solo wins <b>${m.soloWinners.map(esc).join(", ")}</b></span>` : ""}
        <span>strategies <b>${m.strategyCount}</b></span>
      </div>
      ${usage.length ? `<div class="bal-towers">${usage.map(([id, u]) =>
        `<div class="bal-tower"><span class="tname">${esc(towerLabel(id))}</span><span class="tbar"><span style="width:${Math.round(u.built / maxBuilt * 100)}%"></span></span><span class="mono text-muted" style="font-size:10.5px">${u.inWins}/${u.built} in wins</span></div>`
      ).join("")}</div>` : ""}
      ${insights.length ? `<div class="bal-insights">${insights.map((insight) => `<span class="bal-insight">${esc(insight)}</span>`).join("")}</div>` : ""}
      ${m.flags.length ? m.flags.map(flagHtml).join("") : `<div class="bal-flag ok">${ICO.check}<span>No balance issues detected.</span></div>`}
      <details class="bal-strategies"><summary>${m.strategyCount} strategy runs · inputs and outcomes</summary>
        <table class="bal-strategy-table"><thead><tr><th style="width:28%">Strategy</th><th>Placement</th><th>Upgrade</th><th>Outcome</th><th>Core</th><th>Leaks</th><th>Time</th></tr></thead><tbody>${strategyRows}</tbody></table>
      </details>
      <div class="bal-card-actions"><button class="btn btn-outline" type="button" data-ai-balance-mission="${esc(m.missionId)}">Ask AI</button></div>
    </div>`;
  }
  box.innerHTML = html;
  box.querySelectorAll("[data-jump-tower]").forEach(el => el.addEventListener("click", () => jumpToEntity("tower", el.dataset.jumpTower)));
  box.querySelectorAll("[data-ai-balance-mission]").forEach((button) => button.addEventListener("click", () => {
    const mission = report.missions.find((item) => item.missionId === button.dataset.aiBalanceMission);
    if (!mission) return;
    openAiWithPrompt(`Review balance for ${mission.missionId}: ${Math.round(mission.winRate * 100)}% win rate, ${Math.round(mission.avgCoreHpRemaining * 100)}% average core HP, flags: ${mission.flags.map((flag) => flag.message).join("; ") || "none"}. Explain the most useful next change and verify it with the balance tools. Do not edit yet.`, { mode: "ask" });
  }));
}

function flagHtml(flag) {
  const ico = flag.severity === "error" ? ICO.err : flag.severity === "warning" ? ICO.warn : ICO.check;
  const jump = flag.entityId ? ` data-jump-tower="${esc(flag.entityId)}" style="cursor:pointer"` : "";
  return `<div class="bal-flag ${esc(flag.severity)}"${jump}>${ico}<span>${esc(flag.message)}${flag.suggestion ? `<span class="bf-sug">→ ${esc(flag.suggestion)}</span>` : ""}</span></div>`;
}

// ═════════════════════════════════════════════════════════════════════════════
// THEME + DENSITY
// ═════════════════════════════════════════════════════════════════════════════
const SUN_ICON  = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const MOON_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
function currentTheme() { try { return localStorage.getItem("towerforge:theme") || "dark"; } catch { return "dark"; } }
function resolvedDark(theme) { return theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches); }
function applyTheme(theme) {
  try { localStorage.setItem("towerforge:theme", theme); } catch { /* ignore */ }
  const dark = resolvedDark(theme);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  const btn = $("btn-theme");
  if (btn) { btn.innerHTML = dark ? SUN_ICON : MOON_ICON; btn.title = dark ? "Switch to light theme" : "Switch to dark theme"; }
}
function applyDensity(d) {
  try { localStorage.setItem("towerforge:density", d); } catch { /* ignore */ }
  document.documentElement.setAttribute("data-density", d);
}
function toggleTheme() {
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  if (S.project && S.activeTab === "settings") renderSettingsTab();
}
$("btn-theme")?.addEventListener("click", () => runStudioCommand("view.toggle_theme"));
applyTheme(currentTheme());
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (currentTheme() === "system") applyTheme("system"); });

// ── Sidebar ────────────────────────────────────────────────────────────────────────────────
function applySidebarCollapsed(collapsed, persist = true) {
  document.documentElement.setAttribute("data-sidebar", collapsed ? "collapsed" : "expanded");
  const toggle = $("sidebar-toggle");
  const action = collapsed ? "Expand navigation" : "Collapse navigation";
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", action);
    toggle.title = action;
  }
  for (const tab of document.querySelectorAll(".nav-tab")) {
    const label = tab.querySelector("span")?.textContent?.trim() || tab.dataset.tab || "Section";
    tab.setAttribute("aria-label", label);
    if (collapsed) tab.title = label;
    else tab.removeAttribute("title");
  }
  if (persist) {
    try { localStorage.setItem("towerforge:sidebar-collapsed", collapsed ? "1" : "0"); }
    catch { /* ignore */ }
  }
}

function setupSidebar() {
  const collapsed = document.documentElement.getAttribute("data-sidebar") === "collapsed";
  applySidebarCollapsed(collapsed, false);
  $("sidebar-toggle")?.addEventListener("click", () => {
    applySidebarCollapsed(document.documentElement.getAttribute("data-sidebar") !== "collapsed");
  });
  $("sidebar-about")?.addEventListener("click", () => runStudioCommand("help.about"));
}

// ═════════════════════════════════════════════════════════════════════════════
// ONBOARDING — first-run welcome + help
// ═════════════════════════════════════════════════════════════════════════════
function showWelcome() { $("welcome-overlay")?.classList.remove("hidden"); $("btn-welcome-start")?.focus(); }
function closeWelcome() { $("welcome-overlay")?.classList.add("hidden"); try { localStorage.setItem("towerforge:welcomed", "1"); } catch { /* ignore */ } }
$("btn-help")?.addEventListener("click", () => runStudioCommand("help.getting_started"));
$("btn-close-welcome")?.addEventListener("click", closeWelcome);
$("btn-welcome-start")?.addEventListener("click", closeWelcome);
$("welcome-overlay")?.addEventListener("click", e => { if (e.target === $("welcome-overlay")) closeWelcome(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("welcome-overlay")?.classList.contains("hidden")) closeWelcome(); });
try { if (!localStorage.getItem("towerforge:welcomed")) setTimeout(showWelcome, 400); } catch { /* ignore */ }

// ═════════════════════════════════════════════════════════════════════════════
// DESKTOP COMMAND BRIDGE + GUARDED PROJECT LIFECYCLE
// ═════════════════════════════════════════════════════════════════════════════
const DESKTOP_COMMAND_EVENT = "towerforge:desktop-command";
let desktopUiSyncTimer = null;
let unsavedResolver = null;
let newProjectParentSelected = false;

function desktopApi() { return window.__TAURI__ ?? null; }
function isDesktopShell() { return Boolean(desktopApi()?.core?.invoke); }
function desktopInvoke(command, args = {}) {
  const invoke = desktopApi()?.core?.invoke;
  if (!invoke) return Promise.reject(new Error("This command is available in the desktop app."));
  return invoke(command, args);
}

for (const link of document.querySelectorAll("[data-external-link]")) {
  link.addEventListener("click", event => {
    if (!isDesktopShell()) return;
    event.preventDefault();
    desktopInvoke("desktop_open_external", { url: link.href })
      .catch(error => toast("Could not open link: " + String(error), "err"));
  });
}

function scheduleDesktopUiSync(delay = 80) {
  if (!isDesktopShell()) return;
  clearTimeout(desktopUiSyncTimer);
  desktopUiSyncTimer = setTimeout(() => {
    desktopInvoke("desktop_sync_ui_state", {
      payload: {
        projectName: S.project?.manifest?.name || "Untitled",
        dirty: Boolean(S.dirty),
        canUndo: Boolean(H.undo.length),
        canRedo: Boolean(H.redo.length),
        activeTab: S.activeTab,
        language: getLanguage()
      }
    }).catch(error => console.warn("Desktop state sync failed:", error));
  }, delay);
}

window.addEventListener("towerforge:languagechange", () => {
  renderActiveTab();
  updateSidebarCollapseUi();
  applyTheme(currentTheme());
  scheduleDesktopUiSync(0);
});

function unsavedChangesDialog() {
  const overlay = $("unsaved-overlay");
  if (!overlay) return Promise.resolve(window.confirm("Discard unsaved changes?") ? "discard" : "cancel");
  overlay.classList.remove("hidden");
  $("unsaved-save")?.focus();
  return new Promise(resolve => { unsavedResolver = resolve; });
}

function closeUnsavedDialog(result) {
  $("unsaved-overlay")?.classList.add("hidden");
  const resolve = unsavedResolver;
  unsavedResolver = null;
  resolve?.(result);
}

async function guardUnsavedChanges() {
  if (!S.dirty) return true;
  const result = await unsavedChangesDialog();
  if (result === "save") return save();
  return result === "discard";
}

$("unsaved-save")?.addEventListener("click", () => closeUnsavedDialog("save"));
$("unsaved-discard")?.addEventListener("click", () => closeUnsavedDialog("discard"));
$("unsaved-cancel")?.addEventListener("click", () => closeUnsavedDialog("cancel"));
$("unsaved-overlay")?.addEventListener("click", event => { if (event.target === $("unsaved-overlay")) closeUnsavedDialog("cancel"); });

function showNewProjectDialog() {
  if (!isDesktopShell()) { toast("New Project is available in the desktop app.", "warn"); return; }
  newProjectParentSelected = false;
  $("new-project-form")?.reset();
  $("new-project-parent").value = "";
  $("new-project-error").textContent = "";
  $("new-project-overlay")?.classList.remove("hidden");
  $("new-project-name")?.focus();
}

function closeNewProjectDialog() {
  $("new-project-overlay")?.classList.add("hidden");
  newProjectParentSelected = false;
}

async function chooseNewProjectParent() {
  try {
    const selected = await desktopInvoke("desktop_choose_project_parent");
    if (selected) {
      newProjectParentSelected = true;
      $("new-project-parent").value = selected;
      $("new-project-error").textContent = "";
    }
  } catch (error) {
    $("new-project-error").textContent = String(error);
  }
}

$("new-project-browse")?.addEventListener("click", chooseNewProjectParent);
$("new-project-close")?.addEventListener("click", closeNewProjectDialog);
$("new-project-cancel")?.addEventListener("click", closeNewProjectDialog);
$("new-project-overlay")?.addEventListener("click", event => { if (event.target === $("new-project-overlay")) closeNewProjectDialog(); });
$("new-project-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const name = $("new-project-name").value.trim();
  const errorBox = $("new-project-error");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(name)) {
    errorBox.textContent = "Use letters, digits, hyphens, or underscores.";
    return;
  }
  if (!newProjectParentSelected) {
    errorBox.textContent = "Choose a project location.";
    return;
  }
  const button = $("new-project-create");
  button.disabled = true;
  errorBox.textContent = "";
  try {
    await desktopInvoke("desktop_create_project", {
      name,
      templateName: $("new-project-template").value
    });
    closeNewProjectDialog();
  } catch (error) {
    errorBox.textContent = String(error);
  } finally {
    button.disabled = false;
  }
});

function showAbout() { $("about-overlay")?.classList.remove("hidden"); $("about-close")?.focus(); }
function closeAbout() { $("about-overlay")?.classList.add("hidden"); }
$("about-close")?.addEventListener("click", closeAbout);
$("about-overlay")?.addEventListener("click", event => { if (event.target === $("about-overlay")) closeAbout(); });

async function runDesktopLeaveAction(action) {
  if (!(await guardUnsavedChanges())) return;
  try {
    if (action.id === "file.new") showNewProjectDialog();
    else if (action.id === "file.open") await desktopInvoke("desktop_open_project");
    else if (action.id === "file.open_recent") await desktopInvoke("desktop_open_recent", { recentIndex: action.recentIndex });
    else if (action.id === "lifecycle.close") await desktopInvoke("desktop_finish_lifecycle", { action: "close" });
    else if (action.id === "lifecycle.quit") await desktopInvoke("desktop_finish_lifecycle", { action: "quit" });
  } catch (error) {
    toast("Desktop command failed: " + String(error), "err");
  }
}

const STUDIO_COMMANDS = new Map([
  ["file.save", () => save()],
  ["app.settings", () => switchTab("settings")],
  ["edit.undo", () => historyUndo()],
  ["edit.redo", () => historyRedo()],
  ["view.command_palette", () => $("cmdk-overlay")?.classList.contains("hidden") ? openCmdk() : closeCmdk()],
  ["view.toggle_theme", () => toggleTheme()],
  ["project.validate", () => validateProject()],
  ["project.simulate", () => simulateSelectedMission()],
  ["project.compile_maps", () => compileMaps()],
  ["project.balance", async () => { switchTab("balance"); await runBalance(); }],
  ["project.playtest", () => switchTab("playtest")],
  ["project.build_targets", () => switchTab("buildtargets")],
  ["project.ai_designer", () => setAiDockOpen(true)],
  ["entity.duplicate", payload => duplicateStudioEntity(payload.collection, payload.id)],
  ["help.getting_started", () => showWelcome()],
  ["help.keyboard_shortcuts", () => showWelcome()],
  ["help.about", () => showAbout()],
]);

async function runStudioCommand(id, payload = {}) {
  if (id.startsWith("navigate.")) {
    const tab = id.slice("navigate.".length);
    if (tab === "ai") {
      setAiDockOpen(true);
      return;
    }
    if (STUDIO_TABS.some(([candidate]) => candidate === tab)) switchTab(tab);
    return;
  }
  if (["file.new", "file.open", "file.open_recent", "lifecycle.close", "lifecycle.quit"].includes(id)) {
    await runDesktopLeaveAction({ id, ...payload });
    return;
  }
  const command = STUDIO_COMMANDS.get(id);
  if (command) return command(payload);
}

async function setupDesktopBridge() {
  window.addEventListener(DESKTOP_COMMAND_EVENT, event => {
    const payload = event.detail ?? {};
    runStudioCommand(payload.id, payload).catch(error => toast("Command failed: " + error.message, "err"));
  });
  const listen = desktopApi()?.event?.listen;
  if (!listen) return;
  await listen(DESKTOP_COMMAND_EVENT, event => {
    const payload = event.payload ?? {};
    runStudioCommand(payload.id, payload).catch(error => toast("Command failed: " + error.message, "err"));
  });
}

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (!$("unsaved-overlay")?.classList.contains("hidden")) closeUnsavedDialog("cancel");
  if (!$("new-project-overlay")?.classList.contains("hidden")) closeNewProjectDialog();
  if (!$("about-overlay")?.classList.contains("hidden")) closeAbout();
  else if (AI.dockOpen) setAiDockOpen(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────────────────
setupDesktopBridge().catch(error => console.warn("Desktop bridge setup failed:", error));
setupSidebar();
setupAiDock();
loadAppInfo();
load();
