import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packExecutableForBundle, restorePackedExecutable } from "./packed-executable.mjs";

const roots = new Set();

afterEach(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  roots.clear();
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-packed-executable-"));
  roots.add(root);
  const executable = path.join(root, "claude");
  const content = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from("fake-runtime")]);
  fs.writeFileSync(executable, content, { mode: 0o700 });
  return { root, executable, content };
}

describe("packed desktop executables", () => {
  it("masks ELF files for bundling and restores only a checksum-verified private copy", () => {
    const { root, executable, content } = fixture();
    const { packedPath, manifest } = packExecutableForBundle(executable);

    expect(fs.existsSync(executable)).toBe(false);
    expect(fs.readFileSync(packedPath).subarray(0, 4).toString("ascii")).toBe("TFPK");
    if (process.platform !== "win32") expect(fs.statSync(packedPath).mode & 0o777).toBe(0o600);
    expect(manifest.originalSha256).toBe(crypto.createHash("sha256").update(content).digest("hex"));

    const restored = restorePackedExecutable(packedPath, path.join(root, "private-bin"));
    expect(fs.readFileSync(restored)).toEqual(content);
    if (process.platform !== "win32") expect(fs.statSync(restored).mode & 0o777).toBe(0o700);
    expect(restorePackedExecutable(packedPath, path.join(root, "private-bin"))).toBe(restored);
  });

  it("rejects a modified packed executable", () => {
    const { root, executable } = fixture();
    const { packedPath } = packExecutableForBundle(executable);
    fs.appendFileSync(packedPath, "tampered");
    expect(() => restorePackedExecutable(packedPath, path.join(root, "private-bin"))).toThrow(/integrity verification/);
  });
});
