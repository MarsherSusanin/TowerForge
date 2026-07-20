import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertReleaseVersions, prepareDesktopRelease } from "./prepare-release.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-release-"));
  const repoRoot = path.join(root, "repo");
  const inputDir = path.join(root, "artifacts");
  const outputDir = path.join(root, "release");
  fs.mkdirSync(path.join(repoRoot, "packages/desktop/src-tauri"), { recursive: true });
  fs.mkdirSync(path.join(inputDir, "mac"), { recursive: true });
  fs.mkdirSync(path.join(inputDir, "windows"), { recursive: true });
  fs.mkdirSync(path.join(inputDir, "linux"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "package.json"), '{"version":"0.2.0"}\n');
  fs.writeFileSync(path.join(repoRoot, "packages/desktop/package.json"), '{"version":"0.2.0"}\n');
  fs.writeFileSync(path.join(repoRoot, "packages/desktop/src-tauri/tauri.conf.json"), '{"version":"0.2.0"}\n');
  fs.writeFileSync(path.join(repoRoot, "packages/desktop/src-tauri/Cargo.toml"), '[package]\nname="towerforge"\nversion = "0.2.0"\n');
  return { root, repoRoot, inputDir, outputDir };
}

describe("desktop release preparation", () => {
  it("assembles installers, checksums, and source-linked unsigned notes", () => {
    const dirs = fixture();
    const files = {
      "mac/TowerForge_0.2.0_aarch64.dmg": "mac",
      "windows/TowerForge_0.2.0_x64-setup.exe": "windows",
      "linux/TowerForge_0.2.0_amd64.AppImage": "linux"
    };
    for (const [relativePath, contents] of Object.entries(files)) {
      fs.writeFileSync(path.join(dirs.inputDir, relativePath), contents);
    }
    fs.writeFileSync(path.join(dirs.inputDir, "linux/debug.log"), "ignored");

    const result = prepareDesktopRelease({
      ...dirs,
      tag: "v0.2.0",
      repository: "Lindforge-Studios/TowerForge",
      commitSha: "a".repeat(40)
    });

    expect(result.installers.map((item) => item.fileName)).toEqual(Object.keys(files).map((filePath) => path.basename(filePath)).sort());
    const checksums = fs.readFileSync(path.join(dirs.outputDir, "SHA256SUMS"), "utf8");
    for (const [relativePath, contents] of Object.entries(files)) {
      const expected = createHash("sha256").update(contents).digest("hex");
      expect(checksums).toContain(`${expected}  ${path.basename(relativePath)}`);
    }
    expect(fs.existsSync(path.join(dirs.outputDir, "debug.log"))).toBe(false);
    const notes = fs.readFileSync(path.join(dirs.outputDir, "RELEASE_NOTES.md"), "utf8");
    expect(notes).toContain("Unsigned build");
    expect(notes).toContain("https://github.com/Lindforge-Studios/TowerForge/tree/v0.2.0");
    expect(notes).toContain("System Settings > Privacy & Security > Open Anyway");
    expect(notes).not.toContain("xattr");
  });

  it("rejects duplicate installer basenames", () => {
    const dirs = fixture();
    fs.writeFileSync(path.join(dirs.inputDir, "mac/TowerForge.dmg"), "one");
    fs.writeFileSync(path.join(dirs.inputDir, "windows/TowerForge.dmg"), "two");
    expect(() => prepareDesktopRelease({
      ...dirs,
      tag: "v0.2.0",
      repository: "Lindforge-Studios/TowerForge",
      commitSha: "b".repeat(40)
    })).toThrow(/Duplicate release installer basename/);
  });

  it("rejects a release tag that does not match every desktop version", () => {
    const dirs = fixture();
    expect(() => assertReleaseVersions(dirs.repoRoot, "0.3.0")).toThrow(/does not match/);
  });
});
