// build.mjs — Build a .tdproj project into a deployable web bundle.
// Usage: node build.mjs [--project <path>] [--target <targetId>] [--out <dir>]
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  loadEngine,
  loadProjectFiles,
  repoRoot,
  resolveProjectDir,
  selectBuildTarget,
  validateProjectDir
} from "./lib/project-loader.mjs";
import { copyVisualAssets } from "./lib/assets.mjs";
import { parseJsonFlag, printJson } from "./lib/trace.mjs";

function parseArgs() {
  const raw = process.argv.slice(2);
  const result = { projectDir: null, targetId: null, outDir: null, json: parseJsonFlag(raw) };
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "--project" && raw[i + 1]) {
      result.projectDir = raw[i + 1];
      i += 2;
    } else if (raw[i] === "--target" && raw[i + 1]) {
      result.targetId = raw[i + 1];
      i += 2;
    } else if (raw[i] === "--out" && raw[i + 1]) {
      result.outDir = raw[i + 1];
      i += 2;
    } else if (raw[i] === "--json") {
      i += 1;
    } else {
      i += 1;
    }
  }
  return result;
}

const args = parseArgs();
const PROJECT_DIR = resolveProjectDir(args.projectDir, []);

try {
  const { result } = await validateProjectDir(PROJECT_DIR);
  if (!result.ok) {
    if (!args.json) {
      for (const issue of result.issues) {
        if (issue.severity === "error") {
          console.error(`  ✗ [${issue.entityKind}:${issue.entityId}] ${issue.fieldPath} — ${issue.message}`);
        }
      }
    }
    const error = new Error("Build stopped because project validation failed.");
    error.issues = result.issues;
    throw error;
  }

  await loadEngine();
  const files = loadProjectFiles(PROJECT_DIR);
  const [targetId, target] = selectBuildTarget(files.buildTargets, args.targetId);
  if (target.platform !== "web") {
    throw new Error(`Build target "${targetId}" uses platform "${target.platform}". This build command currently supports web targets only.`);
  }

  const outDir = path.resolve(PROJECT_DIR, args.outDir ?? target.webDir ?? "dist");
  assertSafeOutputDir(PROJECT_DIR, outDir);
  emptyDir(outDir);

  const renderer = target.renderer === "phaser" ? "phaser" : "canvas";
  copyDir(path.join(repoRoot, "packages", "engine", "dist"), path.join(outDir, "engine"));
  // Renderer dir ships for both players — the canvas player needs index.mjs, both need audio.mjs.
  copyDir(path.join(repoRoot, "packages", "renderer", "src"), path.join(outDir, "renderer"));
  if (renderer === "phaser") {
    // Vendor Phaser locally so the offline PWA still works (no CDN dependency).
    const phaserSrc = path.join(repoRoot, "packages", "renderer", "vendor", "phaser.min.js");
    if (!fs.existsSync(phaserSrc)) {
      throw new Error("Phaser renderer requested but packages/renderer/vendor/phaser.min.js is missing.");
    }
    fs.mkdirSync(path.join(outDir, "vendor"), { recursive: true });
    fs.copyFileSync(phaserSrc, path.join(outDir, "vendor", "phaser.min.js"));
  }
  const assetCopy = copyVisualAssets(PROJECT_DIR, outDir, files.visuals);
  writeJsonModule(path.join(outDir, "project-data.js"), {
    manifest: files.manifest,
    balance: files.balance,
    worldMap: files.worldMap,
    maps: files.maps,
    visuals: files.visuals,
    buildTarget: target
  });
  fs.writeFileSync(path.join(outDir, "index.html"), htmlTemplate(files.manifest, target, renderer), "utf8");
  fs.writeFileSync(path.join(outDir, "styles.css"), cssTemplate(target), "utf8");
  fs.writeFileSync(path.join(outDir, "player.mjs"), renderer === "phaser" ? phaserPlayerTemplate() : playerTemplate(), "utf8");
  fs.writeFileSync(path.join(outDir, "manifest.webmanifest"), JSON.stringify(webManifest(files.manifest, target), null, 2) + "\n", "utf8");

  // Service worker is written last: precache every emitted asset and version the cache by content
  // hash so a rebuild invalidates stale clients.
  const precacheAssets = collectPrecacheAssets(outDir);
  const cacheVersion = createHash("sha256")
    .update(precacheAssets.join("|"))
    .update(JSON.stringify({ manifest: files.manifest, balance: files.balance, target }))
    .digest("hex")
    .slice(0, 16);
  fs.writeFileSync(path.join(outDir, "offline-sw.js"), serviceWorkerTemplate(precacheAssets, cacheVersion), "utf8");

  const summary = {
    ok: true,
    projectDir: PROJECT_DIR,
    targetId,
    outDir,
    copiedAssets: assetCopy.copied,
    missingAssets: assetCopy.missing,
    invalidAssets: assetCopy.invalid
  };
  if (args.json) {
    printJson(summary);
  } else {
    console.log(`  ✓ Built ${targetId} to ${outDir}`);
    if (assetCopy.missing.length > 0) {
      console.warn(`  ! ${assetCopy.missing.length} visual asset(s) were referenced but not found.`);
    }
    console.log(`  Serve ${outDir} with any static server, then open index.html.`);
  }
} catch (error) {
  if (args.json) printJson({ ok: false, error: error.message, issues: error.issues ?? [] });
  else console.error(`  ✗ ${error.message}`);
  process.exit(1);
}

function assertSafeOutputDir(projectDir, outDir) {
  const rel = path.relative(projectDir, outDir);
  if (!rel || rel === "." || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Refusing to build outside the project directory: ${outDir}`);
  }
}

function emptyDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    // Skip test/spec files and any TypeScript declaration / source files — the player only needs runtime JS.
    if (/\.(test|spec)\.(mjs|js|ts)$/.test(entry.name) || /\.d\.ts(\.map)?$/.test(entry.name) || /\.ts$/.test(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

/** Walk a built output directory and return `./`-prefixed posix paths for service-worker precaching. */
function collectPrecacheAssets(outDir) {
  const assets = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name !== "offline-sw.js") {
        const rel = path.relative(outDir, full).split(path.sep).join("/");
        assets.push("./" + rel);
      }
    }
  };
  walk(outDir);
  return assets.sort();
}

function writeJsonModule(filePath, data) {
  fs.writeFileSync(filePath, `export default ${JSON.stringify(data, null, 2)};\n`, "utf8");
}

function webManifest(manifest, target) {
  return {
    name: target.manifest?.name ?? target.appTitle ?? manifest.name ?? "TowerForge TD",
    short_name: target.manifest?.shortName ?? target.appName ?? manifest.name ?? "TowerForge",
    start_url: ".",
    display: target.manifest?.display ?? "standalone",
    orientation: target.manifest?.orientation ?? "any",
    theme_color: target.manifest?.themeColor ?? target.backgroundColor ?? "#111111",
    background_color: target.manifest?.backgroundColor ?? target.backgroundColor ?? "#111111"
  };
}

function htmlTemplate(manifest, target, renderer = "canvas") {
  const title = esc(target.appTitle ?? manifest.name ?? "TowerForge TD");
  const playfield = renderer === "phaser" ? `<div id="playfield"></div>` : `<canvas id="playfield"></canvas>`;
  const phaserScript = renderer === "phaser" ? `\n  <script src="./vendor/phaser.min.js"></script>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="manifest" href="./manifest.webmanifest">
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <main id="app">
    <header class="hud">
      <div>
        <h1>${title}</h1>
        <p id="mission-caption"></p>
      </div>
      <div class="controls">
        <label>Mission <select id="mission-select"></select></label>
        <label>Tower <select id="tower-select"></select></label>
        <button id="start-wave">Start wave</button>
        <button id="reset-run">Reset</button>
        <button id="reset-progress" title="Clear saved campaign progress">Reset progress</button>
      </div>
    </header>
    <section class="play-shell">
      ${playfield}
      <aside class="panel">
        <div class="stat"><span>Outcome</span><strong id="stat-outcome">playing</strong></div>
        <div class="stat"><span>Core</span><strong id="stat-core">-</strong></div>
        <div class="stat"><span>Resources</span><strong id="stat-resources">-</strong></div>
        <div class="stat"><span>Wave</span><strong id="stat-wave">-</strong></div>
        <div class="stat"><span>Enemies</span><strong id="stat-enemies">-</strong></div>
        <div class="stat"><span>Towers</span><strong id="stat-towers">-</strong></div>
        <label class="speed">Speed <input id="speed" type="range" min="0" max="4" step="0.25" value="1"><span id="speed-label">1x</span></label>
        <label class="speed">Sound <input id="snd" type="checkbox" checked style="width:auto;justify-self:start"></label>
        <div id="ability-bar" class="ability-bar"></div>
        <p id="message"></p>
      </aside>
    </section>
  </main>${phaserScript}
  <script type="module" src="./player.mjs"></script>
</body>
</html>
`;
}

function cssTemplate(target) {
  const bg = target.backgroundColor ?? "#111111";
  return `:root{--bg:${bg};--surface:#191b19;--panel:#222620;--border:#364036;--text:#eff3ea;--muted:#9ca895;--accent:#8ac783;--path:#6b5540;--danger:#df6a59;--water:#427b88;--font:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
*{box-sizing:border-box}html,body{height:100%;margin:0;background:var(--bg);color:var(--text);font-family:var(--font)}body{overflow:hidden}button,select,input{font:inherit}button,select{border:1px solid var(--border);border-radius:6px;background:#111611;color:var(--text);padding:8px 10px}button{cursor:pointer}button:hover{border-color:var(--accent)}#app{height:100%;display:flex;flex-direction:column}.hud{display:flex;gap:18px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--surface)}h1{font-size:18px;line-height:1.1;margin:0;color:var(--accent);letter-spacing:0}p{margin:4px 0 0;color:var(--muted)}.controls{margin-left:auto;display:flex;gap:10px;align-items:end;flex-wrap:wrap}.controls label{display:flex;flex-direction:column;gap:4px;color:var(--muted);font-size:12px}.play-shell{min-height:0;flex:1;display:grid;grid-template-columns:minmax(0,1fr) 260px}#playfield{width:100%;height:100%;display:block;background:#101410;overflow:hidden}#playfield canvas{display:block}.panel{border-left:1px solid var(--border);background:var(--panel);padding:14px;display:flex;flex-direction:column;gap:10px}.stat{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border)}.stat span{color:var(--muted)}.stat strong{font-variant-numeric:tabular-nums}.speed{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;color:var(--muted);margin-top:8px}#message{min-height:42px;padding:10px;border:1px solid var(--border);border-radius:6px;background:#161a16;color:var(--text)}.ability-bar{display:flex;flex-wrap:wrap;gap:6px}.ability-bar:empty{display:none}.ability-bar button{padding:6px 9px;font-size:12px}.ability-bar button.armed{border-color:var(--accent);color:var(--accent)}.ability-bar button:disabled{opacity:.45;cursor:default}@media(max-width:820px){body{overflow:auto}.hud{align-items:flex-start;flex-direction:column}.controls{margin-left:0}.play-shell{grid-template-columns:1fr;grid-template-rows:65vh auto}.panel{border-left:0;border-top:1px solid var(--border)}}`;
}

function playerTemplate() {
  return `import { createGameContentRegistry, TowerDefenseGame } from "./engine/index.js";
import { createCanvasRenderer } from "./renderer/index.mjs";
import { createAudioPlayer } from "./renderer/audio.mjs";
import project from "./project-data.js";

const content = createGameContentRegistry({
  balance: project.balance,
  maps: project.maps,
  worldMap: project.worldMap,
  visuals: project.visuals
});

const $ = (id) => document.getElementById(id);
const audio = createAudioPlayer({ audio: project.visuals && project.visuals.audio });
const canvas = $("playfield");
let missionId = content.defaultMissionId || Object.keys(content.missions)[0];
let towerId = content.missions[missionId]?.buildTowerIds?.[0] || Object.keys(content.towers)[0];
let game = createGame();
const renderer = createCanvasRenderer({ canvas, content });
let lastFrame = performance.now();
let message = "Choose a tower, click a buildable tile, then start the wave.";
let armedAbility = null;
const PROGRESS_KEY = "towerforge:progress:" + ((project.buildTarget && project.buildTarget.appId) || (project.manifest && project.manifest.name) || "game");
let cleared = loadProgress();

initSelectors();
initAbilityBar();
resize();
requestAnimationFrame(loop);
window.addEventListener("resize", resize);
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./offline-sw.js").catch(() => {}));
}
$("start-wave").addEventListener("click", () => { audio.resume(); report(game.startNextWave()); });
$("reset-run").addEventListener("click", () => { game = createGame(); initAbilityBar(); message = "Run reset."; });
$("reset-progress")?.addEventListener("click", () => { cleared = new Set(); saveProgress(); refreshMissionOptions(); message = "Campaign progress reset."; });
$("speed").addEventListener("input", () => $("speed-label").textContent = $("speed").value + "x");
$("snd").addEventListener("change", () => { if ($("snd").checked) audio.resume(); });
canvas.addEventListener("click", (event) => {
  audio.resume();
  const coord = pickTile(event);
  if (!coord) return;
  if (armedAbility) { report(game.useAbility(armedAbility, coord)); setArmed(null); return; }
  if (!towerId) return;
  report(game.placeTower(towerId, coord));
});

function createGame() {
  return new TowerDefenseGame({ missionId, content });
}

function initSelectors() {
  const missionSelect = $("mission-select");
  // Start on an unlocked mission (the default may be gated behind unlockRequiresMissionIds).
  if (!isUnlocked(missionId)) { const first = Object.keys(content.missions).find(isUnlocked); if (first) { missionId = first; game = createGame(); } }
  refreshMissionOptions();
  missionSelect.addEventListener("change", () => {
    if (!isUnlocked(missionSelect.value)) { missionSelect.value = missionId; return; } // locked
    missionId = missionSelect.value;
    towerId = content.missions[missionId]?.buildTowerIds?.[0] || Object.keys(content.towers)[0];
    game = createGame();
    initTowerSelector();
    initAbilityBar();
  });
  initTowerSelector();
}

function initTowerSelector() {
  const towerSelect = $("tower-select");
  const mission = content.missions[missionId];
  const ids = mission?.buildTowerIds?.length ? mission.buildTowerIds : Object.keys(content.towers);
  towerSelect.innerHTML = ids.map((id) => {
    const tower = content.towers[id];
    return \`<option value="\${escapeHtml(id)}">\${escapeHtml(tower?.label || id)}</option>\`;
  }).join("");
  towerId = ids[0] || "";
  towerSelect.value = towerId;
  // Assigning onchange (vs addEventListener) keeps a single handler when missions switch.
  towerSelect.onchange = () => { towerId = towerSelect.value; };
}

function setArmed(id) {
  armedAbility = id;
  if (id) message = "Click the map to use " + ((game.getSnapshot().abilities[id] || {}).label || id) + ".";
  for (const btn of document.querySelectorAll("#ability-bar button")) btn.classList.toggle("armed", btn.dataset.aid === id);
}
function initAbilityBar() {
  const bar = $("ability-bar");
  if (!bar) return;
  const abilities = Object.values(game.getSnapshot().abilities || {});
  bar.innerHTML = abilities.map((a) => \`<button data-aid="\${escapeHtml(a.id)}" title="Radius \${a.radius}, cooldown \${a.cooldown}">\${escapeHtml(a.label || a.id)}</button>\`).join("");
  armedAbility = null;
  for (const btn of bar.querySelectorAll("button")) {
    btn.onclick = () => { audio.resume(); setArmed(armedAbility === btn.dataset.aid ? null : btn.dataset.aid); };
  }
}
function updateAbilityBar(snap) {
  for (const btn of document.querySelectorAll("#ability-bar button")) {
    const a = snap.abilities ? snap.abilities[btn.dataset.aid] : null;
    const ready = !!a && a.ready;
    btn.disabled = !ready;
    const cd = Math.ceil((a && a.cooldownRemaining) || 0);
    btn.textContent = ((a && a.label) || btn.dataset.aid) + (cd > 0 ? " (" + cd + ")" : "");
    if (!ready && armedAbility === btn.dataset.aid) setArmed(null);
  }
}

// ── Campaign progress (persisted per app in localStorage) ──────────────────────
function loadProgress() { try { return new Set(JSON.parse(localStorage.getItem(PROGRESS_KEY) || "[]")); } catch (e) { return new Set(); } }
function saveProgress() { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify([...cleared])); } catch (e) { /* storage unavailable */ } }
function unlockReqs(id) { const n = ((content.worldMap && content.worldMap.missionNodes) || []).find((x) => x.missionId === id); return (n && n.unlockRequiresMissionIds) || []; }
function isUnlocked(id) { return unlockReqs(id).every((r) => cleared.has(r)); }
function markCleared(id) { if (cleared.has(id)) return false; cleared.add(id); saveProgress(); return true; }
function newlyUnlockedBy(id) { return Object.keys(content.missions).filter((mid) => !cleared.has(mid) && unlockReqs(mid).includes(id) && isUnlocked(mid)).map((mid) => (content.missions[mid] && content.missions[mid].label) || mid); }
function refreshMissionOptions() {
  const sel = $("mission-select");
  if (!sel) return;
  sel.innerHTML = Object.values(content.missions).map((mission) => {
    const unlocked = isUnlocked(mission.id);
    const mark = cleared.has(mission.id) ? "✓ " : (unlocked ? "" : "🔒 ");
    return \`<option value="\${escapeHtml(mission.id)}"\${unlocked ? "" : " disabled"}>\${mark}\${escapeHtml(mission.label || mission.id)}</option>\`;
  }).join("");
  sel.value = missionId;
}

function loop(now) {
  const dtSeconds = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  const speed = Number($("speed").value) || 0;
  const ticked = speed > 0 && game.getSnapshot().outcome === "playing";
  if (ticked) {
    const timeUnitSeconds = content.constants.timeUnitSeconds || 1;
    game.tick((dtSeconds / timeUnitSeconds) * speed);
  }
  draw(ticked);
  updateHud();
  requestAnimationFrame(loop);
}

function resize() {
  renderer.resize();
}

function draw(ticked) {
  const snap = game.getRenderSnapshot();
  if (!ticked) snap.lastEvents = []; // don't replay last tick's sounds/effects on idle frames
  renderer.drawSnapshot(snap);
  if ($("snd")?.checked) audio.handleEvents(snap.lastEvents);
}

function updateHud() {
  const snap = game.getSnapshot();
  updateAbilityBar(snap);
  if (snap.outcome === "victory" && markCleared(missionId)) {
    const unlocked = newlyUnlockedBy(missionId);
    message = "Mission cleared!" + (unlocked.length ? " Unlocked: " + unlocked.join(", ") : "");
    refreshMissionOptions();
  }
  $("mission-caption").textContent = content.missions[missionId]?.description || content.missions[missionId]?.label || missionId;
  $("stat-outcome").textContent = snap.outcome;
  $("stat-core").textContent = \`\${snap.coreHp}/\${snap.maxCoreHp}\`;
  $("stat-resources").textContent = Object.entries(snap.resources).map(([id, value]) => { const c = (content.currencies || []).find((c) => c.id === id); return \`\${c ? c.label : id}: \${value}\`; }).join(" · ");
  $("stat-wave").textContent = \`\${snap.startedWaveCount}/\${snap.totalWaves} \${snap.waveState}\`;
  $("stat-enemies").textContent = String(snap.enemies.length);
  $("stat-towers").textContent = String(snap.towers.length);
  $("message").textContent = message;
}

function report(result) {
  message = result.ok ? "Action accepted." : (result.reason || "Action rejected.");
}

function pickTile(event) {
  return renderer.pickTile(event, game.getSnapshot().tiles);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}
`;
}

function phaserPlayerTemplate() {
  return `import { createGameContentRegistry, TowerDefenseGame } from "./engine/index.js";
import { createAudioPlayer } from "./renderer/audio.mjs";
import project from "./project-data.js";

const content = createGameContentRegistry({
  balance: project.balance,
  maps: project.maps,
  worldMap: project.worldMap,
  visuals: project.visuals
});

const $ = (id) => document.getElementById(id);
const audio = createAudioPlayer({ audio: project.visuals && project.visuals.audio });
let missionId = content.defaultMissionId || Object.keys(content.missions)[0];
let towerId = content.missions[missionId]?.buildTowerIds?.[0] || Object.keys(content.towers)[0];
let game = createGame();
let message = "Choose a tower, click a buildable tile, then start the wave.";
let armedAbility = null;
const PROGRESS_KEY = "towerforge:progress:" + ((project.buildTarget && project.buildTarget.appId) || (project.manifest && project.manifest.name) || "game");
let cleared = loadProgress();

const TERRAIN_COLORS = { buildable: 0x1d2a1d, path: 0x6b5540, water: 0x427b88, blocked: 0x252820, spawn: 0x735e2c, core: 0x3f6f43 };

initSelectors();
initAbilityBar();
$("start-wave").addEventListener("click", () => { audio.resume(); report(game.startNextWave()); });
$("reset-run").addEventListener("click", () => { game = createGame(); initAbilityBar(); message = "Run reset."; });
$("reset-progress")?.addEventListener("click", () => { cleared = new Set(); saveProgress(); refreshMissionOptions(); message = "Campaign progress reset."; });
$("speed").addEventListener("input", () => $("speed-label").textContent = $("speed").value + "x");
$("snd").addEventListener("change", () => { if ($("snd").checked) audio.resume(); });

function createGame() { return new TowerDefenseGame({ missionId, content }); }

class PlayScene extends Phaser.Scene {
  create() {
    this.tileG = this.add.graphics();
    this.fxG = this.add.graphics();
    this.entG = this.add.graphics();
    this.towerLabels = new Map();
    this.input.on("pointerdown", (p) => {
      audio.resume();
      const coord = this.pickTile(p.worldX, p.worldY);
      if (!coord) return;
      if (armedAbility) { report(game.useAbility(armedAbility, coord)); setArmed(null); return; }
      if (towerId) report(game.placeTower(towerId, coord));
    });
  }
  geometry(tiles) {
    let maxQ = 1, maxR = 1;
    for (const t of tiles) { if (t.q > maxQ) maxQ = t.q; if (t.r > maxR) maxR = t.r; }
    const W = this.scale.width, H = this.scale.height;
    const r = Math.min(W / ((maxQ + 2) * 1.65), H / ((maxR + 2) * 1.45));
    return { r, ox: r * 1.5, oy: r * 1.5 };
  }
  center(coord, g) { return { x: g.ox + coord.q * g.r * 1.48 + (coord.r % 2) * g.r * 0.74, y: g.oy + coord.r * g.r * 1.28 }; }
  pickTile(x, y) {
    const snap = game.getRenderSnapshot();
    const g = this.geometry(snap.tiles);
    let best = null, bestD = Infinity;
    for (const t of snap.tiles) { const p = this.center(t, g); const d = Math.hypot(p.x - x, p.y - y); if (d < bestD) { bestD = d; best = t; } }
    return best && bestD <= g.r * 0.95 ? { q: best.q, r: best.r } : null;
  }
  enemyPos(enemy, snap, g) {
    const route = enemy.routeId ? snap.pathRoutes?.find((rt) => rt.id === enemy.routeId)?.pathCenterline : snap.pathCenterline;
    const track = route && route.length ? route : snap.pathCenterline;
    if (!track || !track.length) return this.center(snap.spawnCoord || { q: 0, r: 0 }, g);
    const prog = Math.max(0, Math.min(track.length - 1, enemy.pathProgress));
    const i = Math.floor(prog), f = prog - i;
    const a = this.center(track[i], g), b = this.center(track[Math.min(i + 1, track.length - 1)], g);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }
  hex(gr, x, y, r, fill, alpha) {
    gr.fillStyle(fill, alpha == null ? 1 : alpha);
    gr.beginPath();
    for (let i = 0; i < 6; i += 1) { const a = Math.PI / 6 + i * Math.PI / 3; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (i === 0) gr.moveTo(px, py); else gr.lineTo(px, py); }
    gr.closePath(); gr.fillPath();
    gr.lineStyle(1, 0xffffff, 0.08); gr.strokePath();
  }
  update(time, delta) {
    const speed = Number($("speed").value) || 0;
    const ticked = speed > 0 && game.getSnapshot().outcome === "playing";
    if (ticked) {
      const tu = content.constants.timeUnitSeconds || 1;
      game.tick((Math.min(50, delta) / 1000 / tu) * speed);
    }
    const snap = game.getRenderSnapshot();
    if (!ticked) snap.lastEvents = []; // don't replay last tick's sounds/tracers on idle frames
    if ($("snd")?.checked) audio.handleEvents(snap.lastEvents);
    const g = this.geometry(snap.tiles);

    this.tileG.clear();
    for (const t of snap.tiles) { const p = this.center(t, g); this.hex(this.tileG, p.x, p.y, g.r * 0.86, TERRAIN_COLORS[t.terrain] ?? TERRAIN_COLORS.buildable); }
    for (const w of snap.temporaryWaterTiles) { const p = this.center(w, g); this.hex(this.tileG, p.x, p.y, g.r * 0.74, 0x427b88, 0.55); }

    this.fxG.clear();
    for (const ev of snap.lastEvents) {
      if (ev.type !== "towerFired") continue;
      const tw = snap.towers.find((t) => t.id === ev.towerId);
      const en = snap.enemies.find((e) => e.id === ev.enemyId);
      if (tw && en) { const a = this.center(tw.coord, g), b = this.enemyPos(en, snap, g); this.fxG.lineStyle(2, 0xffe2a8, 0.85); this.fxG.lineBetween(a.x, a.y, b.x, b.y); }
    }

    this.entG.clear();
    const seen = new Set();
    for (const tw of snap.towers) {
      const p = this.center(tw.coord, g); seen.add(tw.id);
      this.entG.fillStyle(0x8ac783, 1); this.entG.fillCircle(p.x, p.y, g.r * 0.5);
      this.entG.lineStyle(2, 0xe8f4db, 1); this.entG.strokeCircle(p.x, p.y, g.r * 0.5);
      let label = this.towerLabels.get(tw.id);
      const text = (content.towers[tw.typeId]?.label || tw.typeId).slice(0, 2);
      if (!label) { label = this.add.text(0, 0, text, { fontFamily: "sans-serif", color: "#101410" }).setOrigin(0.5).setDepth(10); this.towerLabels.set(tw.id, label); }
      label.setText(text).setFontSize(Math.max(10, Math.round(g.r * 0.42))).setPosition(p.x, p.y);
    }
    for (const [id, lbl] of this.towerLabels) { if (!seen.has(id)) { lbl.destroy(); this.towerLabels.delete(id); } }

    for (const en of snap.enemies) {
      const p = this.enemyPos(en, snap, g);
      const color = Number(content.enemies[en.typeId]?.color ?? 0xaaaaaa);
      this.entG.fillStyle(color, 1); this.entG.fillCircle(p.x, p.y, g.r * 0.38);
      this.entG.lineStyle(2, 0x111111, 1); this.entG.strokeCircle(p.x, p.y, g.r * 0.38);
      const ratio = Math.max(0, en.hp / en.maxHp);
      this.entG.fillStyle(0x1b1d18, 1); this.entG.fillRect(p.x - g.r * 0.45, p.y - g.r * 0.62, g.r * 0.9, 4);
      this.entG.fillStyle(ratio > 0.35 ? 0x8ac783 : 0xdf6a59, 1); this.entG.fillRect(p.x - g.r * 0.45, p.y - g.r * 0.62, g.r * 0.9 * ratio, 4);
    }

    updateHud(snap);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "playfield",
  backgroundColor: "#101410",
  scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
  scene: PlayScene
});

function initSelectors() {
  const missionSelect = $("mission-select");
  // Start on an unlocked mission (the default may be gated behind unlockRequiresMissionIds).
  if (!isUnlocked(missionId)) { const first = Object.keys(content.missions).find(isUnlocked); if (first) { missionId = first; game = createGame(); } }
  refreshMissionOptions();
  missionSelect.addEventListener("change", () => {
    if (!isUnlocked(missionSelect.value)) { missionSelect.value = missionId; return; } // locked
    missionId = missionSelect.value;
    towerId = content.missions[missionId]?.buildTowerIds?.[0] || Object.keys(content.towers)[0];
    game = createGame();
    initTowerSelector();
    initAbilityBar();
  });
  initTowerSelector();
}

function initTowerSelector() {
  const towerSelect = $("tower-select");
  const mission = content.missions[missionId];
  const ids = mission?.buildTowerIds?.length ? mission.buildTowerIds : Object.keys(content.towers);
  towerSelect.innerHTML = ids.map((id) => {
    const tower = content.towers[id];
    return \`<option value="\${escapeHtml(id)}">\${escapeHtml(tower?.label || id)}</option>\`;
  }).join("");
  towerId = ids[0] || "";
  towerSelect.value = towerId;
  towerSelect.onchange = () => { towerId = towerSelect.value; };
}

function setArmed(id) {
  armedAbility = id;
  if (id) message = "Click the map to use " + ((game.getSnapshot().abilities[id] || {}).label || id) + ".";
  for (const btn of document.querySelectorAll("#ability-bar button")) btn.classList.toggle("armed", btn.dataset.aid === id);
}
function initAbilityBar() {
  const bar = $("ability-bar");
  if (!bar) return;
  const abilities = Object.values(game.getSnapshot().abilities || {});
  bar.innerHTML = abilities.map((a) => \`<button data-aid="\${escapeHtml(a.id)}" title="Radius \${a.radius}, cooldown \${a.cooldown}">\${escapeHtml(a.label || a.id)}</button>\`).join("");
  armedAbility = null;
  for (const btn of bar.querySelectorAll("button")) {
    btn.onclick = () => { audio.resume(); setArmed(armedAbility === btn.dataset.aid ? null : btn.dataset.aid); };
  }
}
function updateAbilityBar(snap) {
  for (const btn of document.querySelectorAll("#ability-bar button")) {
    const a = snap.abilities ? snap.abilities[btn.dataset.aid] : null;
    const ready = !!a && a.ready;
    btn.disabled = !ready;
    const cd = Math.ceil((a && a.cooldownRemaining) || 0);
    btn.textContent = ((a && a.label) || btn.dataset.aid) + (cd > 0 ? " (" + cd + ")" : "");
    if (!ready && armedAbility === btn.dataset.aid) setArmed(null);
  }
}

// ── Campaign progress (persisted per app in localStorage) ──────────────────────
function loadProgress() { try { return new Set(JSON.parse(localStorage.getItem(PROGRESS_KEY) || "[]")); } catch (e) { return new Set(); } }
function saveProgress() { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify([...cleared])); } catch (e) { /* storage unavailable */ } }
function unlockReqs(id) { const n = ((content.worldMap && content.worldMap.missionNodes) || []).find((x) => x.missionId === id); return (n && n.unlockRequiresMissionIds) || []; }
function isUnlocked(id) { return unlockReqs(id).every((r) => cleared.has(r)); }
function markCleared(id) { if (cleared.has(id)) return false; cleared.add(id); saveProgress(); return true; }
function newlyUnlockedBy(id) { return Object.keys(content.missions).filter((mid) => !cleared.has(mid) && unlockReqs(mid).includes(id) && isUnlocked(mid)).map((mid) => (content.missions[mid] && content.missions[mid].label) || mid); }
function refreshMissionOptions() {
  const sel = $("mission-select");
  if (!sel) return;
  sel.innerHTML = Object.values(content.missions).map((mission) => {
    const unlocked = isUnlocked(mission.id);
    const mark = cleared.has(mission.id) ? "✓ " : (unlocked ? "" : "🔒 ");
    return \`<option value="\${escapeHtml(mission.id)}"\${unlocked ? "" : " disabled"}>\${mark}\${escapeHtml(mission.label || mission.id)}</option>\`;
  }).join("");
  sel.value = missionId;
}

function updateHud(snap) {
  updateAbilityBar(snap);
  if (snap.outcome === "victory" && markCleared(missionId)) {
    const unlocked = newlyUnlockedBy(missionId);
    message = "Mission cleared!" + (unlocked.length ? " Unlocked: " + unlocked.join(", ") : "");
    refreshMissionOptions();
  }
  $("mission-caption").textContent = content.missions[missionId]?.description || content.missions[missionId]?.label || missionId;
  $("stat-outcome").textContent = snap.outcome;
  $("stat-core").textContent = \`\${snap.coreHp}/\${snap.maxCoreHp}\`;
  $("stat-resources").textContent = Object.entries(snap.resources).map(([id, value]) => { const c = (content.currencies || []).find((c) => c.id === id); return \`\${c ? c.label : id}: \${value}\`; }).join(" · ");
  $("stat-wave").textContent = \`\${snap.startedWaveCount}/\${snap.totalWaves} \${snap.waveState}\`;
  $("stat-enemies").textContent = String(snap.enemies.length);
  $("stat-towers").textContent = String(snap.towers.length);
  $("message").textContent = message;
}

function report(result) { message = result.ok ? "Action accepted." : (result.reason || "Action rejected."); }

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}
`;
}

function serviceWorkerTemplate(precacheAssets = [], cacheVersion = "dev") {
  const assets = ["./", ...precacheAssets];
  return `const CACHE = "towerforge-build-${cacheVersion}";
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}
