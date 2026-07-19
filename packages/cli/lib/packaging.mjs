// packaging.mjs — wrap a built web bundle into a native app project.
//
//   kind "mobile"  → a Capacitor project (Android/iOS) under <project>/mobile
//   kind "desktop" → a Tauri v2 project (Windows/macOS/Linux) under <project>/desktop
//
// Neither publishes anything and neither needs network: they scaffold a self-contained project
// (native config + the built game bundle + a README with the exact local build + store steps) that
// the author builds locally with Android Studio / Xcode / the Rust + Tauri toolchain.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadProjectFiles, repoRoot, selectBuildTarget } from "./project-loader.mjs";

const CAPACITOR_VERSION = "^6.0.0";
const TAURI_CLI_VERSION = "^2.0.0";

/**
 * @param {string} projectDir
 * @param {{ kind?: "mobile"|"desktop", targetId?: string|null, outDir?: string|null }} [opts]
 */
export async function packageProject(projectDir, opts = {}) {
  const kind = opts.kind === "desktop" ? "desktop" : "mobile";
  const files = loadProjectFiles(projectDir);

  // The native app wraps a WEB bundle — pick a web target to actually build.
  const [selectedId, selected] = selectBuildTarget(files.buildTargets, opts.targetId ?? null);
  const webTarget = selected.platform === "web" ? [selectedId, selected] : firstWebTarget(files.buildTargets);
  if (!webTarget) {
    return { ok: false, projectDir, error: "No web build target found. Packaging wraps a web bundle — add a platform \"web\" target first." };
  }
  const [webTargetId] = webTarget;

  const app = appMeta(files.manifest, selected);
  const outDir = path.resolve(projectDir, opts.outDir ?? kind);
  assertUnderProject(projectDir, outDir);
  // Do NOT wipe the whole outDir: on a re-package it would destroy the user's native projects
  // (android/, ios/ from `npx cap add`, src-tauri/target/), their signing config, and node_modules.
  // The child build cleans only the web subdir (www/dist) below, and the scaffold files are
  // idempotent overwrites — so a re-package refreshes the bundle while preserving native work.
  fs.mkdirSync(outDir, { recursive: true });

  // Build the web bundle into the folder the native project serves from. The child build empties
  // just this web subdir, so a failed build leaves the native project intact (only the bundle is
  // cleared) rather than deleting everything under outDir.
  const webSub = kind === "desktop" ? "dist" : "www";
  const webRel = path.join(path.relative(projectDir, outDir), webSub);
  const build = await runBuild(projectDir, webTargetId, webRel);
  if (!build.ok) {
    return { ok: false, projectDir, error: build.error ?? "Web build failed.", output: build.output };
  }

  const nextSteps = kind === "desktop" ? writeTauri(outDir, app) : writeCapacitor(outDir, app);

  return { ok: true, projectDir, outDir, kind, webTargetId, app, copiedAssets: build.copiedAssets, nextSteps };
}

/** @deprecated kept for the mobile call sites; prefer packageProject. */
export function packageMobile(projectDir, opts = {}) {
  return packageProject(projectDir, { ...opts, kind: "mobile" });
}
export function packageDesktop(projectDir, opts = {}) {
  return packageProject(projectDir, { ...opts, kind: "desktop" });
}

// ── Capacitor (mobile) ──────────────────────────────────────────────────────────

function writeCapacitor(outDir, app) {
  writeJson(path.join(outDir, "capacitor.config.json"), {
    appId: app.appId,
    appName: app.appName,
    webDir: "www",
    backgroundColor: app.backgroundColor,
    // Hardening ported from a shipped Capacitor game: a game WebView should not pinch-zoom or
    // auto-focus inputs, should log quietly in production, and should keep the status bar out of
    // the playfield. These remove whole classes of "my APK feels broken" reports.
    zoomEnabled: false,
    initialFocus: false,
    loggingBehavior: "production",
    server: { androidScheme: "https" },
    android: {
      backgroundColor: app.backgroundColor,
      zoomEnabled: false,
      // Cheap devices can otherwise silently fall back to a slower WebView path; requiring it makes
      // behavior consistent, and captureInput keeps key events inside the game.
      captureInput: true,
      webContentsDebuggingEnabled: false
    },
    plugins: {
      StatusBar: {
        overlaysWebView: false,
        style: "DARK",
        backgroundColor: app.backgroundColor
      }
    }
  });
  writeJson(path.join(outDir, "package.json"), {
    name: app.slug,
    version: app.version,
    private: true,
    description: `${app.appName} — mobile wrapper (Capacitor).`,
    scripts: {
      "add:android": "cap add android",
      "add:ios": "cap add ios",
      sync: "cap sync",
      "open:android": "cap open android",
      "open:ios": "cap open ios"
    },
    devDependencies: { "@capacitor/cli": CAPACITOR_VERSION },
    dependencies: {
      "@capacitor/core": CAPACITOR_VERSION,
      "@capacitor/android": CAPACITOR_VERSION,
      "@capacitor/ios": CAPACITOR_VERSION
    }
  });
  fs.writeFileSync(path.join(outDir, ".gitignore"), "node_modules/\nandroid/\nios/\n", "utf8");
  fs.writeFileSync(path.join(outDir, "README.md"), capacitorReadme(app), "utf8");
  return [
    "cd mobile",
    "npm install",
    "npx cap add android   # and/or: npx cap add ios",
    "npx cap open android   # opens Android Studio to build/sign the store bundle"
  ];
}

// ── Tauri (desktop) ─────────────────────────────────────────────────────────────

function writeTauri(outDir, app) {
  const crate = app.crate;
  writeJson(path.join(outDir, "package.json"), {
    name: app.slug,
    version: app.version,
    private: true,
    description: `${app.appName} — desktop wrapper (Tauri).`,
    scripts: { tauri: "tauri", dev: "tauri dev", build: "tauri build" },
    devDependencies: { "@tauri-apps/cli": TAURI_CLI_VERSION }
  });
  writeJson(path.join(outDir, "src-tauri", "tauri.conf.json"), {
    $schema: "https://schema.tauri.app/config/2",
    productName: app.appName,
    version: app.version,
    identifier: app.appId,
    build: { frontendDist: "../dist" },
    app: {
      windows: [{ title: app.appName, width: 1024, height: 720, resizable: true }],
      security: { csp: null }
    },
    bundle: {
      active: true,
      targets: "all",
      icon: ["icons/32x32.png", "icons/128x128.png", "icons/icon.icns", "icons/icon.ico"]
    }
  });
  writeText(path.join(outDir, "src-tauri", "Cargo.toml"),
    `[package]
name = "${crate}"
version = "${app.version}"
edition = "2021"

[lib]
name = "${crate}_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
`);
  writeText(path.join(outDir, "src-tauri", "build.rs"), `fn main() {\n  tauri_build::build()\n}\n`);
  writeText(path.join(outDir, "src-tauri", "src", "main.rs"),
    `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  ${crate}_lib::run()
}
`);
  writeText(path.join(outDir, "src-tauri", "src", "lib.rs"),
    `#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
`);
  fs.writeFileSync(path.join(outDir, ".gitignore"), "node_modules/\nsrc-tauri/target/\n", "utf8");
  fs.writeFileSync(path.join(outDir, "README.md"), tauriReadme(app), "utf8");
  return [
    "cd desktop",
    "npm install",
    "npm run tauri icon ../assets/icon.png   # generate app icons (once, from a 1024×1024 png)",
    "npm run build                           # produces installers under src-tauri/target/release/bundle"
  ];
}

// ── helpers ────────────────────────────────────────────────────────────────────

function firstWebTarget(buildTargets) {
  for (const [id, t] of Object.entries(buildTargets?.targets ?? {})) {
    if ((t.platform ?? "web") === "web") return [id, t];
  }
  return null;
}

/** Derive native app metadata from the target + manifest, with a valid reverse-DNS appId + Rust crate. */
function appMeta(manifest, target) {
  const rawName = target.appName ?? target.appTitle ?? manifest?.name ?? "TowerForge Game";
  const slug = slugify(rawName) || "towerforge-game";
  // Identifier segments and Rust crate names must start with a letter (Android/Tauri/Cargo reject a
  // leading digit), so guard the derived-from-name cases against numeric project names like "2048".
  const idSegment = letterLed(slug.replace(/-/g, ""));
  const appId = isReverseDns(target.appId) ? target.appId : `com.towerforge.${idSegment}`;
  const crate = letterLed(slug.replace(/-/g, "_"));
  return {
    appId,
    appName: rawName,
    slug,
    crate,
    version: typeof target.appVersion === "string" && target.appVersion ? target.appVersion : "0.1.0",
    backgroundColor: target.backgroundColor ?? "#111111"
  };
}

/** Prefix an identifier so it starts with a letter (a leading digit is invalid for crates/app-ids). */
function letterLed(value) {
  return /^[a-zA-Z]/.test(value) ? value : `app${value}`;
}

/** Every dot-separated segment must start with a letter (Android package / Tauri identifier rule). */
function isReverseDns(value) {
  return typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(value);
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const BUILD_TIMEOUT_MS = 180_000;

function runBuild(projectDir, targetId, outRel) {
  return new Promise((resolve) => {
    const args = [path.join(repoRoot, "packages", "cli", "build.mjs"), "--project", projectDir, "--target", targetId, "--out", outRel, "--json"];
    const child = spawn(process.execPath, args, { cwd: repoRoot, timeout: BUILD_TIMEOUT_MS, killSignal: "SIGKILL" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("error", (e) => resolve({ ok: false, error: e.message }));
    child.on("close", (code, signal) => {
      if (signal) return resolve({ ok: false, error: `Build timed out after ${BUILD_TIMEOUT_MS}ms.` });
      try {
        const parsed = JSON.parse(stdout);
        resolve({ ok: parsed.ok !== false, error: parsed.error, copiedAssets: parsed.copiedAssets, output: stdout.trim() });
      } catch {
        resolve({ ok: code === 0, error: stderr.trim() || `Build exited with code ${code}.`, output: stdout.trim() });
      }
    });
  });
}

function assertUnderProject(projectDir, outDir) {
  const rel = path.relative(projectDir, outDir);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Refusing to package outside the project directory: ${outDir}`);
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function capacitorReadme(app) {
  return `# ${app.appName} — Mobile packaging (Capacitor)

This folder is a self-contained [Capacitor](https://capacitorjs.com) project that wraps the built
web game (in \`www/\`) into a native **Android** and **iOS** app you can build, sign, and submit to
the stores. Nothing here is published automatically — you run the native builds locally.

- **App id:** \`${app.appId}\`
- **App name:** ${app.appName}
- **Version:** ${app.version}

## Prerequisites
- Node.js 18+
- **Android:** [Android Studio](https://developer.android.com/studio) (JDK + Android SDK)
- **iOS:** macOS with [Xcode](https://developer.apple.com/xcode/) and CocoaPods

## Build the native app
\`\`\`bash
cd mobile
npm install

# Android
npx cap add android
npx cap sync android
npx cap open android      # → Build > Generate Signed Bundle/APK in Android Studio

# iOS (macOS only)
npx cap add ios
npx cap sync ios
npx cap open ios          # → Product > Archive in Xcode, then distribute
\`\`\`

When the game changes, re-run \`towerforge package\` (rebuilds \`www/\`) then \`npx cap sync\`.

## Store packaging checklist
- **Icons & splash:** \`npm i -D @capacitor/assets\` then \`npx capacitor-assets generate\`
  (drop a 1024×1024 \`icon.png\`/\`splash.png\` in an \`assets/\` folder first).
- **Version:** bump \`version\` here and in the native project (Android \`versionCode\`/\`versionName\`,
  iOS build/marketing version) for each store submission.
- **Android signing:** create a keystore, configure signing to produce a signed \`.aab\` for Google Play.
- **iOS signing:** set Team + Bundle Identifier (\`${app.appId}\`) in Xcode > Signing & Capabilities,
  then Archive and upload via the Organizer / Transporter.
- **Offline:** the bundle ships an offline service worker, so the app works without a network.

## Low-end device / stability checklist
The generated \`capacitor.config.json\` already hardens the web layer (no pinch-zoom, no input
auto-focus, quiet production logging, status bar out of the playfield). A few wins live in the
**native Android project** that \`npx cap add android\` generates — verify them in
\`android/app/src/main/AndroidManifest.xml\` before shipping:
- **\`android:hardwareAccelerated="true"\`** on \`<application>\` (Capacitor default) — required for smooth WebGL.
- **\`android:configChanges="orientation|screenSize|screenLayout|keyboardHidden|density|uiMode"\`** on the main activity so a rotation/resize does NOT recreate the Activity — recreation destroys the WebView's GL context and is a classic crash. Keep Capacitor's defaults.
- **Portrait lock** (if your game is portrait): add \`android:screenOrientation="portrait"\` to the activity.
- **Android 12+ Game Mode:** a \`res/xml/game_mode_config.xml\` with \`supportsBatteryGameMode\`/\`supportsPerformanceGameMode\` referenced via an application \`<meta-data android:name="android.game_mode_config">\` lets the OS grant better clocks.
- **Test in airplane mode** once: the offline service worker should let the game open with no network.
`;
}

function tauriReadme(app) {
  return `# ${app.appName} — Desktop packaging (Tauri v2)

This folder is a self-contained [Tauri v2](https://tauri.app) project that wraps the built web game
(in \`dist/\`) into a native **Windows / macOS / Linux** desktop app and installers. Nothing here is
published automatically — you run the build locally.

- **Identifier:** \`${app.appId}\`
- **Product name:** ${app.appName}
- **Version:** ${app.version}

## Prerequisites
- Node.js 18+
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- Platform build deps (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)):
  macOS → Xcode Command Line Tools; Windows → MSVC + WebView2; Linux → webkit2gtk + build-essential.

## Build the desktop app
\`\`\`bash
cd desktop
npm install
npm run tauri icon ../assets/icon.png   # once: generate icons/ from a 1024×1024 png
npm run build                           # → installers in src-tauri/target/release/bundle/
\`\`\`
\`npm run dev\` runs the app in a dev window. When the game changes, re-run \`towerforge package
--kind desktop\` to refresh \`dist/\`.

## Store / distribution notes
- **Icons are required** for a release build — run \`npm run tauri icon\` first (creates
  \`src-tauri/icons/\`). The game changes rarely, so do this once.
- **Version:** bump \`version\` in this \`package.json\` and \`src-tauri/tauri.conf.json\` per release.
- **Signing:** macOS notarization and Windows code-signing are configured in \`tauri.conf.json\`
  (\`bundle.macOS\` / \`bundle.windows\`) — see the Tauri distribution guide.
- **Stores:** the produced \`.dmg\`/\`.msi\`/\`.AppImage\`/\`.deb\` can be submitted to the Mac App Store,
  Microsoft Store, or distributed directly. The game runs fully offline.
`;
}
