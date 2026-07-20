import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageMobile, packageDesktop, packageWeb } from "./packaging.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tf-pkg-"));
const projectDir = path.join(tmp, "game.tdproj");

describe("mobile packaging (Capacitor)", () => {
  beforeAll(() => {
    // The packager builds a web bundle, which copies the compiled engine dist.
    if (!fs.existsSync(path.join(repoRoot, "packages/engine/dist/index.js"))) {
      execFileSync("npm", ["run", "build:engine"], { cwd: repoRoot, stdio: "ignore" });
    }
    execFileSync(process.execPath, [path.join(repoRoot, "packages/cli/create.mjs"), "game", "--dir", tmp, "--template", "classic"], { stdio: "ignore" });
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("wraps the web build into a valid Capacitor project", async () => {
    const result = await packageMobile(projectDir);
    expect(result.ok, result.error).toBe(true);

    const mobile = path.join(projectDir, "mobile");
    const cap = JSON.parse(fs.readFileSync(path.join(mobile, "capacitor.config.json"), "utf8"));
    expect(cap.webDir).toBe("www");
    expect(cap.appId).toBeTruthy();
    expect(cap.appName).toBeTruthy();

    // Native-game hardening ported from a shipped Capacitor game.
    expect(cap.zoomEnabled).toBe(false);
    expect(cap.initialFocus).toBe(false);
    expect(cap.loggingBehavior).toBe("production");
    expect(cap.plugins.StatusBar.overlaysWebView).toBe(false);

    const pkg = JSON.parse(fs.readFileSync(path.join(mobile, "package.json"), "utf8"));
    expect(pkg.dependencies["@capacitor/core"]).toBeTruthy();
    expect(pkg.dependencies["@capacitor/android"]).toBeTruthy();
    expect(pkg.dependencies["@capacitor/ios"]).toBeTruthy();

    // The built, playable web game lands in www/.
    expect(fs.existsSync(path.join(mobile, "www", "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(mobile, "www", "project-data.js"))).toBe(true);
    expect(fs.existsSync(path.join(mobile, "README.md"))).toBe(true);
  });

  it("creates a portable deterministic web archive with both launch modes", async () => {
    const result = await packageWeb(projectDir);
    expect(result.ok, result.error).toBe(true);
    expect(result.kind).toBe("web");
    expect(fs.existsSync(path.join(result.outDir, "game", "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(result.outDir, "game", "index.single.html"))).toBe(true);
    expect(fs.existsSync(path.join(result.outDir, "serve.mjs"))).toBe(true);
    expect(fs.existsSync(result.archive.outputPath)).toBe(true);
    const zip = fs.readFileSync(result.archive.outputPath);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.includes(Buffer.from("game/index.single.html"))).toBe(true);
    expect(zip.includes(Buffer.from("serve.mjs"))).toBe(true);
    const launcher = path.join(result.outDir, "serve.mjs");
    expect(execFileSync(process.execPath, [launcher, "--check-path", "/"], { encoding: "utf8" }).trim()).toBe("allowed");
    expect(execFileSync(process.execPath, [launcher, "--check-path", "/..%2fproject.json"], { encoding: "utf8" }).trim()).toBe("blocked");
  });

  it("derives a valid reverse-DNS appId and refuses to escape the project dir", async () => {
    const result = await packageMobile(projectDir);
    expect(/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/.test(result.app.appId)).toBe(true);
    await expect(packageMobile(projectDir, { outDir: "../escape" })).rejects.toThrow(/outside the project/);
  });

  it("preserves the user's native android/ project (and node_modules) across a re-package", async () => {
    await packageMobile(projectDir);
    const mobile = path.join(projectDir, "mobile");
    // Simulate what `npx cap add android` + `npm install` leave behind: a native project with
    // signing config, plus a stale file in the web bundle that a rebuild should drop.
    const keystoreRef = path.join(mobile, "android", "app", "build.gradle");
    fs.mkdirSync(path.dirname(keystoreRef), { recursive: true });
    fs.writeFileSync(keystoreRef, "signingConfigs { release { storeFile file('release.keystore') } }", "utf8");
    fs.mkdirSync(path.join(mobile, "node_modules", "@capacitor"), { recursive: true });
    fs.writeFileSync(path.join(mobile, "node_modules", "@capacitor", "marker"), "x", "utf8");
    fs.writeFileSync(path.join(mobile, "www", "stale-old-bundle.js"), "old", "utf8");

    const rerun = await packageMobile(projectDir);
    expect(rerun.ok, rerun.error).toBe(true);
    // Native project + deps survive the re-package...
    expect(fs.readFileSync(keystoreRef, "utf8")).toContain("release.keystore");
    expect(fs.existsSync(path.join(mobile, "node_modules", "@capacitor", "marker"))).toBe(true);
    // ...while the web bundle is freshly rebuilt (stale file gone, new files present).
    expect(fs.existsSync(path.join(mobile, "www", "stale-old-bundle.js"))).toBe(false);
    expect(fs.existsSync(path.join(mobile, "www", "index.html"))).toBe(true);
  });

  it("wraps the web build into a valid Tauri v2 desktop project", async () => {
    const result = await packageDesktop(projectDir);
    expect(result.ok, result.error).toBe(true);
    expect(result.kind).toBe("desktop");

    const desktop = path.join(projectDir, "desktop");
    const conf = JSON.parse(fs.readFileSync(path.join(desktop, "src-tauri", "tauri.conf.json"), "utf8"));
    expect(conf.identifier).toBeTruthy();
    expect(conf.build.frontendDist).toBe("../dist");

    const pkg = JSON.parse(fs.readFileSync(path.join(desktop, "package.json"), "utf8"));
    expect(pkg.devDependencies["@tauri-apps/cli"]).toBeTruthy();

    expect(fs.existsSync(path.join(desktop, "src-tauri", "Cargo.toml"))).toBe(true);
    expect(fs.existsSync(path.join(desktop, "src-tauri", "src", "main.rs"))).toBe(true);
    expect(fs.existsSync(path.join(desktop, "src-tauri", "src", "lib.rs"))).toBe(true);
    expect(fs.existsSync(path.join(desktop, "dist", "index.html"))).toBe(true); // frontendDist bundle
    expect(fs.existsSync(path.join(desktop, "README.md"))).toBe(true);
  });

  it("sanitizes a digit-leading project name into a valid Rust crate + identifier", async () => {
    execFileSync(process.execPath, [path.join(repoRoot, "packages/cli/create.mjs"), "2048", "--dir", tmp, "--template", "classic"], { stdio: "ignore" });
    const numDir = path.join(tmp, "2048.tdproj");
    const result = await packageDesktop(numDir);
    expect(result.ok, result.error).toBe(true);

    // Cargo package/lib names and the Tauri identifier segments must start with a letter.
    const cargo = fs.readFileSync(path.join(numDir, "desktop", "src-tauri", "Cargo.toml"), "utf8");
    for (const m of cargo.matchAll(/name = "([^"]+)"/g)) expect(/^[a-zA-Z_]/.test(m[1])).toBe(true);
    const conf = JSON.parse(fs.readFileSync(path.join(numDir, "desktop", "src-tauri", "tauri.conf.json"), "utf8"));
    for (const seg of conf.identifier.split(".")) expect(/^[a-zA-Z]/.test(seg)).toBe(true);
    // main.rs must call the same lib crate that Cargo declares.
    const mainRs = fs.readFileSync(path.join(numDir, "desktop", "src-tauri", "src", "main.rs"), "utf8");
    expect(mainRs).toContain(`${result.app.crate}_lib::run()`);
  });
});
