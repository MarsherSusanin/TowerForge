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
import { projectTileCoverage } from "./lib/tile-coverage.mjs";

function parseArgs() {
  const raw = process.argv.slice(2);
  const result = { projectDir: null, targetId: null, outDir: null, json: parseJsonFlag(raw), singleFile: false };
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
    } else if (raw[i] === "--single-file") {
      result.singleFile = true;
      i += 1;
    } else {
      // A bare positional (not a flag or a flag's value) is the project path, matching
      // `towerforge validate <path>`. Without this it was silently dropped -> the command
      // operated on the default starter project instead of the one the user named.
      if (!result.projectDir && !raw[i].startsWith("--")) result.projectDir = raw[i];
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
  const tileCoverage = projectTileCoverage(files);
  if (!tileCoverage.ok) {
    const error = new Error(`Build stopped because ${tileCoverage.missingCount} reachable tileset signature(s) are missing.`);
    error.issues = tileCoverage.maps.flatMap((map) => map.missing.map((entry) => ({
      severity: "error", entityKind: "tileSet", entityId: map.tileSetId ?? "?", fieldPath: `maps.${map.mapId}.${entry.terrain}.${entry.signature}`,
      code: "TILESET_REACHABLE_SIGNATURE_MISSING", message: `Map "${map.mapId}" needs ${entry.terrain}/${entry.signature} (${entry.count} reachable cell(s)).`
    })));
    throw error;
  }
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
    scripts: files.scripts,
    visuals: files.visuals,
    storyComics: files.storyComics,
    battleBackgrounds: files.battleBackgrounds,
    buildTarget: target
  });
  fs.writeFileSync(path.join(outDir, "index.html"), htmlTemplate(files.manifest, target, renderer), "utf8");
  fs.writeFileSync(path.join(outDir, "styles.css"), cssTemplate(target), "utf8");
  fs.writeFileSync(path.join(outDir, "boot.js"), bootRecoveryTemplate(), "utf8");
  fs.writeFileSync(path.join(outDir, "player.mjs"), renderer === "phaser" ? phaserPlayerTemplate() : playerTemplate(), "utf8");
  fs.writeFileSync(path.join(outDir, "manifest.webmanifest"), JSON.stringify(webManifest(files.manifest, target), null, 2) + "\n", "utf8");

  // Service worker is written last: precache every emitted asset and version the cache by content
  // hash so a rebuild invalidates stale clients.
  const precacheAssets = collectPrecacheAssets(outDir);
  // Version the cache by CONTENT, not just file names: hash every precached file's bytes so any
  // change to maps/worldMap/visuals (embedded in project-data.js), engine/renderer JS, or a
  // replaced binary asset yields a new offline-sw.js and evicts the stale cache on returning
  // clients. Hashing names alone left redeploys byte-identical, pinning players to the old build.
  const versionHash = createHash("sha256").update(JSON.stringify({ target }));
  for (const rel of precacheAssets) {
    versionHash.update(rel).update("\0");
    versionHash.update(fs.readFileSync(path.join(outDir, rel.replace(/^\.\//, ""))));
  }
  const cacheVersion = versionHash.digest("hex").slice(0, 16);
  fs.writeFileSync(path.join(outDir, "offline-sw.js"), serviceWorkerTemplate(precacheAssets, cacheVersion), "utf8");

  let singleFilePath = null;
  if (args.singleFile) {
    singleFilePath = path.join(outDir, "index.single.html");
    const embeddedProject = {
      manifest: files.manifest,
      balance: files.balance,
      worldMap: files.worldMap,
      maps: files.maps,
      scripts: files.scripts,
      visuals: embedVisualAssets(PROJECT_DIR, files.visuals),
      storyComics: files.storyComics,
      battleBackgrounds: files.battleBackgrounds,
      buildTarget: target
    };
    fs.writeFileSync(singleFilePath, singleFileHtml(outDir, files.manifest, target, renderer, embeddedProject), "utf8");
  }

  // Phaser now shares topology and terrain tileset resolution with Canvas. Entity sprites still use
  // flat placeholders, so report only those bindings instead of claiming all visual art is ignored.
  const warnings = [];
  if (renderer === "phaser") {
    const bindings = files.visuals?.bindings ?? {};
    const boundCount = Object.keys(bindings.towers ?? {}).length + Object.keys(bindings.enemies ?? {}).length;
    if (boundCount > 0) {
      warnings.push(`Phaser renderer uses the shared tileset pipeline, but ${boundCount} bound tower/enemy sprite(s) still use flat entity placeholders.`);
    }
  }

  const summary = {
    ok: true,
    projectDir: PROJECT_DIR,
    targetId,
    outDir,
    copiedAssets: assetCopy.copied,
    missingAssets: assetCopy.missing,
    invalidAssets: assetCopy.invalid,
    singleFilePath,
    warnings
  };
  if (args.json) {
    printJson(summary);
  } else {
    console.log(`  ✓ Built ${targetId} to ${outDir}`);
    if (assetCopy.missing.length > 0) {
      console.warn(`  ! ${assetCopy.missing.length} visual asset(s) were referenced but not found.`);
    }
    for (const warning of warnings) console.warn(`  ! ${warning}`);
    if (singleFilePath) console.log(`  Open ${singleFilePath} directly, or serve ${outDir} and open index.html.`);
    else console.log(`  Serve ${outDir} with any static server, then open index.html.`);
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
    // Skip test/spec files and any TypeScript declaration / source files — the player only needs
    // runtime JS. Also skip dotfiles (e.g. dist/.build-stamp, an internal engine-freshness marker)
    // so build-internal artifacts never ship in the bundle or get precached by the service worker.
    if (entry.name.startsWith(".") || /\.(test|spec)\.(mjs|js|ts)$/.test(entry.name) || /\.d\.ts(\.map)?$/.test(entry.name) || /\.ts$/.test(entry.name)) continue;
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
      } else if (entry.name !== "offline-sw.js" && !entry.name.startsWith(".")) {
        // Never precache the SW itself or dotfiles (build-internal markers, DS_Store, etc.).
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

function embedVisualAssets(projectDir, visuals) {
  const embedded = JSON.parse(JSON.stringify(visuals ?? {}));
  const groups = [embedded.atlases, embedded.sprites, embedded.audio?.sounds, embedded.audio?.musicTracks];
  for (const group of groups) {
    for (const entry of Object.values(group ?? {})) {
      if (!entry?.src || /^(?:data:|blob:|https?:)/i.test(entry.src)) continue;
      const absolute = path.resolve(projectDir, entry.src);
      const relative = path.relative(projectDir, absolute);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
      entry.src = `data:${mimeType(absolute)};base64,${fs.readFileSync(absolute).toString("base64")}`;
    }
  }
  return embedded;
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
    ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4"
  })[ext] ?? "application/octet-stream";
}

function singleFileHtml(outDir, manifest, target, renderer, projectData) {
  const virtual = new Map([
    [path.resolve(outDir, "project-data.js"), `export default ${JSON.stringify(projectData)};\n`]
  ]);
  const entryPath = path.resolve(outDir, "player.mjs");
  const entry = rewriteModuleImports(entryPath, outDir, virtual, new Map(), []);
  let html = htmlTemplate(manifest, target, renderer);
  html = html.replace(/\s*<link rel="manifest"[^>]*>/, "");
  html = html.replace('  <link rel="stylesheet" href="./styles.css">', `  <style>${escapeInlineStyle(cssTemplate(target))}</style>`);
  if (renderer === "phaser") {
    const phaser = fs.readFileSync(path.join(outDir, "vendor", "phaser.min.js"), "utf8");
    html = html.replace('  <script src="./vendor/phaser.min.js"></script>', `  <script>${escapeInlineScript(phaser)}</script>`);
  }
  html = html.replace('  <script src="./boot.js"></script>', `  <script>${escapeInlineScript(bootRecoveryTemplate())}</script>`);
  html = html.replace('  <script type="module" src="./player.mjs"></script>', `  <script type="module">${escapeInlineScript(entry)}</script>`);
  return html;
}

function rewriteModuleImports(filePath, moduleRoot, virtual, memo, stack) {
  const absolute = path.resolve(filePath);
  if (stack.includes(absolute)) throw new Error(`Single-file module graph contains a cycle: ${[...stack, absolute].map((item) => path.relative(moduleRoot, item)).join(" -> ")}`);
  let source = virtual.get(absolute) ?? fs.readFileSync(absolute, "utf8");
  const nextStack = [...stack, absolute];
  const importPattern = /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?(["'])([^"']+)\1/g;
  source = source.replace(importPattern, (statement, quote, specifier) => {
    if (!specifier.startsWith(".")) return statement;
    const dependency = path.resolve(path.dirname(absolute), specifier);
    const relative = path.relative(moduleRoot, dependency);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Single-file module escapes build output: ${specifier}`);
    let url = memo.get(dependency);
    if (!url) {
      const rewritten = rewriteModuleImports(dependency, moduleRoot, virtual, memo, nextStack);
      url = `data:text/javascript;base64,${Buffer.from(rewritten, "utf8").toString("base64")}`;
      memo.set(dependency, url);
    }
    return statement.replace(`${quote}${specifier}${quote}`, `${quote}${url}${quote}`);
  });
  return source;
}

function escapeInlineScript(value) { return String(value).replace(/<\/script/gi, "<\\/script"); }
function escapeInlineStyle(value) { return String(value).replace(/<\/style/gi, "<\\/style"); }

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
  const playfield = renderer === "phaser"
    ? `<div id="playfield" tabindex="0" role="application" aria-label="Hex battlefield. Use arrow keys to move the tile cursor and Enter to act."></div>`
    : `<canvas id="playfield" tabindex="0" role="application" aria-label="Hex battlefield. Use arrow keys to move the tile cursor and Enter to act."></canvas>`;
  const phaserScript = renderer === "phaser" ? `\n  <script src="./vendor/phaser.min.js"></script>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <meta name="theme-color" content="${esc(target.backgroundColor ?? manifest.backgroundColor ?? "#111111")}">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
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
        <label>Difficulty <select id="difficulty-select"></select></label>
        <label>Tower <select id="tower-select"></select></label>
        <button id="start-wave">Start wave</button>
        <button id="pause-run" aria-pressed="false" title="Pause or resume (Space)">Pause</button>
        <button id="sell-mode" aria-pressed="false" title="Sell a tower">Sell</button>
        <button id="reset-run">Reset</button>
        <button id="reset-progress" title="Clear saved campaign progress">Reset progress</button>
      </div>
    </header>
    <section class="play-shell">
      ${playfield}
      <aside class="panel">
        <div class="stat"><span>Outcome</span><strong id="stat-outcome" aria-live="polite">playing</strong></div>
        <div class="stat"><span>Core</span><strong id="stat-core">-</strong></div>
        <div class="stat"><span>Resources</span><strong id="stat-resources">-</strong></div>
        <div class="stat"><span>Wave</span><strong id="stat-wave">-</strong></div>
        <div class="stat"><span>Enemies</span><strong id="stat-enemies">-</strong></div>
        <div class="stat"><span>Towers</span><strong id="stat-towers">-</strong></div>
        <div class="stat"><span>Objectives</span><strong id="stat-objectives">-</strong></div>
        <label class="targeting">Target priority <select id="target-mode" disabled>
          <option value="first">First</option><option value="last">Last</option><option value="closest">Closest</option>
          <option value="furthest">Furthest</option><option value="strongest">Strongest</option><option value="weakest">Weakest</option>
        </select></label>
        <label class="speed">Speed <input id="speed" type="range" min="0" max="4" step="0.25" value="1"><span id="speed-label">1x</span></label>
        <label class="speed">Sound <input id="snd" type="checkbox" checked style="width:auto;justify-self:start"></label>
        <label class="speed">SFX <input id="sfx-volume" type="range" min="0" max="1" step="0.05" value="0.5"><span id="sfx-volume-label">50%</span></label>
        <label class="speed">Music <input id="music-volume" type="range" min="0" max="1" step="0.05" value="0.35"><span id="music-volume-label">35%</span></label>
        <div id="ability-bar" class="ability-bar"></div>
        <section id="meta-panel" class="meta-panel" aria-label="Permanent upgrades" hidden>
          <div class="meta-title">Forge upgrades <span id="meta-resources"></span></div>
          <div id="meta-upgrades" class="meta-upgrades"></div>
        </section>
        <p id="message" role="status" aria-live="polite"></p>
      </aside>
    </section>
  </main>
  <section id="boot-error" class="boot-error" role="alertdialog" aria-modal="true" aria-labelledby="boot-error-title" hidden>
    <div class="boot-error-panel">
      <h2 id="boot-error-title">The game could not start</h2>
      <p id="boot-error-message">Reload the game. If the problem continues, reset local progress.</p>
      <div class="boot-error-actions">
        <button type="button" id="boot-reload">Reload</button>
        <button type="button" id="boot-reset">Reset local progress</button>
      </div>
    </div>
  </section>
  <section id="story-overlay" class="story-overlay" role="dialog" aria-modal="true" aria-labelledby="story-title" hidden>
    <div class="story-panel">
      <div id="story-art" class="story-art" hidden></div>
      <div class="story-copy">
        <h2 id="story-title"></h2>
        <p id="story-speaker" class="story-speaker"></p>
        <p id="story-text" class="story-text"></p>
        <div class="story-actions">
          <button type="button" id="story-skip">Skip</button>
          <button type="button" id="story-next">Next</button>
        </div>
      </div>
    </div>
  </section>
  <script src="./boot.js"></script>${phaserScript}
  <script type="module" src="./player.mjs"></script>
</body>
</html>
`;
}

function bootRecoveryTemplate() {
  return `(() => {
  const reveal = (reason) => {
    const overlay = document.getElementById("boot-error");
    if (!overlay || window.__towerforgeBootOk) return;
    const message = document.getElementById("boot-error-message");
    if (message && reason) message.textContent = String(reason);
    overlay.hidden = false;
    document.getElementById("boot-reload").onclick = () => location.reload();
    document.getElementById("boot-reset").onclick = () => {
      try {
        for (let i = localStorage.length - 1; i >= 0; i -= 1) {
          const key = localStorage.key(i) || "";
          if (key.startsWith("towerforge:progress:") || key.startsWith("story_seen_")) localStorage.removeItem(key);
        }
      } catch {}
      location.reload();
    };
    document.getElementById("boot-reload").focus();
  };
  window.addEventListener("error", (event) => reveal(event.error?.message || event.message));
  window.addEventListener("unhandledrejection", (event) => reveal(event.reason?.message || event.reason || "The game failed while starting."));
  setTimeout(() => reveal("The game did not finish starting."), 5000);
})();\n`;
}

function cssTemplate(target) {
  const bg = target.backgroundColor ?? "#111111";
  return `:root{--bg:${bg};--surface:#191b19;--panel:#222620;--border:#364036;--text:#eff3ea;--muted:#9ca895;--accent:#8ac783;--path:#6b5540;--danger:#df6a59;--water:#427b88;--font:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
*{box-sizing:border-box}html,body{height:100%;margin:0;background:var(--bg);color:var(--text);font-family:var(--font)}
/* Native-app touch hardening (ported from a shipped Capacitor game): no pinch-zoom/pull-to-refresh,
   no long-press text selection or blue tap-highlight, and respect the notch via safe-area insets. */
body{overflow:hidden;overscroll-behavior:none;touch-action:manipulation;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.hud{padding-top:calc(12px + env(safe-area-inset-top))}
.panel{padding-bottom:calc(14px + env(safe-area-inset-bottom))}
button,select,input{font:inherit}button,select{border:1px solid var(--border);border-radius:6px;background:#111611;color:var(--text);padding:8px 10px}button{cursor:pointer}button:hover{border-color:var(--accent)}button:focus-visible,select:focus-visible,input:focus-visible,#playfield:focus-visible{outline:2px solid var(--accent);outline-offset:2px}button[aria-pressed="true"]{border-color:var(--danger);color:var(--danger)}#app{height:100%;display:flex;flex-direction:column}.hud{display:flex;gap:18px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--surface)}h1{font-size:18px;line-height:1.1;margin:0;color:var(--accent);letter-spacing:0}p{margin:4px 0 0;color:var(--muted)}.controls{margin-left:auto;display:flex;gap:10px;align-items:end;flex-wrap:wrap}.controls label{display:flex;flex-direction:column;gap:4px;color:var(--muted);font-size:12px}.play-shell{min-height:0;flex:1;display:grid;grid-template-columns:minmax(0,1fr) 280px}#playfield{width:100%;height:100%;display:block;background:#101410;overflow:hidden;background-position:center;background-size:cover;background-repeat:no-repeat}#playfield canvas{display:block}.panel{border-left:1px solid var(--border);background:var(--panel);padding:14px;display:flex;flex-direction:column;gap:10px;overflow:auto}.stat{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border)}.stat span{color:var(--muted)}.stat strong{font-variant-numeric:tabular-nums}.targeting{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:center;color:var(--muted);font-size:13px}.targeting select{min-width:0}.speed{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;color:var(--muted);margin-top:8px}#message{min-height:42px;padding:10px;border:1px solid var(--border);border-radius:6px;background:#161a16;color:var(--text)}.ability-bar{display:flex;flex-wrap:wrap;gap:6px}.ability-bar:empty{display:none}.ability-bar button{padding:6px 9px;font-size:12px}.ability-bar button.armed{border-color:var(--accent);color:var(--accent)}.ability-bar button:disabled{opacity:.45;cursor:default}.meta-panel{border-top:1px solid var(--border);padding-top:10px}.meta-title{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:12px;text-transform:uppercase}.meta-upgrades{display:grid;gap:6px;margin-top:8px}.meta-upgrade{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;align-items:center;padding:7px;border:1px solid var(--border);border-radius:6px;background:#161a16}.meta-upgrade span{min-width:0;font-size:12px}.meta-upgrade button{padding:5px 7px;font-size:11px}.boot-error,.story-overlay{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:24px;background:#0b0e0bdd}.boot-error[hidden],.story-overlay[hidden]{display:none}.boot-error-panel{width:min(460px,100%);padding:22px;border:1px solid var(--danger);border-radius:6px;background:var(--surface);box-shadow:0 20px 60px #0009}.boot-error-panel h2{margin:0 0 8px;font-size:20px}.boot-error-actions,.story-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}.story-panel{width:min(820px,100%);max-height:min(680px,90vh);display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);overflow:hidden;border:1px solid var(--border);border-radius:6px;background:var(--surface);box-shadow:0 20px 60px #0009}.story-art{min-height:360px;background-position:center;background-size:cover;background-repeat:no-repeat;background-color:#101410}.story-copy{padding:24px;align-self:end}.story-copy h2{margin:0 0 18px;font-size:24px}.story-speaker{min-height:18px;color:var(--accent);font-weight:700}.story-text{color:var(--text);font-size:16px;line-height:1.55;white-space:pre-wrap}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}@media(max-width:820px){body{overflow:auto}.hud{align-items:flex-start;flex-direction:column}.controls{margin-left:0}.play-shell{grid-template-columns:1fr;grid-template-rows:65vh auto}.panel{border-left:0;border-top:1px solid var(--border)}.story-panel{grid-template-columns:1fr}.story-art{min-height:220px}.story-copy{padding:18px}}`;
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
  scripts: project.scripts,
  visuals: project.visuals,
  storyComics: project.storyComics,
  battleBackgrounds: project.battleBackgrounds
});

const $ = (id) => document.getElementById(id);
applyProjectTheme();
const audio = createAudioPlayer({ audio: project.visuals && project.visuals.audio });
const canvas = $("playfield");
const PROGRESS_KEY = "towerforge:progress:" + ((project.buildTarget && project.buildTarget.appId) || (project.manifest && project.manifest.name) || "game");
const PROGRESS_VERSION = 2;
let progress = loadProgress();
let cleared = new Set(progress.clearedMissionIds);
let missionId = content.defaultMissionId || Object.keys(content.missions)[0];
let difficultyId = content.difficulties.some((item) => item.id === progress.selectedDifficultyId) ? progress.selectedDifficultyId : content.defaultDifficultyId;
let towerId = content.missions[missionId]?.buildTowerIds?.[0] || Object.keys(content.towers)[0];
let game = createGame();
const renderer = createCanvasRenderer({ canvas, content, theme: content.visuals?.theme?.renderer });
let lastFrame = performance.now();
let message = "Choose a tower, click a buildable tile, then start the wave.";
let armedAbility = null;
let sellMode = false;
let selectedTowerId = null;
let keyboardCoord = null;
let lastRunningSpeed = 1;
let activeStory = null;
let storyWasRunning = false;
let victoryRewarded = false;
const shownStories = new Set();

initSelectors();
initAbilityBar();
renderMetaPanel();
resize();
requestAnimationFrame(loop);
window.addEventListener("resize", resize);
// Pause the loop and free the audio hardware while the app is backgrounded (home button / app
// switch on Android) — saves battery and avoids a huge post-resume time step. RAF is already
// throttled while hidden; this also suspends the AudioContext.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { audio.suspend(); }
  else { lastFrame = performance.now(); if ($("snd")?.checked) audio.resume(); }
});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./offline-sw.js").catch(() => {}));
}
$("start-wave").addEventListener("click", () => { audio.resume(); report(game.startNextWave()); });
$("pause-run").addEventListener("click", () => setPaused(Number($("speed").value) > 0));
$("sell-mode").addEventListener("click", () => setSellMode(!sellMode));
$("reset-run").addEventListener("click", () => { game = createGame(); victoryRewarded = false; selectedTowerId = null; initAbilityBar(); setSellMode(false); message = "Run reset."; });
$("reset-progress")?.addEventListener("click", () => { progress = emptyProgress(); cleared = new Set(); difficultyId = content.defaultDifficultyId; saveProgress(); refreshMissionOptions(); initDifficultySelector(); renderMetaPanel(); game = createGame(); victoryRewarded = false; message = "Campaign progress reset."; });
$("speed").addEventListener("input", syncSpeedUi);
$("snd").addEventListener("change", () => { syncAudioSettings(); if ($("snd").checked) audio.resume(); });
$("sfx-volume").addEventListener("input", () => { syncAudioSettings(); if ($("snd").checked) audio.resume(); });
$("music-volume").addEventListener("input", () => { syncAudioSettings(); if ($("snd").checked) audio.resume(); });
$("target-mode").addEventListener("change", () => {
  if (!selectedTowerId) return;
  report(game.setTowerTargetMode(selectedTowerId, $("target-mode").value));
});
$("story-next").addEventListener("click", advanceStory);
$("story-skip").addEventListener("click", finishStory);
document.addEventListener("keydown", (event) => {
  const tag = event.target?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
  if (event.code === "Space") { event.preventDefault(); setPaused(Number($("speed").value) > 0); return; }
  if (document.activeElement !== canvas) return;
  const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (moves[event.key]) { event.preventDefault(); moveKeyboardCursor(moves[event.key][0], moves[event.key][1]); }
  else if (event.key === "Enter") { event.preventDefault(); actAtCoord(ensureKeyboardCoord()); }
  else if (event.key === "Escape") { event.preventDefault(); setArmed(null); setSellMode(false); message = "Build action cancelled."; }
});
syncSpeedUi();
syncAudioSettings();
applyBattleBackground();
selectMissionMusic();
showStoryForMission("beforeMission");
window.__towerforgeInspect = () => game.getRenderSnapshot();
window.__towerforgeTilePoint = (coord) => {
  const snapshot = game.getRenderSnapshot();
  const point = renderer.center(coord, renderer.geometry(snapshot.tiles, snapshot.grid));
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + point.x * rect.width / canvas.width, y: rect.top + point.y * rect.height / canvas.height };
};
window.__towerforgePickPoint = (point) => renderer.pickTile({ clientX: point.x, clientY: point.y }, game.getRenderSnapshot().tiles);
window.__towerforgeBootOk = true;
canvas.addEventListener("focus", () => syncKeyboardCursor(ensureKeyboardCoord()));
canvas.addEventListener("click", (event) => {
  audio.resume();
  const coord = pickTile(event);
  if (!coord) return;
  window.__towerforgeLastPointerCoord = coord;
  syncKeyboardCursor(coord);
  actAtCoord(coord);
});

function actAtCoord(coord) {
  if (!coord) return;
  if (sellMode) {
    const towerAt = game.getTowerIdAt(coord);
    report(towerAt ? game.sellTower(towerAt) : { ok: false, reason: "Choose a tower tile." });
    if (towerAt === selectedTowerId) selectedTowerId = null;
    setSellMode(false);
    return;
  }
  if (armedAbility) { report(game.useAbility(armedAbility, coord)); setArmed(null); return; }
  const towerAt = game.getTowerIdAt(coord);
  if (towerAt) { selectedTowerId = towerAt; message = "Tower selected."; return; }
  if (!towerId) return;
  const result = game.placeTower(towerId, coord);
  report(result);
  if (result.ok) selectedTowerId = game.getTowerIdAt(coord);
}

function ensureKeyboardCoord() {
  const tiles = game.getSnapshot().tiles;
  if (keyboardCoord && tiles.some((tile) => tile.q === keyboardCoord.q && tile.r === keyboardCoord.r)) return keyboardCoord;
  const tile = tiles.find((item) => item.terrain === "buildable") || tiles[0];
  keyboardCoord = tile ? { q: tile.q, r: tile.r } : null;
  return keyboardCoord;
}

function syncKeyboardCursor(coord) {
  keyboardCoord = coord ? { q: coord.q, r: coord.r } : null;
  renderer.setFocusCoord(keyboardCoord);
  const tile = keyboardCoord && game.getSnapshot().tiles.find((item) => item.q === keyboardCoord.q && item.r === keyboardCoord.r);
  canvas.setAttribute("aria-label", tile ? "Hex battlefield. Selected tile q " + tile.q + ", r " + tile.r + ", " + tile.terrain + ". Arrow keys move; Enter acts; Escape cancels." : "Hex battlefield.");
}

function moveKeyboardCursor(dq, dr) {
  const current = ensureKeyboardCoord();
  if (!current) return;
  const tiles = game.getSnapshot().tiles;
  const targetQ = current.q + dq, targetR = current.r + dr;
  const target = tiles.find((tile) => tile.q === targetQ && tile.r === targetR);
  if (target) syncKeyboardCursor(target);
}

function createGame() {
  return new TowerDefenseGame({ missionId, content, difficultyId, metaUpgradeLevels: progress.upgradeLevels });
}

function setSellMode(active) {
  sellMode = Boolean(active);
  $("sell-mode").setAttribute("aria-pressed", String(sellMode));
  if (sellMode) { setArmed(null); message = "Click a tower to sell it."; }
}

function setPaused(paused) {
  const speed = $("speed");
  const current = Number(speed.value) || 0;
  if (paused) {
    if (current > 0) lastRunningSpeed = current;
    speed.value = "0";
  } else {
    speed.value = String(lastRunningSpeed > 0 ? lastRunningSpeed : 1);
  }
  syncSpeedUi();
}

function syncSpeedUi() {
  const speed = Number($("speed").value) || 0;
  if (speed > 0) lastRunningSpeed = speed;
  $("speed-label").textContent = speed + "x";
  $("pause-run").textContent = speed > 0 ? "Pause" : "Resume";
  $("pause-run").setAttribute("aria-pressed", String(speed === 0));
}

function syncAudioSettings() {
  const enabled = $("snd").checked;
  const sfxVolume = Number($("sfx-volume").value);
  const musicVolume = Number($("music-volume").value);
  audio.setVolumes(sfxVolume, musicVolume);
  audio.setEnabled(enabled);
  $("sfx-volume-label").textContent = Math.round(sfxVolume * 100) + "%";
  $("music-volume-label").textContent = Math.round(musicVolume * 100) + "%";
  $("music-volume").disabled = Object.keys(project.visuals?.audio?.musicTracks || {}).length === 0;
}

function selectMissionMusic() {
  audio.selectMusic(project.visuals?.audio?.musicByMission?.[missionId] || "");
}

function initSelectors() {
  const missionSelect = $("mission-select");
  // Start on an unlocked mission (the default may be gated behind unlockRequiresMissionIds).
  if (!isUnlocked(missionId)) { const first = Object.keys(content.missions).find(isUnlocked); if (first) { missionId = first; game = createGame(); } }
  refreshMissionOptions();
  initDifficultySelector();
  missionSelect.addEventListener("change", () => {
    if (!isUnlocked(missionSelect.value)) { missionSelect.value = missionId; return; } // locked
    missionId = missionSelect.value;
    towerId = content.missions[missionId]?.buildTowerIds?.[0] || Object.keys(content.towers)[0];
    game = createGame();
    victoryRewarded = false;
    selectedTowerId = null;
    setSellMode(false);
    initTowerSelector();
    initAbilityBar();
    applyBattleBackground();
    selectMissionMusic();
    showStoryForMission("beforeMission");
  });
  initTowerSelector();
}

function initDifficultySelector() {
  const select = $("difficulty-select");
  if (!select) return;
  select.innerHTML = content.difficulties.map((item) => \`<option value="\${escapeHtml(item.id)}">\${escapeHtml(item.label || item.id)}</option>\`).join("");
  select.value = difficultyId;
  select.onchange = () => {
    difficultyId = select.value;
    progress.selectedDifficultyId = difficultyId;
    saveProgress();
    game = createGame();
    victoryRewarded = false;
    selectedTowerId = null;
    initAbilityBar();
    message = "Difficulty changed to " + (content.difficulties.find((item) => item.id === difficultyId)?.label || difficultyId) + ".";
  };
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
function emptyProgress() {
  return { version: PROGRESS_VERSION, clearedMissionIds: [], starsByMission: {}, metaResources: {}, upgradeLevels: {}, selectedDifficultyId: content.defaultDifficultyId };
}
function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "null");
    const base = emptyProgress();
    if (Array.isArray(saved)) base.clearedMissionIds = saved;
    else if (saved && typeof saved === "object") Object.assign(base, saved);
    base.version = PROGRESS_VERSION;
    base.clearedMissionIds = (Array.isArray(base.clearedMissionIds) ? base.clearedMissionIds : []).filter((id) => typeof id === "string" && content.missions[id]);
    base.starsByMission = base.starsByMission && typeof base.starsByMission === "object" ? base.starsByMission : {};
    base.metaResources = normalizeMetaBag(base.metaResources);
    base.upgradeLevels = normalizeUpgradeLevels(base.upgradeLevels);
    return base;
  } catch (e) { return emptyProgress(); }
}
function saveProgress() {
  progress.clearedMissionIds = [...cleared];
  progress.version = PROGRESS_VERSION;
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); }
  catch (e) { /* storage unavailable */ }
}
function normalizeMetaBag(input) {
  const bag = {};
  for (const currency of content.metaProgression.currencies || []) bag[currency.id] = Math.max(0, Number(input?.[currency.id]) || 0);
  return bag;
}
function normalizeUpgradeLevels(input) {
  const levels = {};
  for (const [id, upgrade] of Object.entries(content.metaProgression.upgrades || {})) levels[id] = Math.max(0, Math.min(upgrade.maxLevel || 0, Math.floor(Number(input?.[id]) || 0)));
  return levels;
}
function addMetaResources(bag, multiplier = 1) {
  for (const currency of content.metaProgression.currencies || []) progress.metaResources[currency.id] = (progress.metaResources[currency.id] || 0) + (Number(bag?.[currency.id]) || 0) * multiplier;
}
function metaCostText(cost) {
  return Object.entries(cost || {}).map(([id, amount]) => amount + " " + ((content.metaProgression.currencies || []).find((item) => item.id === id)?.label || id)).join(" · ");
}
function canAffordMeta(cost) { return Object.entries(cost || {}).every(([id, amount]) => (progress.metaResources[id] || 0) >= Number(amount || 0)); }
function buyMetaUpgrade(id) {
  const upgrade = content.metaProgression.upgrades?.[id];
  if (!upgrade) return;
  const level = progress.upgradeLevels[id] || 0;
  const cost = upgrade.costs?.[level];
  if (!cost || !canAffordMeta(cost)) { message = cost ? "Not enough permanent currency." : "Upgrade is at max level."; return; }
  for (const [currencyId, amount] of Object.entries(cost)) progress.metaResources[currencyId] = (progress.metaResources[currencyId] || 0) - Number(amount || 0);
  progress.upgradeLevels[id] = level + 1;
  saveProgress();
  game = createGame();
  victoryRewarded = false;
  selectedTowerId = null;
  renderMetaPanel();
  message = upgrade.label + " upgraded to level " + (level + 1) + ".";
}
function renderMetaPanel() {
  const panel = $("meta-panel");
  const upgrades = Object.values(content.metaProgression.upgrades || {});
  const currencies = content.metaProgression.currencies || [];
  if (!panel) return;
  panel.hidden = upgrades.length === 0 && currencies.length === 0;
  $("meta-resources").textContent = currencies.map((item) => (progress.metaResources[item.id] || 0) + " " + item.label).join(" · ");
  $("meta-upgrades").innerHTML = upgrades.map((upgrade) => {
    const level = progress.upgradeLevels[upgrade.id] || 0;
    const cost = upgrade.costs?.[level];
    return \`<div class="meta-upgrade"><span><b>\${escapeHtml(upgrade.label || upgrade.id)}</b><br>Lv \${level}/\${upgrade.maxLevel}</span><button type="button" data-meta-upgrade="\${escapeHtml(upgrade.id)}"\${cost && canAffordMeta(cost) ? "" : " disabled"}>\${cost ? escapeHtml(metaCostText(cost)) : "Max"}</button></div>\`;
  }).join("");
  for (const button of document.querySelectorAll("[data-meta-upgrade]")) button.onclick = () => buyMetaUpgrade(button.dataset.metaUpgrade);
}
function unlockReqs(id) { const n = ((content.worldMap && content.worldMap.missionNodes) || []).find((x) => x.missionId === id); return (n && n.unlockRequiresMissionIds) || []; }
function isUnlocked(id) { return unlockReqs(id).every((r) => cleared.has(r)); }
function rewardMissionClear(id, stars) {
  const firstClear = !cleared.has(id);
  cleared.add(id);
  const reward = content.metaProgression.rewardsByMission?.[id] || {};
  addMetaResources(firstClear ? reward.firstClear : reward.repeatClear);
  const previousStars = Math.max(0, Number(progress.starsByMission[id]) || 0);
  const earnedStars = Math.max(previousStars, stars);
  addMetaResources(reward.perStar, earnedStars - previousStars);
  progress.starsByMission[id] = earnedStars;
  saveProgress();
  renderMetaPanel();
  return firstClear;
}
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

function resolveStandaloneSprite(spriteId) {
  const src = content.visuals?.sprites?.[spriteId]?.src;
  if (typeof src !== "string" || !src) return "";
  return visualAssetUrl(src);
}

function visualAssetUrl(src) {
  if (/^(?:data:|blob:|https?:)/i.test(src)) return src;
  return "./" + String(src).split("/").map(encodeURIComponent).join("/");
}

function applyBattleBackground() {
  const fallback = content.battleBackgroundFallbackMissionId;
  const definition = content.battleBackgrounds?.[missionId] || (fallback ? content.battleBackgrounds?.[fallback] : null) || {};
  const playfield = $("playfield");
  playfield.style.backgroundColor = definition.color || "#101410";
  const src = resolveStandaloneSprite(definition.spriteId);
  const opacity = Math.max(0, Math.min(1, Number(definition.opacity ?? 1)));
  const color = /^#[0-9a-f]{6}$/i.test(definition.color || "") ? definition.color : "#101410";
  const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16)).join(",");
  const tint = opacity < 1 ? "linear-gradient(rgba(" + rgb + "," + (1 - opacity) + "),rgba(" + rgb + "," + (1 - opacity) + "))," : "";
  playfield.style.backgroundImage = src ? tint + "url(" + JSON.stringify(src) + ")" : "none";
}

function showStoryForMission(trigger) {
  const entry = Object.entries(content.storyComics || {}).find(([, comic]) => comic?.missionId === missionId && (comic.trigger || "beforeMission") === trigger);
  if (!entry) return;
  const [comicId, comic] = entry;
  const runKey = trigger + ":" + comicId;
  if (shownStories.has(runKey)) return;
  const seenKey = content.storySeenStoragePrefix + PROGRESS_KEY.slice("towerforge:progress:".length) + ":" + comicId;
  if (comic.replay !== "always") {
    try { if (localStorage.getItem(seenKey) === "1") return; } catch {}
  }
  shownStories.add(runKey);
  storyWasRunning = Number($("speed").value) > 0;
  setPaused(true);
  activeStory = { comicId, comic, panelIndex: 0, seenKey };
  $("story-overlay").hidden = false;
  renderStoryPanel();
  $("story-next").focus();
}

function renderStoryPanel() {
  if (!activeStory) return;
  const { comic, panelIndex } = activeStory;
  const panel = comic.panels[panelIndex];
  $("story-title").textContent = comic.title || content.missions[comic.missionId]?.label || comic.missionId;
  $("story-speaker").textContent = panel.speaker || "";
  $("story-text").textContent = panel.text;
  const art = $("story-art");
  const src = resolveStandaloneSprite(panel.spriteId);
  art.hidden = !src;
  art.style.backgroundImage = src ? "url(" + JSON.stringify(src) + ")" : "none";
  $("story-next").textContent = panelIndex >= comic.panels.length - 1 ? "Continue" : "Next";
}

function advanceStory() {
  if (!activeStory) return;
  if (activeStory.panelIndex < activeStory.comic.panels.length - 1) {
    activeStory.panelIndex += 1;
    renderStoryPanel();
  } else finishStory();
}

function finishStory() {
  if (!activeStory) return;
  try { localStorage.setItem(activeStory.seenKey, "1"); } catch {}
  activeStory = null;
  $("story-overlay").hidden = true;
  if (storyWasRunning) setPaused(false);
  $("start-wave").focus();
}

function loop(now) {
  const dtSeconds = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  const speed = Number($("speed").value) || 0;
  // Capture events from player actions (place/upgrade/ability/first wave) BEFORE tick() clears
  // them — tick() resets lastEvents at its start, so reading only after ticking drops them and
  // their sounds/effects never fire. One render snapshot per frame drives draw + HUD (no extra
  // deep-copy getSnapshot() calls).
  let snap = game.getRenderSnapshot();
  const pending = snap.lastEvents;
  const ticked = speed > 0 && snap.outcome === "playing";
  if (ticked) {
    const timeUnitSeconds = content.constants.timeUnitSeconds || 1;
    game.tick((dtSeconds / timeUnitSeconds) * speed);
    snap = game.getRenderSnapshot();
  }
  const events = ticked ? pending.concat(snap.lastEvents) : pending;
  game.lastEvents = []; // consumed this frame — clear so nothing replays on the next frame
  draw(snap, events);
  updateHud(snap);
  requestAnimationFrame(loop);
}

function resize() {
  renderer.resize();
}

function draw(snap, events) {
  snap.lastEvents = events;
  renderer.drawSnapshot(snap);
  if ($("snd")?.checked) audio.handleEvents(events);
}

function updateHud(snap) {
  updateAbilityBar(snap);
  updateTargetMode(snap);
  if (snap.outcome === "victory" && !victoryRewarded) {
    victoryRewarded = true;
    const firstClear = rewardMissionClear(missionId, (snap.stars || []).filter((item) => item.achieved).length);
    const unlocked = firstClear ? newlyUnlockedBy(missionId) : [];
    message = (firstClear ? "Mission cleared!" : "Mission cleared again!") + (unlocked.length ? " Unlocked: " + unlocked.join(", ") : "");
    refreshMissionOptions();
    showStoryForMission("afterVictory");
  }
  $("mission-caption").textContent = content.missions[missionId]?.description || content.missions[missionId]?.label || missionId;
  $("stat-outcome").textContent = snap.outcome;
  $("stat-core").textContent = \`\${snap.coreHp}/\${snap.maxCoreHp}\`;
  $("stat-resources").textContent = Object.entries(snap.resources).map(([id, value]) => { const c = (content.currencies || []).find((c) => c.id === id); return \`\${c ? c.label : id}: \${value}\`; }).join(" · ");
  $("stat-wave").textContent = \`\${snap.startedWaveCount}/\${snap.totalWaves} \${snap.waveState}\`;
  $("stat-enemies").textContent = String(snap.enemies.length);
  $("stat-towers").textContent = String(snap.towers.length);
  const objectives = snap.objectiveProgress || [];
  const stars = snap.stars || [];
  $("stat-objectives").textContent = objectives.filter((item) => item.complete).length + "/" + objectives.length
    + (stars.length ? " | " + stars.filter((item) => item.achieved).length + "/" + stars.length + " stars" : "");
  $("message").textContent = message;
}

function updateTargetMode(snap) {
  const select = $("target-mode");
  const tower = selectedTowerId ? snap.towers.find((item) => item.id === selectedTowerId) : null;
  if (!tower) selectedTowerId = null;
  select.disabled = !tower || !tower.targetMode;
  if (tower && tower.targetMode) select.value = tower.targetMode === "largest_hp" ? "strongest" : tower.targetMode === "fastest_ahead" ? "first" : tower.targetMode;
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

function applyProjectTheme() {
  const palette = content.visuals?.theme?.ui ?? {};
  for (const [key, value] of Object.entries(palette)) {
    if (/^[a-z][a-z0-9-]*$/i.test(key) && /^#[0-9a-f]{6}$/i.test(value)) {
      document.documentElement.style.setProperty(\`--\${key}\`, value);
    }
  }
}
`;
}

function phaserPlayerTemplate() {
  return `import { createGameContentRegistry, TowerDefenseGame } from "./engine/index.js";
import { createAudioPlayer } from "./renderer/audio.mjs";
import { resolveAutotile } from "./renderer/autotile.mjs";
import project from "./project-data.js";

const content = createGameContentRegistry({
  balance: project.balance,
  maps: project.maps,
  worldMap: project.worldMap,
  scripts: project.scripts,
  visuals: project.visuals,
  storyComics: project.storyComics,
  battleBackgrounds: project.battleBackgrounds
});

const $ = (id) => document.getElementById(id);
applyProjectTheme();
const audio = createAudioPlayer({ audio: project.visuals && project.visuals.audio });
const PROGRESS_KEY = "towerforge:progress:" + ((project.buildTarget && project.buildTarget.appId) || (project.manifest && project.manifest.name) || "game");
const PROGRESS_VERSION = 2;
let progress = loadProgress();
let cleared = new Set(progress.clearedMissionIds);
let missionId = content.defaultMissionId || Object.keys(content.missions)[0];
let difficultyId = content.difficulties.some((item) => item.id === progress.selectedDifficultyId) ? progress.selectedDifficultyId : content.defaultDifficultyId;
let towerId = content.missions[missionId]?.buildTowerIds?.[0] || Object.keys(content.towers)[0];
let game = createGame();
let message = "Choose a tower, click a buildable tile, then start the wave.";
let armedAbility = null;
let sellMode = false;
let selectedTowerId = null;
let keyboardCoord = null;
let lastRunningSpeed = 1;
let activeStory = null;
let storyWasRunning = false;
let victoryRewarded = false;
const shownStories = new Set();

const rendererTheme = content.visuals?.theme?.renderer ?? {};
const TERRAIN_COLORS = {
  buildable: colorNumber(rendererTheme.buildable, 0x1d2a1d),
  path: colorNumber(rendererTheme.path, 0x6b5540),
  water: colorNumber(rendererTheme.water, 0x427b88),
  blocked: colorNumber(rendererTheme.blocked, 0x252820),
  spawn: colorNumber(rendererTheme.spawn, 0x735e2c),
  core: colorNumber(rendererTheme.core, 0x3f6f43)
};

initSelectors();
initAbilityBar();
renderMetaPanel();
$("start-wave").addEventListener("click", () => { audio.resume(); report(game.startNextWave()); });
$("pause-run").addEventListener("click", () => setPaused(Number($("speed").value) > 0));
$("sell-mode").addEventListener("click", () => setSellMode(!sellMode));
$("reset-run").addEventListener("click", () => { game = createGame(); victoryRewarded = false; selectedTowerId = null; initAbilityBar(); setSellMode(false); message = "Run reset."; });
$("reset-progress")?.addEventListener("click", () => { progress = emptyProgress(); cleared = new Set(); difficultyId = content.defaultDifficultyId; saveProgress(); refreshMissionOptions(); initDifficultySelector(); renderMetaPanel(); game = createGame(); victoryRewarded = false; message = "Campaign progress reset."; });
$("speed").addEventListener("input", syncSpeedUi);
$("snd").addEventListener("change", () => { syncAudioSettings(); if ($("snd").checked) audio.resume(); });
$("sfx-volume").addEventListener("input", () => { syncAudioSettings(); if ($("snd").checked) audio.resume(); });
$("music-volume").addEventListener("input", () => { syncAudioSettings(); if ($("snd").checked) audio.resume(); });
$("target-mode").addEventListener("change", () => {
  if (!selectedTowerId) return;
  report(game.setTowerTargetMode(selectedTowerId, $("target-mode").value));
});
$("story-next").addEventListener("click", advanceStory);
$("story-skip").addEventListener("click", finishStory);
document.addEventListener("keydown", (event) => {
  const tag = event.target?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
  if (event.code === "Space") { event.preventDefault(); setPaused(Number($("speed").value) > 0); return; }
  if (document.activeElement !== $("playfield")) return;
  const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (moves[event.key]) { event.preventDefault(); moveKeyboardCursor(moves[event.key][0], moves[event.key][1]); }
  else if (event.key === "Enter") { event.preventDefault(); actAtCoord(ensureKeyboardCoord()); }
  else if (event.key === "Escape") { event.preventDefault(); setArmed(null); setSellMode(false); message = "Build action cancelled."; }
});
syncSpeedUi();
syncAudioSettings();
applyBattleBackground();
selectMissionMusic();
showStoryForMission("beforeMission");
$("playfield").addEventListener("focus", () => syncKeyboardCursor(ensureKeyboardCoord()));

function createGame() { return new TowerDefenseGame({ missionId, content, difficultyId, metaUpgradeLevels: progress.upgradeLevels }); }

function actAtCoord(coord) {
  if (!coord) return;
  if (sellMode) {
    const towerAt = game.getTowerIdAt(coord);
    report(towerAt ? game.sellTower(towerAt) : { ok: false, reason: "Choose a tower tile." });
    if (towerAt === selectedTowerId) selectedTowerId = null;
    setSellMode(false);
    return;
  }
  if (armedAbility) { report(game.useAbility(armedAbility, coord)); setArmed(null); return; }
  const towerAt = game.getTowerIdAt(coord);
  if (towerAt) { selectedTowerId = towerAt; message = "Tower selected."; return; }
  if (!towerId) return;
  const result = game.placeTower(towerId, coord);
  report(result);
  if (result.ok) selectedTowerId = game.getTowerIdAt(coord);
}

function ensureKeyboardCoord() {
  const tiles = game.getSnapshot().tiles;
  if (keyboardCoord && tiles.some((tile) => tile.q === keyboardCoord.q && tile.r === keyboardCoord.r)) return keyboardCoord;
  const tile = tiles.find((item) => item.terrain === "buildable") || tiles[0];
  keyboardCoord = tile ? { q: tile.q, r: tile.r } : null;
  return keyboardCoord;
}

function syncKeyboardCursor(coord) {
  keyboardCoord = coord ? { q: coord.q, r: coord.r } : null;
  const tile = keyboardCoord && game.getSnapshot().tiles.find((item) => item.q === keyboardCoord.q && item.r === keyboardCoord.r);
  $("playfield").setAttribute("aria-label", tile ? "Hex battlefield. Selected tile q " + tile.q + ", r " + tile.r + ", " + tile.terrain + ". Arrow keys move; Enter acts; Escape cancels." : "Hex battlefield.");
}

function moveKeyboardCursor(dq, dr) {
  const current = ensureKeyboardCoord();
  if (!current) return;
  const tiles = game.getSnapshot().tiles;
  const target = tiles.find((tile) => tile.q === current.q + dq && tile.r === current.r + dr);
  if (target) syncKeyboardCursor(target);
}

function setSellMode(active) {
  sellMode = Boolean(active);
  $("sell-mode").setAttribute("aria-pressed", String(sellMode));
  if (sellMode) { setArmed(null); message = "Click a tower to sell it."; }
}

function setPaused(paused) {
  const speed = $("speed");
  const current = Number(speed.value) || 0;
  if (paused) {
    if (current > 0) lastRunningSpeed = current;
    speed.value = "0";
  } else {
    speed.value = String(lastRunningSpeed > 0 ? lastRunningSpeed : 1);
  }
  syncSpeedUi();
}

function syncSpeedUi() {
  const speed = Number($("speed").value) || 0;
  if (speed > 0) lastRunningSpeed = speed;
  $("speed-label").textContent = speed + "x";
  $("pause-run").textContent = speed > 0 ? "Pause" : "Resume";
  $("pause-run").setAttribute("aria-pressed", String(speed === 0));
}

function syncAudioSettings() {
  const enabled = $("snd").checked;
  const sfxVolume = Number($("sfx-volume").value);
  const musicVolume = Number($("music-volume").value);
  audio.setVolumes(sfxVolume, musicVolume);
  audio.setEnabled(enabled);
  $("sfx-volume-label").textContent = Math.round(sfxVolume * 100) + "%";
  $("music-volume-label").textContent = Math.round(musicVolume * 100) + "%";
  $("music-volume").disabled = Object.keys(project.visuals?.audio?.musicTracks || {}).length === 0;
}

function selectMissionMusic() {
  audio.selectMusic(project.visuals?.audio?.musicByMission?.[missionId] || "");
}

class PlayScene extends Phaser.Scene {
  preload() {
    for (const [atlasId, atlas] of Object.entries(content.visuals?.atlases || {})) {
      if (atlas?.src) this.load.image("tf-atlas:" + atlasId, visualAssetUrl(atlas.src));
    }
    for (const [spriteId, sprite] of Object.entries(content.visuals?.sprites || {})) {
      if (sprite?.src) this.load.image("tf-sprite:" + spriteId, visualAssetUrl(sprite.src));
    }
  }
  create() {
    this.tileG = this.add.graphics();
    this.fxG = this.add.graphics();
    this.entG = this.add.graphics();
    this.towerLabels = new Map();
    this.tileImages = new Map();
    this.tileTerrainState = new Map();
    this.tileImageKey = "";
    this.registerAtlasFrames();
    this.input.on("pointerdown", (p) => {
      audio.resume();
      const coord = this.pickTile(p.worldX, p.worldY);
      if (!coord) return;
      window.__towerforgeLastPointerCoord = coord;
      syncKeyboardCursor(coord);
      actAtCoord(coord);
    });
  }
  registerAtlasFrames() {
    for (const [spriteId, sprite] of Object.entries(content.visuals?.sprites || {})) {
      if (!sprite?.atlas || !sprite.frame) continue;
      const texture = this.textures.get("tf-atlas:" + sprite.atlas);
      const frame = sprite.frame;
      if (texture?.key !== "__MISSING" && !texture.has(spriteId)) texture.add(spriteId, 0, frame.x, frame.y, frame.w, frame.h);
    }
  }
  spriteTexture(spriteId) {
    const sprite = content.visuals?.sprites?.[spriteId];
    if (!sprite) return null;
    if (sprite.atlas && sprite.frame && this.textures.exists("tf-atlas:" + sprite.atlas)) return { key: "tf-atlas:" + sprite.atlas, frame: spriteId };
    if (sprite.src && this.textures.exists("tf-sprite:" + spriteId)) return { key: "tf-sprite:" + spriteId };
    return null;
  }
  geometry(tiles, grid) {
    let maxQ = 1, maxR = 1;
    for (const t of tiles) { if (t.q > maxQ) maxQ = t.q; if (t.r > maxR) maxR = t.r; }
    const W = this.scale.width, H = this.scale.height;
    if (grid?.kind === "square") {
      const cell = Math.min(W / (maxQ + 2), H / (maxR + 2));
      return { r: cell / 2, ox: cell, oy: cell, grid };
    }
    const r = Math.min(W / ((maxQ + 2) * 1.65), H / ((maxR + 2) * 1.45));
    return { r, ox: r * 1.5, oy: r * 1.5, grid: grid || { kind: "hex", layout: "odd-r" } };
  }
  center(coord, g) {
    if (g.grid.kind === "square") return { x: g.ox + coord.q * g.r * 2, y: g.oy + coord.r * g.r * 2 };
    return { x: g.ox + coord.q * g.r * 1.48 + (coord.r % 2) * g.r * 0.74, y: g.oy + coord.r * g.r * 1.28 };
  }
  pickTile(x, y) {
    const snap = game.getRenderSnapshot();
    const g = this.geometry(snap.tiles, snap.grid);
    let best = null, bestD = Infinity;
    for (const t of snap.tiles) { const p = this.center(t, g); const d = Math.hypot(p.x - x, p.y - y); if (d < bestD) { bestD = d; best = t; } }
    return best && bestD <= (g.grid.kind === "square" ? g.r * Math.SQRT2 : g.r * 0.95) ? { q: best.q, r: best.r } : null;
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
  cell(gr, x, y, r, fill, alpha, grid) {
    if (grid.kind === "square") {
      gr.fillStyle(fill, alpha == null ? 1 : alpha);
      gr.fillRect(x - r, y - r, r * 2, r * 2);
      gr.lineStyle(1, 0xffffff, 0.08);
      gr.strokeRect(x - r, y - r, r * 2, r * 2);
      return;
    }
    this.hex(gr, x, y, r, fill, alpha);
  }
  syncTileImages(snap, g) {
    const stateKey = [snap.mapId, snap.grid?.kind, this.scale.width, this.scale.height].join("|");
    const fullRedraw = stateKey !== this.tileImageKey;
    if (fullRedraw) {
      for (const images of this.tileImages.values()) for (const image of images) this.destroyTileImage(image);
      this.tileImages.clear();
      this.tileTerrainState.clear();
      this.tileImageKey = stateKey;
    }
    const map = { id: snap.mapId || snap.missionId, grid: snap.grid, tiles: snap.tiles, pathRoutes: snap.pathRoutes || [] };
    const tileByKey = new Map(snap.tiles.map((tile) => [tile.q + "," + tile.r, tile]));
    const dirty = new Set();
    for (const tile of snap.tiles) {
      const key = tile.q + "," + tile.r;
      if (fullRedraw || this.tileTerrainState.get(key) !== tile.terrain) {
        dirty.add(key);
        for (const neighbor of this.renderingNeighbors(tile, snap.grid)) dirty.add(neighbor.q + "," + neighbor.r);
      }
    }
    for (const key of dirty) {
      for (const image of this.tileImages.get(key) || []) this.destroyTileImage(image);
      this.tileImages.delete(key);
      const tile = tileByKey.get(key);
      if (!tile) continue;
      const resolved = resolveAutotile({ map, visuals: content.visuals, coord: tile, terrain: tile.terrain, seed: content.visuals?.tileSeed || 0 });
      const p = this.center(tile, g);
      if (resolved.sectors?.length) {
        for (const sector of resolved.sectors) this.addTileImage(sector.selected, p, g, sector.direction, key);
      } else {
        this.addTileImage(resolved.selected, p, g, null, key);
      }
    }
    this.tileTerrainState = new Map(snap.tiles.map((tile) => [tile.q + "," + tile.r, tile.terrain]));
  }
  destroyTileImage(image) {
    image.__towerforgeMask?.destroy();
    image.__towerforgeMaskShape?.destroy();
    image.destroy();
  }
  renderingNeighbors(coord, grid) {
    if (grid?.kind === "square") return [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]].map(([q,r]) => ({ q: coord.q + q, r: coord.r + r }));
    const offsets = coord.r % 2 === 0 ? [[-1,-1],[0,-1],[1,0],[0,1],[-1,1],[-1,0]] : [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,0]];
    return offsets.map(([q,r]) => ({ q: coord.q + q, r: coord.r + r }));
  }
  addTileImage(selected, p, g, sectorDirection, tileKey) {
    const texture = this.spriteTexture(selected?.spriteId);
    if (!texture) return;
    const size = g.r * 1.72;
    const image = this.add.image(p.x, p.y, texture.key, texture.frame).setDisplaySize(size, size).setDepth(-1);
    const transform = selected.transform;
    image.setFlip(Boolean(transform?.flipX), Boolean(transform?.flipY));
    image.setAngle(Number(transform?.rotate || 0));
    if (sectorDirection) {
      const shape = this.make.graphics({ add: false });
      shape.fillStyle(0xffffff, 1);
      if (g.grid.kind === "square") {
        const quadrants = { NW: [-size / 2, -size / 2], NE: [0, -size / 2], SE: [0, 0], SW: [-size / 2, 0] };
        const offset = quadrants[sectorDirection] || quadrants.NW;
        shape.fillRect(p.x + offset[0], p.y + offset[1], size / 2, size / 2);
      } else {
        const directions = ["NW", "NE", "E", "SE", "SW", "W"];
        const index = Math.max(0, directions.indexOf(sectorDirection));
        const start = -Math.PI + index * Math.PI / 3;
        shape.fillTriangle(
          p.x, p.y,
          p.x + Math.cos(start) * size / 2, p.y + Math.sin(start) * size / 2,
          p.x + Math.cos(start + Math.PI / 3) * size / 2, p.y + Math.sin(start + Math.PI / 3) * size / 2
        );
      }
      const mask = shape.createGeometryMask();
      image.setMask(mask);
      image.__towerforgeMask = mask;
      image.__towerforgeMaskShape = shape;
    }
    const images = this.tileImages.get(tileKey) || [];
    images.push(image);
    this.tileImages.set(tileKey, images);
  }
  update(time, delta) {
    if (document.hidden) return; // paused while backgrounded (see the visibilitychange listener)
    const speed = Number($("speed").value) || 0;
    // Capture player-action events before tick() clears them (see canvas loop note).
    let snap = game.getRenderSnapshot();
    const pending = snap.lastEvents;
    const ticked = speed > 0 && snap.outcome === "playing";
    if (ticked) {
      const tu = content.constants.timeUnitSeconds || 1;
      game.tick((Math.min(50, delta) / 1000 / tu) * speed);
      snap = game.getRenderSnapshot();
    }
    const events = ticked ? pending.concat(snap.lastEvents) : pending;
    game.lastEvents = []; // consumed this frame — clear so nothing replays next frame
    if ($("snd")?.checked) audio.handleEvents(events);
    const g = this.geometry(snap.tiles, snap.grid);
    this.syncTileImages(snap, g);
    const map = { id: snap.mapId || snap.missionId, grid: snap.grid, tiles: snap.tiles, pathRoutes: snap.pathRoutes || [] };

    this.tileG.clear();
    for (const t of snap.tiles) {
      const resolved = resolveAutotile({ map, visuals: content.visuals, coord: t, terrain: t.terrain, seed: content.visuals?.tileSeed || 0 });
      const missingVisual = resolved.sectors?.length
        ? resolved.sectors.some((sector) => !this.spriteTexture(sector.selected?.spriteId))
        : !this.spriteTexture(resolved.selected?.spriteId);
      if (missingVisual) {
        const p = this.center(t, g);
        this.cell(this.tileG, p.x, p.y, g.r * 0.86, TERRAIN_COLORS[t.terrain] ?? TERRAIN_COLORS.buildable, 1, g.grid);
      }
    }
    for (const w of snap.temporaryWaterTiles) { const p = this.center(w, g); this.cell(this.tileG, p.x, p.y, g.r * 0.74, 0x427b88, 0.55, g.grid); }
    if (keyboardCoord) {
      const p = this.center(keyboardCoord, g);
      this.tileG.lineStyle(Math.max(2, g.r * 0.12), 0xe8f4db, 1);
      if (g.grid.kind === "square") this.tileG.strokeRect(p.x - g.r * 0.72, p.y - g.r * 0.72, g.r * 1.44, g.r * 1.44);
      else this.tileG.strokeCircle(p.x, p.y, g.r * 0.64);
    }

    this.fxG.clear();
    for (const ev of events) {
      if (ev.type !== "towerFired") continue;
      const tw = snap.towers.find((t) => t.id === ev.towerId);
      const en = snap.enemies.find((e) => e.id === ev.enemyId);
      if (tw && en) { const a = this.center(tw.coord, g), b = this.enemyPos(en, snap, g); this.fxG.lineStyle(2, 0xffe2a8, 0.85); this.fxG.lineBetween(a.x, a.y, b.x, b.y); }
    }

    this.entG.clear();
    const seen = new Set();
    for (const tw of snap.towers) {
      const p = this.center(tw.coord, g); seen.add(tw.id);
      const disabled = (tw.disabledFor ?? 0) > 0; // silenced by an enemy tower-disrupt pulse
      const alpha = disabled ? 0.4 : 1;
      this.entG.fillStyle(0x8ac783, alpha); this.entG.fillCircle(p.x, p.y, g.r * 0.5);
      this.entG.lineStyle(2, disabled ? 0xdf6a59 : 0xe8f4db, alpha); this.entG.strokeCircle(p.x, p.y, g.r * 0.5);
      // Health bar for damaged destructible towers (hp defined and below the type's maxHp).
      const tMax = content.towers[tw.typeId]?.maxHp;
      if (typeof tw.hp === "number" && typeof tMax === "number" && tMax > 0 && tw.hp < tMax) {
        const frac = Math.max(0, Math.min(1, tw.hp / tMax));
        this.entG.fillStyle(0x1b1d18, 1); this.entG.fillRect(p.x - g.r * 0.45, p.y + g.r * 0.5, g.r * 0.9, 4);
        this.entG.fillStyle(frac > 0.35 ? 0x8ac783 : 0xdf6a59, 1); this.entG.fillRect(p.x - g.r * 0.45, p.y + g.r * 0.5, g.r * 0.9 * frac, 4);
      }
      let label = this.towerLabels.get(tw.id);
      const text = (content.towers[tw.typeId]?.label || tw.typeId).slice(0, 2);
      if (!label) { label = this.add.text(0, 0, text, { fontFamily: "sans-serif", color: "#101410" }).setOrigin(0.5).setDepth(10); this.towerLabels.set(tw.id, label); }
      label.setText(text).setFontSize(Math.max(10, Math.round(g.r * 0.42))).setPosition(p.x, p.y).setAlpha(alpha);
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

    // Outcome banner (VICTORY/DEFEAT), matching the canvas renderer so the phaser build doesn't
    // hide the end-of-mission state.
    const ended = snap.outcome === "victory" || snap.outcome === "defeat";
    if (ended && !this.outcomeText) {
      this.outcomeText = this.add.text(0, 0, "", { fontFamily: "sans-serif", fontStyle: "bold" }).setOrigin(0.5).setDepth(20);
    }
    if (this.outcomeText) {
      if (ended) {
        this.outcomeText.setText(snap.outcome === "victory" ? "VICTORY" : "DEFEAT")
          .setColor(snap.outcome === "victory" ? "#8ac783" : "#df6a59")
          .setFontSize(Math.max(28, Math.round(this.scale.height * 0.12)))
          .setPosition(this.scale.width / 2, this.scale.height / 2)
          .setVisible(true);
      } else {
        this.outcomeText.setVisible(false);
      }
    }

    updateHud(snap);
  }
}

const phaserGame = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "playfield",
  transparent: true,
  // Low-end-Android render hardening (ported from a shipped Capacitor game): no MSAA (fill-rate is
  // the #1 killer on cheap GPUs), request the high-performance GPU, and a low-latency canvas.
  // panicMax bounds delta catch-up so a background stall can't trigger a spiral-of-death on resume.
  render: { antialias: false, powerPreference: "high-performance", desynchronized: true, roundPixels: true },
  fps: { target: 60, limit: 60, panicMax: 120 },
  scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
  scene: PlayScene
});
window.__towerforgeInspect = () => game.getRenderSnapshot();
window.__towerforgeTilePoint = (coord) => {
  const scene = phaserGame.scene.getScenes(true)[0];
  if (!scene) return null;
  const snapshot = game.getRenderSnapshot();
  const point = scene.center(coord, scene.geometry(snapshot.tiles, snapshot.grid));
  const rect = phaserGame.canvas.getBoundingClientRect();
  return { x: rect.left + point.x * rect.width / scene.scale.width, y: rect.top + point.y * rect.height / scene.scale.height };
};
window.__towerforgePickPoint = (point) => {
  const scene = phaserGame.scene.getScenes(true)[0];
  if (!scene) return null;
  const rect = phaserGame.canvas.getBoundingClientRect();
  return scene.pickTile((point.x - rect.left) * scene.scale.width / rect.width, (point.y - rect.top) * scene.scale.height / rect.height);
};
window.__towerforgeBootOk = true;

// Free the audio hardware while the app is backgrounded (the scene's update() already bails on
// document.hidden). Saves battery in a wrapped APK; no-op on desktop.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { audio.suspend(); }
  else if ($("snd")?.checked) { audio.resume(); }
});

// Register the offline service worker (the canvas player does the same) so the phaser build is
// actually an installable, offline-capable PWA — Phaser is vendored locally precisely for this.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./offline-sw.js").catch(() => {}));
}

function initSelectors() {
  const missionSelect = $("mission-select");
  // Start on an unlocked mission (the default may be gated behind unlockRequiresMissionIds).
  if (!isUnlocked(missionId)) { const first = Object.keys(content.missions).find(isUnlocked); if (first) { missionId = first; game = createGame(); } }
  refreshMissionOptions();
  initDifficultySelector();
  missionSelect.addEventListener("change", () => {
    if (!isUnlocked(missionSelect.value)) { missionSelect.value = missionId; return; } // locked
    missionId = missionSelect.value;
    towerId = content.missions[missionId]?.buildTowerIds?.[0] || Object.keys(content.towers)[0];
    game = createGame();
    victoryRewarded = false;
    selectedTowerId = null;
    setSellMode(false);
    initTowerSelector();
    initAbilityBar();
    applyBattleBackground();
    selectMissionMusic();
    showStoryForMission("beforeMission");
  });
  initTowerSelector();
}

function initDifficultySelector() {
  const select = $("difficulty-select");
  if (!select) return;
  select.innerHTML = content.difficulties.map((item) => \`<option value="\${escapeHtml(item.id)}">\${escapeHtml(item.label || item.id)}</option>\`).join("");
  select.value = difficultyId;
  select.onchange = () => {
    difficultyId = select.value;
    progress.selectedDifficultyId = difficultyId;
    saveProgress();
    game = createGame();
    victoryRewarded = false;
    selectedTowerId = null;
    initAbilityBar();
    message = "Difficulty changed to " + (content.difficulties.find((item) => item.id === difficultyId)?.label || difficultyId) + ".";
  };
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
function emptyProgress() {
  return { version: PROGRESS_VERSION, clearedMissionIds: [], starsByMission: {}, metaResources: {}, upgradeLevels: {}, selectedDifficultyId: content.defaultDifficultyId };
}
function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "null");
    const base = emptyProgress();
    if (Array.isArray(saved)) base.clearedMissionIds = saved;
    else if (saved && typeof saved === "object") Object.assign(base, saved);
    base.version = PROGRESS_VERSION;
    base.clearedMissionIds = (Array.isArray(base.clearedMissionIds) ? base.clearedMissionIds : []).filter((id) => typeof id === "string" && content.missions[id]);
    base.starsByMission = base.starsByMission && typeof base.starsByMission === "object" ? base.starsByMission : {};
    base.metaResources = normalizeMetaBag(base.metaResources);
    base.upgradeLevels = normalizeUpgradeLevels(base.upgradeLevels);
    return base;
  } catch (e) { return emptyProgress(); }
}
function saveProgress() {
  progress.clearedMissionIds = [...cleared];
  progress.version = PROGRESS_VERSION;
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); }
  catch (e) { /* storage unavailable */ }
}
function normalizeMetaBag(input) {
  const bag = {};
  for (const currency of content.metaProgression.currencies || []) bag[currency.id] = Math.max(0, Number(input?.[currency.id]) || 0);
  return bag;
}
function normalizeUpgradeLevels(input) {
  const levels = {};
  for (const [id, upgrade] of Object.entries(content.metaProgression.upgrades || {})) levels[id] = Math.max(0, Math.min(upgrade.maxLevel || 0, Math.floor(Number(input?.[id]) || 0)));
  return levels;
}
function addMetaResources(bag, multiplier = 1) {
  for (const currency of content.metaProgression.currencies || []) progress.metaResources[currency.id] = (progress.metaResources[currency.id] || 0) + (Number(bag?.[currency.id]) || 0) * multiplier;
}
function metaCostText(cost) {
  return Object.entries(cost || {}).map(([id, amount]) => amount + " " + ((content.metaProgression.currencies || []).find((item) => item.id === id)?.label || id)).join(" · ");
}
function canAffordMeta(cost) { return Object.entries(cost || {}).every(([id, amount]) => (progress.metaResources[id] || 0) >= Number(amount || 0)); }
function buyMetaUpgrade(id) {
  const upgrade = content.metaProgression.upgrades?.[id];
  if (!upgrade) return;
  const level = progress.upgradeLevels[id] || 0;
  const cost = upgrade.costs?.[level];
  if (!cost || !canAffordMeta(cost)) { message = cost ? "Not enough permanent currency." : "Upgrade is at max level."; return; }
  for (const [currencyId, amount] of Object.entries(cost)) progress.metaResources[currencyId] = (progress.metaResources[currencyId] || 0) - Number(amount || 0);
  progress.upgradeLevels[id] = level + 1;
  saveProgress();
  game = createGame();
  victoryRewarded = false;
  selectedTowerId = null;
  renderMetaPanel();
  message = upgrade.label + " upgraded to level " + (level + 1) + ".";
}
function renderMetaPanel() {
  const panel = $("meta-panel");
  const upgrades = Object.values(content.metaProgression.upgrades || {});
  const currencies = content.metaProgression.currencies || [];
  if (!panel) return;
  panel.hidden = upgrades.length === 0 && currencies.length === 0;
  $("meta-resources").textContent = currencies.map((item) => (progress.metaResources[item.id] || 0) + " " + item.label).join(" · ");
  $("meta-upgrades").innerHTML = upgrades.map((upgrade) => {
    const level = progress.upgradeLevels[upgrade.id] || 0;
    const cost = upgrade.costs?.[level];
    return \`<div class="meta-upgrade"><span><b>\${escapeHtml(upgrade.label || upgrade.id)}</b><br>Lv \${level}/\${upgrade.maxLevel}</span><button type="button" data-meta-upgrade="\${escapeHtml(upgrade.id)}"\${cost && canAffordMeta(cost) ? "" : " disabled"}>\${cost ? escapeHtml(metaCostText(cost)) : "Max"}</button></div>\`;
  }).join("");
  for (const button of document.querySelectorAll("[data-meta-upgrade]")) button.onclick = () => buyMetaUpgrade(button.dataset.metaUpgrade);
}
function unlockReqs(id) { const n = ((content.worldMap && content.worldMap.missionNodes) || []).find((x) => x.missionId === id); return (n && n.unlockRequiresMissionIds) || []; }
function isUnlocked(id) { return unlockReqs(id).every((r) => cleared.has(r)); }
function rewardMissionClear(id, stars) {
  const firstClear = !cleared.has(id);
  cleared.add(id);
  const reward = content.metaProgression.rewardsByMission?.[id] || {};
  addMetaResources(firstClear ? reward.firstClear : reward.repeatClear);
  const previousStars = Math.max(0, Number(progress.starsByMission[id]) || 0);
  const earnedStars = Math.max(previousStars, stars);
  addMetaResources(reward.perStar, earnedStars - previousStars);
  progress.starsByMission[id] = earnedStars;
  saveProgress();
  renderMetaPanel();
  return firstClear;
}
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

function resolveStandaloneSprite(spriteId) {
  const src = content.visuals?.sprites?.[spriteId]?.src;
  if (typeof src !== "string" || !src) return "";
  return visualAssetUrl(src);
}

function visualAssetUrl(src) {
  if (/^(?:data:|blob:|https?:)/i.test(src)) return src;
  return "./" + String(src).split("/").map(encodeURIComponent).join("/");
}

function applyBattleBackground() {
  const fallback = content.battleBackgroundFallbackMissionId;
  const definition = content.battleBackgrounds?.[missionId] || (fallback ? content.battleBackgrounds?.[fallback] : null) || {};
  const playfield = $("playfield");
  playfield.style.backgroundColor = definition.color || "#101410";
  const src = resolveStandaloneSprite(definition.spriteId);
  const opacity = Math.max(0, Math.min(1, Number(definition.opacity ?? 1)));
  const color = /^#[0-9a-f]{6}$/i.test(definition.color || "") ? definition.color : "#101410";
  const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16)).join(",");
  const tint = opacity < 1 ? "linear-gradient(rgba(" + rgb + "," + (1 - opacity) + "),rgba(" + rgb + "," + (1 - opacity) + "))," : "";
  playfield.style.backgroundImage = src ? tint + "url(" + JSON.stringify(src) + ")" : "none";
}

function showStoryForMission(trigger) {
  const entry = Object.entries(content.storyComics || {}).find(([, comic]) => comic?.missionId === missionId && (comic.trigger || "beforeMission") === trigger);
  if (!entry) return;
  const [comicId, comic] = entry;
  const runKey = trigger + ":" + comicId;
  if (shownStories.has(runKey)) return;
  const seenKey = content.storySeenStoragePrefix + PROGRESS_KEY.slice("towerforge:progress:".length) + ":" + comicId;
  if (comic.replay !== "always") {
    try { if (localStorage.getItem(seenKey) === "1") return; } catch {}
  }
  shownStories.add(runKey);
  storyWasRunning = Number($("speed").value) > 0;
  setPaused(true);
  activeStory = { comicId, comic, panelIndex: 0, seenKey };
  $("story-overlay").hidden = false;
  renderStoryPanel();
  $("story-next").focus();
}

function renderStoryPanel() {
  if (!activeStory) return;
  const { comic, panelIndex } = activeStory;
  const panel = comic.panels[panelIndex];
  $("story-title").textContent = comic.title || content.missions[comic.missionId]?.label || comic.missionId;
  $("story-speaker").textContent = panel.speaker || "";
  $("story-text").textContent = panel.text;
  const art = $("story-art");
  const src = resolveStandaloneSprite(panel.spriteId);
  art.hidden = !src;
  art.style.backgroundImage = src ? "url(" + JSON.stringify(src) + ")" : "none";
  $("story-next").textContent = panelIndex >= comic.panels.length - 1 ? "Continue" : "Next";
}

function advanceStory() {
  if (!activeStory) return;
  if (activeStory.panelIndex < activeStory.comic.panels.length - 1) {
    activeStory.panelIndex += 1;
    renderStoryPanel();
  } else finishStory();
}

function finishStory() {
  if (!activeStory) return;
  try { localStorage.setItem(activeStory.seenKey, "1"); } catch {}
  activeStory = null;
  $("story-overlay").hidden = true;
  if (storyWasRunning) setPaused(false);
  $("start-wave").focus();
}

function updateHud(snap) {
  updateAbilityBar(snap);
  updateTargetMode(snap);
  if (snap.outcome === "victory" && !victoryRewarded) {
    victoryRewarded = true;
    const firstClear = rewardMissionClear(missionId, (snap.stars || []).filter((item) => item.achieved).length);
    const unlocked = firstClear ? newlyUnlockedBy(missionId) : [];
    message = (firstClear ? "Mission cleared!" : "Mission cleared again!") + (unlocked.length ? " Unlocked: " + unlocked.join(", ") : "");
    refreshMissionOptions();
    showStoryForMission("afterVictory");
  }
  $("mission-caption").textContent = content.missions[missionId]?.description || content.missions[missionId]?.label || missionId;
  $("stat-outcome").textContent = snap.outcome;
  $("stat-core").textContent = \`\${snap.coreHp}/\${snap.maxCoreHp}\`;
  $("stat-resources").textContent = Object.entries(snap.resources).map(([id, value]) => { const c = (content.currencies || []).find((c) => c.id === id); return \`\${c ? c.label : id}: \${value}\`; }).join(" · ");
  $("stat-wave").textContent = \`\${snap.startedWaveCount}/\${snap.totalWaves} \${snap.waveState}\`;
  $("stat-enemies").textContent = String(snap.enemies.length);
  $("stat-towers").textContent = String(snap.towers.length);
  const objectives = snap.objectiveProgress || [];
  const stars = snap.stars || [];
  $("stat-objectives").textContent = objectives.filter((item) => item.complete).length + "/" + objectives.length
    + (stars.length ? " | " + stars.filter((item) => item.achieved).length + "/" + stars.length + " stars" : "");
  $("message").textContent = message;
}

function updateTargetMode(snap) {
  const select = $("target-mode");
  const tower = selectedTowerId ? snap.towers.find((item) => item.id === selectedTowerId) : null;
  if (!tower) selectedTowerId = null;
  select.disabled = !tower || !tower.targetMode;
  if (tower && tower.targetMode) select.value = tower.targetMode === "largest_hp" ? "strongest" : tower.targetMode === "fastest_ahead" ? "first" : tower.targetMode;
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

function colorNumber(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? Number.parseInt(value.slice(1), 16) : fallback;
}

function applyProjectTheme() {
  const palette = content.visuals?.theme?.ui ?? {};
  for (const [key, value] of Object.entries(palette)) {
    if (/^[a-z][a-z0-9-]*$/i.test(key) && /^#[0-9a-f]{6}$/i.test(value)) {
      document.documentElement.style.setProperty(\`--\${key}\`, value);
    }
  }
}
`;
}

function serviceWorkerTemplate(precacheAssets = [], cacheVersion = "dev") {
  const assets = ["./", ...precacheAssets];
  return `const CACHE = "towerforge-build-${cacheVersion}";
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener("install", (event) => {
  self.skipWaiting();
  // Resilient precache: cache each URL independently (Promise.allSettled), so one missing/renamed
  // asset can't abort the whole install and leave the game uncached — unlike all-or-nothing addAll.
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.allSettled(ASSETS.map((url) => cache.add(url)))));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return; // leave cross-origin requests to the network
  // Navigations: network-first (a fresh index.html when online, so a returning player is never
  // pinned to a stale shell), falling back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((cache) => cache.put("./", copy)); return res; })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./")))
    );
    return;
  }
  // Assets: cache-first for instant loads, populating the cache with same-origin responses.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((res) => {
      if (res && res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); }
      return res;
    }))
  );
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
