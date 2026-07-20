import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeDirectoryZip } from "./zip-store.mjs";

describe("deterministic zip store", () => {
  it("emits byte-identical archives for unchanged input", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-zip-"));
    try {
      const source = path.join(root, "source");
      fs.mkdirSync(path.join(source, "nested"), { recursive: true });
      fs.writeFileSync(path.join(source, "index.html"), "<h1>TowerForge</h1>\n");
      fs.writeFileSync(path.join(source, "nested", "data.json"), "{\"ok\":true}\n");
      const first = path.join(root, "first.zip");
      const second = path.join(root, "second.zip");
      writeDirectoryZip(source, first);
      writeDirectoryZip(source, second);
      const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      expect(hash(second)).toBe(hash(first));
      expect(fs.readFileSync(first).includes(Buffer.from("nested/data.json"))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects symlinks instead of archiving files outside the source", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-zip-link-"));
    try {
      const source = path.join(root, "source");
      fs.mkdirSync(source);
      fs.symlinkSync(path.join(root, "secret.txt"), path.join(source, "escape.txt"));
      expect(() => writeDirectoryZip(source, path.join(root, "bad.zip"))).toThrow(/symlink/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
