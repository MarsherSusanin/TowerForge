import { createCanvasRenderer } from "/renderer/index.mjs";

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
  contentHash:          null,
  activeTab:            "waves",
  // Per-tab selections
  waveMissionId:        null,   // selected mission in wave editor
  selectedEnemyId:      null,
  selectedTowerId:      null,
  selectedMissionEdId:  null,
  selectedRegionId:     null,
  selectedNodeId:       null,   // missionId of selected node
  selectedMapSourceName: null,
  mapPaintMode:          "inspect",
};

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
function markDirty(isDirty, skipHistory) {
  S.dirty = isDirty;
  const badge = $("dirty-badge");
  const btn   = $("btn-save");
  if (badge) badge.classList.toggle("visible", isDirty);
  if (btn) { btn.classList.toggle("dirty", isDirty); btn.disabled = !isDirty; }
  if (isDirty) {
    if (!skipHistory) scheduleHistoryCommit();
    scheduleValidation();
    scheduleAutosave();
    PT.dirty = true; // unsaved edits should rebuild the live playtest on next open
  }
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
  if (!r.ok) throw new Error(d.error ?? `${r.status}`);
  return d;
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
    markDirty(false);
    historyInit();
    PT.dirty = true; // force playtest to rebuild from the freshly loaded project
    const nameEl = $("project-name");
    if (nameEl) nameEl.textContent = data.manifest?.name ?? "Untitled";
    setStatus("Loaded");
    renderActiveTab();
    await maybeRecoverDraft();
  } catch (e) {
    setStatus("Load error");
    toast("Failed to load project: " + e.message, "err");
  }
}

async function save() {
  if (!S.dirty) return;
  const btn = $("btn-save");
  if (btn) btn.disabled = true;
  setStatus("Saving…");
  try {
    const body = {
      contentHash:      S.contentHash,
      enemies:          S.project.enemies,
      towers:           S.project.towers,
      waveSets:         S.project.waveSets,
      missions:         S.project.missions,
      abilities:        S.project.abilities,
      constants:        S.project.constants,
      defaultMissionId: S.project.defaultMissionId,
      worldMap:         S.project.worldMap,
      visuals:          S.project.visuals,
      mapSources:       S.project.mapSources,
      manifest:         S.project.manifest,
      buildTargets:     S.project.buildTargets,
    };
    const res = await apiPost("/api/project/save", body);
    S.contentHash = res.newHash;
    S.serverSnapshot = deep(S.project); // saved state becomes the new baseline
    clearDraft();
    markDirty(false);
    setStatus("Saved");
    toast("Project saved.", "ok");
  } catch (e) {
    if (e.message?.includes("changed on disk")) {
      toast("Conflict — file changed externally. Reload to re-sync.", "warn");
      setStatus("Conflict");
    } else {
      toast("Save failed: " + e.message, "err");
      setStatus("Save error");
    }
    if (btn) btn.disabled = false;
  }
}

// ── Tab navigation ────────────────────────────────────────────────────────────
function switchTab(tab) {
  S.activeTab = tab;
  document.querySelectorAll(".nav-tab").forEach(t =>
    t.classList.toggle("active", t.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach(p =>
    p.classList.toggle("active", p.id === `tab-${tab}`));
  renderActiveTab();
}

function renderActiveTab() {
  if (!S.project) return;
  const t = S.activeTab;
  if (t === "waves")        renderWavesTab();
  else if (t === "enemies") renderEnemiesTab();
  else if (t === "towers")  renderTowersTab();
  else if (t === "missions") renderMissionsTab();
  else if (t === "worldmap") renderWorldMapTab();
  else if (t === "maps") renderMapsTab();
  else if (t === "playtest") renderPlaytestTab();
  else if (t === "balance") renderBalanceTab();
  else if (t === "assets") renderAssetsTab();
  else if (t === "settings") renderSettingsTab();
  else if (t === "buildtargets") renderBuildTargetsTab();
  refreshValidationUI();
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
  const id = "enemy_" + Math.random().toString(36).slice(-6);
  if (!S.project.enemies) S.project.enemies = {};
  S.project.enemies[id] = {
    id, label: "New Enemy",
    maxHp: 10, speed: 1, coreDamage: 1,
    coinReward: 1, reward: { coins: 1 },
    color: "#888888", hitRadius: 0.5,
  };
  S.selectedEnemyId = id;
  markDirty(true); renderEnemiesTab();
});

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
      <button class="btn btn-danger" id="enemy-del-btn">Delete</button>
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
        <div class="field"><label>Coin Reward</label><input id="ef-coinReward" type="number" min="0" value="${e.reward?.coins ?? e.coinReward ?? 0}"></div>
        <div class="field"><label>OakRoots Reward</label><input id="ef-oakRoots" type="number" min="0" value="${e.reward?.oakRoots ?? 0}"></div>
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

      <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
        <input id="ef-armor-enable" type="checkbox"${e.armor?" checked":""}>
        <label style="margin:0;font-size:12px">Armor (oak_bolete_only)</label>
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
    coinReward:  parseFloat($("ef-coinReward")?.value)  || 0,
    reward: {
      ...(e.reward ?? {}),
      coins:    parseFloat($("ef-coinReward")?.value)   || 0,
      oakRoots: parseFloat($("ef-oakRoots")?.value)     || 0,
    },
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

  // Armor
  if ($("ef-armor-enable")?.checked) { updated.armor = { kind: "oak_bolete_only" }; }
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
        <span class="tag">${t.cost?.coins ?? 0}c${t.cost?.oakRoots ? " + " + t.cost.oakRoots + "r" : ""}</span>
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
  const id = "tower_" + Math.random().toString(36).slice(-6);
  if (!S.project.towers) S.project.towers = {};
  S.project.towers[id] = {
    id, label: "New Tower",
    cost: { coins: 4 }, footprintRadius: 1, range: 5,
    attack: { kind: "honey", fireRate: 1, damagePerMushroom: 0.5, startingMushrooms: 3, maxMushrooms: 10, upgradeCost: 3 },
  };
  S.selectedTowerId = id;
  markDirty(true); renderTowersTab();
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
  const kinds = ["honey","chaga","oak_bolete","chanterelle","slippery_jack","support","support_buff"];

  detail.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:10px">
        ${entityVisual("towers", id, towerColorHex(t), true)}
        <div>
          <div style="font-size:15px;font-weight:600">${esc(t.label || id)}</div>
          <div class="mono text-muted" style="font-size:11px">${esc(id)}</div>
        </div>
      </div>
      <button class="btn btn-danger" id="tower-del-btn">Delete</button>
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
        <div class="field"><label>Cost (coins)</label><input id="tf-cost-coins" type="number" min="0" value="${t.cost?.coins ?? 0}"></div>
        <div class="field"><label>Cost (oakRoots)</label><input id="tf-cost-oak" type="number" min="0" value="${t.cost?.oakRoots ?? 0}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Footprint Radius${helpIcon("How many hex rings the tower occupies. 0 = a single tile; 1 = a 7-tile cluster.")}</label><input id="tf-footprint" type="number" step="0.5" min="0" value="${t.footprintRadius ?? 1}"></div>
        <div class="field"><label>Range${helpIcon("Targeting radius in hex tiles.")}</label><input id="tf-range" type="number" step="0.5" min="0.5" value="${t.range ?? 5}"></div>
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
    towers[id].attack = { ...(towers[id].attack ?? {}), kind: newKind };
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

  switch (a.kind) {
    case "honey":
      return `${title("Honey Attack")}
        <div class="form-row">${v("fireRate", 1, 0.05, "Fire Rate", "Shots per time-unit.")}${v("damagePerMushroom", 0.5, 0.05, "Damage / Mushroom")}</div>
        <div class="form-row">${v("startingMushrooms", 3, 1, "Starting Mushrooms")}${v("maxMushrooms", 10, 1, "Max Mushrooms")}${v("upgradeCost", 2, 1, "Upgrade Cost", "Coins per added mushroom.")}</div>`;
    case "chaga":
      return `${title("Chaga Attack")}
        <div class="form-row">${v("pulseRate", 1, 0.05, "Pulse Rate")}${v("pulseDamage", 0.5, 0.05, "Pulse Damage")}</div>
        <div class="form-row">${v("sporeDamagePerUnit", 0.1, 0.01, "Spore Dmg / Unit", "Lingering damage applied per time-unit after leaving the aura.")}${v("sporeDuration", 30, 1, "Spore Duration")}</div>
        ${lvl("pulseRateByLevel", [1, 1.25, 1.6], "Pulse Rate by Level")}
        ${costs("Upgrade Costs")}`;
    case "oak_bolete":
      return `${title("Oak Bolete Attack")}
        <div class="form-row">${v("interval", 2.4, 0.05, "Interval (s)", "Seconds between shots.")}${v("damage", 4, 0.5, "Damage")}</div>
        <div class="form-row"><div class="field"><label>Target Priority${helpIcon("Which enemy this tower aims at first.")}</label>
          <select class="af-sel" data-f="targetPriority">
            <option value="fastest_ahead"${a.targetPriority === "fastest_ahead" ? " selected" : ""}>fastest_ahead</option>
            <option value="largest_hp"${a.targetPriority === "largest_hp" ? " selected" : ""}>largest_hp</option>
          </select></div></div>
        ${lvl("rangeByLevel", [6, 7, 8], "Range by Level", { step: 0.5 })}
        ${costs("Upgrade Costs")}`;
    case "chanterelle":
      return `${title("Chanterelle Attack")}
        <div class="form-row">${v("fireRate", 1.4, 0.05, "Fire Rate")}${v("damage", 1, 0.5, "Damage")}</div>
        ${lvl("maxTargetsByLevel", [1, 2, 3, 4], "Max Targets by Level", { int: true }, "How many flying enemies it can hit at once, per level.")}
        ${costs("Upgrade Costs")}`;
    case "slippery_jack":
      return `${title("Slippery Jack Attack")}
        <div class="form-row">${v("interval", 1.7, 0.05, "Interval (s)")}${v("damage", 0.32, 0.01, "Damage")}${v("splashDamage", 0.14, 0.01, "Splash Damage")}</div>
        <div class="form-row">${v("splashRadius", 1, 0.1, "Splash Radius")}${slider("slowFactor", 0.55, "Slow Factor", { min: 0.05, max: 0.95, step: 0.05 }, "Speed multiplier while slowed — must be below 1.")}${v("slowDuration", 4, 0.5, "Slow Duration (s)")}</div>
        <div class="form-row">${v("armoredChipDamage", 0.08, 0.01, "Armored Chip Dmg", "Capped damage dealt to oak-bolete-armored enemies.")}</div>
        ${lvl("intervalByLevel", [1.7, 1.45, 1.2], "Interval by Level")}
        ${costs("Upgrade Costs")}`;
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
}

function bindAttackFieldListeners(id) {
  const towers = S.project.towers;
  const attack = () => towers[id]?.attack ?? {};
  const refresh = () => { const box = $("attack-fields"); if (box) { box.innerHTML = buildAttackFields(towers[id].attack); bindAttackFieldListeners(id); } };

  document.querySelectorAll(".af").forEach(inp =>
    inp.addEventListener("change", () => { attack()[inp.dataset.f] = parseFloat(inp.value) || 0; markDirty(true); }));
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
      const o = {}; if (map[i].coins) o.coins = map[i].coins; if (map[i].oakRoots) o.oakRoots = map[i].oakRoots; return o;
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
    cost: {
      coins:    parseFloat($("tf-cost-coins")?.value) || 0,
      oakRoots: parseFloat($("tf-cost-oak")?.value)   || 0,
    },
    attack: t.attack ?? {},
  };
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
    div.className = "entity-item" + (id === S.selectedMissionEdId ? " active" : "");
    const badges = [];
    if (m.availability === "comingSoon") badges.push(`<span class="tag">soon</span>`);
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
  const id = "mission_" + Math.random().toString(36).slice(-6);
  const firstMap    = Object.keys(S.project.maps ?? {})[0] ?? "";
  const firstWaveSet = Object.keys(S.project.waveSets ?? {})[0] ?? "";
  if (!S.project.missions) S.project.missions = {};
  S.project.missions[id] = {
    id, label: "New Mission", description: "", availability: "playable",
    mapId: firstMap, waveSetId: firstWaveSet,
    startingCoreHp: 20, startingResources: { coins: 6, oakRoots: 0 },
    prepTimeUnits: 20, buildTowerIds: [], abilityIds: [],
  };
  S.selectedMissionEdId = id;
  markDirty(true); renderMissionsTab();
});

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

  detail.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:15px;font-weight:600">${esc(m.label || id)}</div>
        <div class="mono text-muted" style="font-size:11px">${esc(id)}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline" id="mission-sim-btn">Sim</button>
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
        <div class="field"><label>Starting Coins</label><input id="mf-coins" type="number" min="0" value="${m.startingResources?.coins ?? 6}"></div>
        <div class="field"><label>Starting OakRoots</label><input id="mf-oak" type="number" min="0" value="${m.startingResources?.oakRoots ?? 0}"></div>
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

  detail.querySelectorAll("input, select, textarea").forEach(inp => {
    inp.addEventListener("change", () => persistMission(id));
  });

  $("mission-del-btn")?.addEventListener("click", async () => {
    if (!(await confirmDialog({ title: `Delete mission "${id}"?`, message: "The mission will be removed.", refs: findReferences("mission", id) }))) return;
    delete S.project.missions[id];
    S.selectedMissionEdId = null;
    markDirty(true); renderMissionsTab();
  });

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

  const updated = {
    ...m,
    id:              newId,
    label:           $("mf-label")?.value ?? m.label,
    description:     $("mf-desc")?.value  ?? m.description,
    availability:    $("mf-avail")?.value ?? m.availability,
    mapId:           $("mf-mapId")?.value ?? m.mapId,
    waveSetId:       $("mf-waveSetId")?.value ?? m.waveSetId,
    startingCoreHp:  parseFloat($("mf-coreHp")?.value) || 20,
    startingResources: {
      coins:    parseFloat($("mf-coins")?.value) || 0,
      oakRoots: parseFloat($("mf-oak")?.value)   || 0,
    },
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
  const pathCenterline = Array.from({ length: h }, (_, r) => ({ q: 2, r }));
  // Tiled "terrain" tile layer: all buildable (gid 1), the path column = gid 2.
  const data = new Array(w * h).fill(GID_BY_TERRAIN_C.buildable);
  for (const c of pathCenterline) data[c.r * w + c.q] = GID_BY_TERRAIN_C.path;
  S.project.mapSources[sourceName] = {
    id,
    type: "map",
    orientation: "hexagonal",
    width: w,
    height: h,
    properties: [
      { name: "id", type: "string", value: id },
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
  $("map-default-terrain").onchange = (e) => { setMapProperty(source, "defaultTerrain", e.target.value); markDirty(true); drawSelectedMapSource(); };
  $("map-width-field").onchange = (e) => { source.width = Math.max(1, Number(e.target.value) || 1); markDirty(true); drawSelectedMapSource(); };
  $("map-height-field").onchange = (e) => { source.height = Math.max(1, Number(e.target.value) || 1); markDirty(true); drawSelectedMapSource(); };
  $("map-spawn-field").onchange = (e) => updateMapJsonField(source, "spawnCoord", e.target.value, false);
  $("map-core-field").onchange = (e) => updateMapJsonField(source, "coreCoord", e.target.value, false);
  $("map-path-field").onchange = (e) => updateMapJsonField(source, "pathCenterline", e.target.value, true);
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
    mapRenderer = createCanvasRenderer({ canvas, content: { towers: {}, enemies: {} } });
    window.addEventListener("resize", () => { if (S.activeTab === "maps") drawSelectedMapSource(); });
    canvas.addEventListener("mousedown", e => { mapPainting = true; paintMapAt(e); });
    canvas.addEventListener("mousemove", e => { if (mapPainting) paintMapAt(e); });
    window.addEventListener("mouseup", () => { if (mapPainting) { mapPainting = false; if (S.activeTab === "maps") renderMapSourceDetail(); } });
  }
  mapRenderer.resize();
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
  const mode = S.mapPaintMode;
  if (mode === "spawn") setMapProperty(source, "spawnCoord", JSON.stringify(coord));
  else if (mode === "core") setMapProperty(source, "coreCoord", JSON.stringify(coord));
  else if (mode === "path") {
    const path = def.pathCenterline ?? [];
    if (!path.some(p => p.q === coord.q && p.r === coord.r)) {
      path.push(coord);
      setMapProperty(source, "pathCenterline", JSON.stringify(path));
    }
    paintTerrainTile(source, coord, "path");
  } else {
    paintTerrainTile(source, coord, mode); // buildable / blocked / water
  }
  markDirty(true);
  drawSelectedMapSource();
}

$("btn-map-compile")?.addEventListener("click", async () => {
  if (S.dirty) {
    toast("Save map source changes before compiling.", "warn");
    return;
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
});

function mapSourceToDefinition(source, sourceName) {
  const props = mapProperties(source);
  return {
    id: String(props.id ?? source.id ?? sourceName?.replace(/\.tmj$/, "") ?? "map"),
    width: Number(source.width ?? 1),
    height: Number(source.height ?? 1),
    defaultTerrain: String(props.defaultTerrain ?? source.defaultTerrain ?? "buildable"),
    spawnCoord: parseJsonInput(props.spawnCoord ?? source.spawnCoord, { q: 0, r: 0 }),
    coreCoord: parseJsonInput(props.coreCoord ?? source.coreCoord, { q: 0, r: 0 }),
    pathCenterline: parseJsonInput(props.pathCenterline ?? source.pathCenterline, []),
    pathRoutes: source.pathRoutes ?? parseJsonInput(props.pathRoutes, []),
    terrainOverrides: source.terrainOverrides ?? parseJsonInput(props.terrainOverrides, [])
  };
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
function renderAssetsTab() {
  if (!S.project.visuals) S.project.visuals = { schemaVersion: 1, assetsRoot: "assets", atlases: {}, sprites: {}, bindings: { towers: {}, enemies: {}, tiles: {}, ui: {} } };
  const textarea = $("visuals-json");
  if (textarea) {
    textarea.value = JSON.stringify(S.project.visuals, null, 2);
    textarea.onchange = () => {
      try {
        S.project.visuals = JSON.parse(textarea.value);
        markDirty(true);
        toast("Visual catalog updated.", "ok");
      } catch (e) {
        toast("Invalid visuals JSON: " + e.message, "err");
      }
    };
  }
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
  setupMcpSettings();
}

function setupAppearanceSettings() {
  const themeSel = $("setting-theme"), densitySel = $("setting-density");
  if (themeSel) { themeSel.value = currentTheme(); themeSel.onchange = () => applyTheme(themeSel.value); }
  if (densitySel) { densitySel.value = localStorage.getItem("mycelium:density") || "comfortable"; densitySel.onchange = () => applyDensity(densitySel.value); }
}

// ── MCP integration toggle ──────────────────────────────────────────────────
async function setupMcpSettings() {
  const cb     = $("mcp-enabled");
  const hint   = $("mcp-hint");
  const cfgBox = $("mcp-config");
  const pathEl = $("mcp-path");
  const copyBtn = $("btn-copy-mcp");
  if (!cb) return;

  const apply = (state) => {
    cb.checked = !!state.enabled;
    if (cfgBox) cfgBox.value = JSON.stringify(state.config ?? {}, null, 2);
    if (pathEl) pathEl.textContent = state.mcpJsonPath ?? ".mcp.json";
    if (hint) {
      hint.textContent = state.parseError
        ? `⚠ ${state.mcpJsonPath} exists but is not valid JSON. Fix or remove it before toggling MCP.`
        : state.enabled
          ? `Active — agents that read ${state.mcpJsonPath} can now call the constructor tools.`
          : "Disabled — turn on to expose the constructor tools to AI agents.";
    }
    if (cb) cb.disabled = !!state.parseError;
  };

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
    const fields = ["appId","appName","appTitle","platform","market","storeChannel","webDir","backgroundColor","appVersion"];
    card.innerHTML = `
      <div class="target-card-head">
        <div class="target-card-title">${esc(tid)}</div>
        <span class="badge ${target.platform === "web" ? "badge-ok" : "badge-dim"}">${esc(target.platform ?? "?")}</span>
        <button class="btn btn-outline btn-target-build" data-tid="${esc(tid)}">Build</button>
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
          showBuildResult(tid, result.output);
        } catch (e) {
          toast("Build failed: " + e.message, "err");
          setStatus("Build failed");
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

function showBuildResult(targetId, output) {
  const overlay = $("validation-overlay");
  const div     = $("validation-results");
  const title   = $("val-title");
  const icon    = $("val-icon");
  if (!overlay || !div) return;
  title.textContent = `Build: ${targetId}`;
  icon.innerHTML = ICO.check;
  div.innerHTML = `<div class="val-item ok">${ICO.check}<span>Build completed.</span></div>
    <pre class="build-output">${esc(output || "No build output.")}</pre>`;
  overlay.classList.remove("hidden");
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATE / SIM
// ─────────────────────────────────────────────────────────────────────────────
$("btn-validate")?.addEventListener("click", async () => {
  setStatus("Validating…");
  showOverlayLoading("validation-overlay", "validation-results", "Running full validation…", "val-title", "Validating");
  try {
    const result = await apiGet("/api/validate");
    showValidation(result);
    const ec = result.issues.filter(i => i.severity === "error").length;
    setStatus(ec === 0 ? "Validation: OK" : `Validation: ${ec} error(s)`);
  } catch (e) {
    toast("Validation error: " + e.message, "err");
    setStatus("Validation error");
  }
});

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
  div.innerHTML = html;
  overlay.classList.remove("hidden");
}

$("btn-close-validation")?.addEventListener("click", () => $("validation-overlay").classList.add("hidden"));
$("validation-overlay")?.addEventListener("click", e => { if (e.target === $("validation-overlay")) $("validation-overlay").classList.add("hidden"); });

$("btn-sim")?.addEventListener("click", async () => {
  const missionId = S.waveMissionId ?? S.selectedMissionEdId;
  if (!missionId) { toast("Select a mission first.", "warn"); return; }
  showOverlayLoading("sim-overlay", "sim-results", "Running headless simulation…", "sim-title", "Simulating");
  try {
    const result = await apiGet(`/api/sim/${encodeURIComponent(missionId)}`);
    showSimResult(result);
  } catch (e) { toast("Sim error: " + e.message, "err"); $("sim-overlay")?.classList.add("hidden"); }
});

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
  if (ctrl && (e.key === "s" || e.key === "S")) { e.preventDefault(); save(); }
  if (ctrl && e.shiftKey && e.key === "V")       { e.preventDefault(); $("btn-validate")?.click(); }
  if (e.key === "Escape") {
    $("validation-overlay")?.classList.add("hidden");
    $("sim-overlay")?.classList.add("hidden");
  }
  if (ctrl && (e.key === "r" || e.key === "R")) {
    if (S.dirty && !confirm("You have unsaved changes. Reload anyway?")) { e.preventDefault(); return; }
    e.preventDefault(); load();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATION WIRING
// ─────────────────────────────────────────────────────────────────────────────
$("btn-save")?.addEventListener("click", save);
document.querySelectorAll(".nav-tab").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
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
$("error-pill")?.addEventListener("click", () => { if ((S.clientIssues ?? []).length) showClientValidation(); });

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
const PT = { mod: null, rmod: null, content: null, game: null, renderer: null, raf: null, towerId: null, missionId: null, dirty: true, lastFrame: 0, error: null };
const PT_KIND_COLOR = { honey: "#e8a44a", chaga: "#a07ec8", oak_bolete: "#7eb87e", chanterelle: "#e8c84a", slippery_jack: "#6ea8d8", support: "#7ec8b8", support_buff: "#c87e9c" };

function assembleBalance() {
  const P = S.project;
  return {
    constants: P.constants ?? {},
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
      visuals: S.project.visuals ?? {}
    });
    return true;
  } catch (e) { PT.error = "Cannot build game from project: " + e.message; PT.content = null; return false; }
}
function newPlaytestGame() {
  if (!PT.content) return null;
  const ids = Object.keys(PT.content.missions ?? {});
  if (!PT.missionId || !PT.content.missions[PT.missionId])
    PT.missionId = (PT.content.defaultMissionId && PT.content.missions[PT.content.defaultMissionId]) ? PT.content.defaultMissionId : ids[0];
  if (!PT.missionId) { PT.error = "No playable missions in this project."; PT.game = null; return null; }
  try { PT.game = new PT.mod.MushroomDefenseGame({ missionId: PT.missionId, content: PT.content }); }
  catch (e) { PT.error = "Cannot start mission: " + e.message; PT.game = null; return null; }
  const m = PT.content.missions[PT.missionId];
  const tids = (m.buildTowerIds?.length ? m.buildTowerIds : Object.keys(PT.content.towers));
  PT.towerId = tids[0] ?? null;
  return PT.game;
}
async function renderPlaytestTab() {
  const empty = $("playtest-empty"), stage = $("playtest-stage"), side = $("playtest-side");
  const fail = msg => { empty.style.display = "flex"; empty.querySelector("p").textContent = msg; stage.style.display = "none"; side.style.display = "none"; stopPlaytestLoop(); };
  if (!(await ensurePlaytestEngine())) return fail(PT.error);
  if (PT.dirty || !PT.game) { if (buildPlaytestContent()) newPlaytestGame(); PT.dirty = false; }
  if (PT.error || !PT.game) return fail(PT.error ?? "No playable mission.");
  empty.style.display = "none"; stage.style.display = "flex"; side.style.display = "flex";
  const canvas = $("playtest-canvas");
  if (!PT.renderer) PT.renderer = PT.rmod.createCanvasRenderer({ canvas, content: PT.content, assetBase: "/project-file/" });
  else PT.renderer.content = PT.content;
  if (!PT.audio && PT.amod) PT.audio = PT.amod.createAudioPlayer();
  PT.renderer.resize();
  const sel = $("pt-mission");
  if (sel) { sel.innerHTML = Object.keys(PT.content.missions).map(id => `<option value="${esc(id)}"${id === PT.missionId ? " selected" : ""}>${esc(PT.content.missions[id]?.label || id)}</option>`).join(""); sel.value = PT.missionId; }
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
    btn.className = "pt-tower" + (tid === PT.towerId ? " active" : "");
    btn.innerHTML = `<span class="sw" style="background:${PT_KIND_COLOR[t.attack?.kind] ?? "#7eb87e"}"></span><span class="pt-tname">${esc(t.label || tid)}</span><span class="pt-tcost">${t.cost?.coins ?? 0}c</span>`;
    btn.addEventListener("click", () => { PT.towerId = tid; renderPlaytestPalette(); });
    list.appendChild(btn);
  }
}
function startPlaytestLoop() {
  stopPlaytestLoop();
  PT.lastFrame = performance.now();
  const loop = now => {
    if (S.activeTab !== "playtest" || !PT.game) { PT.raf = null; return; }
    const dt = Math.min(0.05, (now - PT.lastFrame) / 1000);
    PT.lastFrame = now;
    const speed = Number($("pt-speed")?.value) || 0;
    if (speed > 0 && PT.game.getSnapshot().outcome === "playing") {
      const tu = PT.content.constants.timeUnitSeconds || 1;
      PT.game.tick((dt / tu) * speed);
    }
    const rsnap = PT.game.getRenderSnapshot();
    PT.renderer.drawSnapshot(rsnap);
    if (PT.audio && $("pt-sound")?.checked) PT.audio.handleEvents(rsnap.lastEvents);
    updatePlaytestHud();
    PT.raf = requestAnimationFrame(loop);
  };
  PT.raf = requestAnimationFrame(loop);
}
function stopPlaytestLoop() { if (PT.raf) { cancelAnimationFrame(PT.raf); PT.raf = null; } }
function updatePlaytestHud() {
  const s = PT.game.getSnapshot(), set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  const out = $("pt-outcome");
  if (out) { out.textContent = s.outcome; out.className = "v " + (s.outcome === "victory" ? "text-ok" : s.outcome === "defeat" ? "text-err" : ""); }
  set("pt-core", `${Math.ceil(s.coreHp)}/${s.maxCoreHp}`);
  set("pt-res", Object.entries(s.resources).map(([k, v]) => `${k}:${Math.floor(v)}`).join("  "));
  set("pt-wave", `${s.startedWaveCount}/${s.totalWaves} ${s.waveState}`);
  set("pt-enemies", String(s.enemies.length));
  set("pt-towers-count", String(s.towers.length));
}
function ptMsg(result) { const el = $("pt-msg"); if (el) el.textContent = result.ok ? "Tower planted." : (result.reason || "Action rejected."); }
$("pt-mission")?.addEventListener("change", () => { PT.missionId = $("pt-mission").value; newPlaytestGame(); renderPlaytestPalette(); const el = $("pt-msg"); if (el) el.textContent = "Mission loaded — place towers and start a wave."; });
$("pt-start")?.addEventListener("click", () => { PT.audio?.resume(); if (PT.game) ptMsg(PT.game.startNextWave()); });
$("pt-reset")?.addEventListener("click", () => { if (buildPlaytestContent()) { newPlaytestGame(); renderPlaytestPalette(); } const el = $("pt-msg"); if (el) el.textContent = "Run reset."; });
$("pt-speed")?.addEventListener("input", () => { const o = $("pt-speed-out"); if (o) o.textContent = $("pt-speed").value + "×"; });
$("pt-sound")?.addEventListener("change", () => { if ($("pt-sound").checked) PT.audio?.resume(); });
$("playtest-canvas")?.addEventListener("click", e => {
  PT.audio?.resume();
  if (!PT.game || !PT.towerId) return;
  const coord = PT.renderer.pickTile(e, PT.game.getSnapshot().tiles);
  if (coord) ptMsg(PT.game.placeTower(PT.towerId, coord));
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
  if (ctrl && !e.shiftKey && (e.key === "z" || e.key === "Z")) { if (inField) return; e.preventDefault(); historyUndo(); }
  else if (ctrl && ((e.shiftKey && (e.key === "z" || e.key === "Z")) || e.key === "y" || e.key === "Y")) { if (inField) return; e.preventDefault(); historyRedo(); }
  if (e.key === "Escape" && !$("confirm-overlay")?.classList.contains("hidden")) closeConfirm(false);
});

// ═════════════════════════════════════════════════════════════════════════════
// CONTEXTUAL HELP + VISUAL IDENTITY
// ═════════════════════════════════════════════════════════════════════════════
function helpIcon(text) {
  return `<span class="help" tabindex="0" role="img" aria-label="${esc(text)}" title="${esc(text)}">?</span>`;
}
const ATTACK_HELP = {
  honey: "Single-target. Damage scales with the number of mushrooms; upgrading adds mushrooms.",
  chaga: "Area pulse that leaves lingering spore damage on enemies after they leave the aura.",
  oak_bolete: "Long-range single-target sniper — the only weapon that fully pierces oak-bolete armor.",
  chanterelle: "Anti-air. Hits multiple flying targets per volley (count scales by level).",
  slippery_jack: "Splash + slow. Damages nearby enemies and slows them; chips armored enemies.",
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
    `<div class="cost-row" data-idx="${i}"><span class="level-idx">${i + 1}→${i + 2}</span><input class="af-cost" data-idx="${i}" data-field="coins" type="number" min="0" step="1" value="${c?.coins ?? 0}"><span class="cost-unit">coins</span><input class="af-cost" data-idx="${i}" data-field="oakRoots" type="number" min="0" step="1" value="${c?.oakRoots ?? 0}"><span class="cost-unit">roots</span>${iconBtn("trash", "Remove level", "af-cost-del")}</div>`
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
  const tabs = [["waves", "Waves"], ["enemies", "Enemies"], ["towers", "Towers"], ["missions", "Missions"], ["worldmap", "World Map"], ["maps", "Maps"], ["playtest", "Playtest"], ["balance", "Balance"], ["assets", "Assets"], ["settings", "Settings"], ["buildtargets", "Build Targets"]];
  for (const [t, label] of tabs) items.push({ kind: "Go", label: "Go to " + label, run: () => switchTab(t) });
  items.push({ kind: "Run", label: "Run balance analysis", run: () => { switchTab("balance"); runBalance(); } });
  items.push({ kind: "New", label: "Add enemy", run: () => { switchTab("enemies"); $("btn-add-enemy")?.click(); } });
  items.push({ kind: "New", label: "Add tower", run: () => { switchTab("towers"); $("btn-add-tower")?.click(); } });
  items.push({ kind: "New", label: "Add mission", run: () => { switchTab("missions"); $("btn-add-mission")?.click(); } });
  items.push({ kind: "Run", label: "Validate project", hint: "⌘⇧V", run: () => $("btn-validate")?.click() });
  items.push({ kind: "Run", label: "Run simulation", run: () => $("btn-sim")?.click() });
  items.push({ kind: "Run", label: "Save project", hint: "⌘S", run: () => save() });
  items.push({ kind: "Run", label: "Undo", hint: "⌘Z", run: () => historyUndo() });
  items.push({ kind: "Run", label: "Redo", hint: "⌘⇧Z", run: () => historyRedo() });
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
  try { it.run(); } catch (e) { toast("Command failed: " + e.message, "err"); }
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
    $("cmdk-overlay")?.classList.contains("hidden") ? openCmdk() : closeCmdk();
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// AUTOSAVE DRAFT + RECOVERY (localStorage)
// ═════════════════════════════════════════════════════════════════════════════
let autosaveTimer = null;
function draftKey() { return "mycelium:draft:" + (S.project?.manifest?.name || "untitled"); }
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
function showChangeReview() {
  const base = S.serverSnapshot || {}, cur = S.project || {};
  const mapSections = [["enemies", "Enemies"], ["towers", "Towers"], ["waveSets", "Wave sets"], ["missions", "Missions"], ["abilities", "Abilities"], ["maps", "Maps"], ["mapSources", "Map sources"]];
  const scalarSections = [["constants", "Constants"], ["worldMap", "World map"], ["visuals", "Visuals"], ["buildTargets", "Build targets"], ["manifest", "Manifest"], ["defaultMissionId", "Default mission"]];
  let rows = "";
  for (const [key, label] of mapSections) {
    const d = diffSection(base[key], cur[key]);
    if (d.total) rows += `<div class="change-item"><span>${esc(label)}</span><span class="ch-counts">${d.added ? `<span class="ch-add">+${d.added}</span>` : ""}${d.changed ? `<span class="ch-chg">~${d.changed}</span>` : ""}${d.removed ? `<span class="ch-rem">−${d.removed}</span>` : ""}</span></div>`;
  }
  for (const [key, label] of scalarSections)
    if (JSON.stringify(base[key]) !== JSON.stringify(cur[key])) rows += `<div class="change-item"><span>${esc(label)}</span><span class="ch-counts ch-chg">changed</span></div>`;
  const overlay = $("validation-overlay"), div = $("validation-results");
  div.className = "overlay-body";
  $("val-title").textContent = "Unsaved changes since load";
  $("val-icon").innerHTML = ICO.warn;
  div.innerHTML = rows || `<div class="val-item ok">${ICO.check} No differences from the last load.</div>`;
  overlay.classList.remove("hidden");
}
$("dirty-badge")?.addEventListener("click", () => { if (S.dirty) showChangeReview(); });

// ═════════════════════════════════════════════════════════════════════════════
// BALANCE — simulation-driven win-rate analysis + advisor
// ═════════════════════════════════════════════════════════════════════════════
function renderBalanceTab() {
  const btn = $("btn-run-balance");
  if (btn && !btn.dataset.wired) { btn.dataset.wired = "1"; btn.addEventListener("click", runBalance); }
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
  if (box) { box.innerHTML = `<div class="empty-state"><span class="spinner"></span><p>Simulating strategies across every mission…</p></div>`; }
  await withButtonSpinner(btn, async () => {
    try {
      const report = await apiGet("/api/balance");
      S.balanceReport = report;
      renderBalanceReport(report);
      const flagged = report.summary.flagged;
      toast(flagged ? `Balance: ${flagged} mission(s) flagged.` : "Balance: no issues found.", flagged ? "warn" : "ok");
    } catch (e) {
      if (box) box.innerHTML = `<div class="val-item error">${ICO.err}<span>${esc(e.message)}</span></div>`;
      toast("Balance run failed: " + e.message, "err");
    }
  });
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
    html += `<div class="bal-card">
      <div class="bal-head"><span class="bal-name">${esc(m.label)}</span><span class="bal-id">${esc(m.missionId)}</span></div>
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
      ${m.flags.length ? m.flags.map(flagHtml).join("") : `<div class="bal-flag ok">${ICO.check}<span>No balance issues detected.</span></div>`}
    </div>`;
  }
  box.innerHTML = html;
  box.querySelectorAll("[data-jump-tower]").forEach(el => el.addEventListener("click", () => jumpToEntity("tower", el.dataset.jumpTower)));
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
function currentTheme() { try { return localStorage.getItem("mycelium:theme") || "dark"; } catch { return "dark"; } }
function resolvedDark(theme) { return theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches); }
function applyTheme(theme) {
  try { localStorage.setItem("mycelium:theme", theme); } catch { /* ignore */ }
  const dark = resolvedDark(theme);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  const btn = $("btn-theme");
  if (btn) { btn.innerHTML = dark ? SUN_ICON : MOON_ICON; btn.title = dark ? "Switch to light theme" : "Switch to dark theme"; }
}
function applyDensity(d) {
  try { localStorage.setItem("mycelium:density", d); } catch { /* ignore */ }
  document.documentElement.setAttribute("data-density", d);
}
$("btn-theme")?.addEventListener("click", () => {
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  if (S.project && S.activeTab === "settings") renderSettingsTab();
});
applyTheme(currentTheme());
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (currentTheme() === "system") applyTheme("system"); });

// ═════════════════════════════════════════════════════════════════════════════
// ONBOARDING — first-run welcome + help
// ═════════════════════════════════════════════════════════════════════════════
function showWelcome() { $("welcome-overlay")?.classList.remove("hidden"); $("btn-welcome-start")?.focus(); }
function closeWelcome() { $("welcome-overlay")?.classList.add("hidden"); try { localStorage.setItem("mycelium:welcomed", "1"); } catch { /* ignore */ } }
$("btn-help")?.addEventListener("click", showWelcome);
$("btn-close-welcome")?.addEventListener("click", closeWelcome);
$("btn-welcome-start")?.addEventListener("click", closeWelcome);
$("welcome-overlay")?.addEventListener("click", e => { if (e.target === $("welcome-overlay")) closeWelcome(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("welcome-overlay")?.classList.contains("hidden")) closeWelcome(); });
try { if (!localStorage.getItem("mycelium:welcomed")) setTimeout(showWelcome, 400); } catch { /* ignore */ }

// ─────────────────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────────────────
load();
