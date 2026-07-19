import { describe, expect, it } from "vitest";
import { packageMatchesTargets } from "./runtime-packages.mjs";

const linuxX64 = { os: "linux", cpu: "x64" };
const claudeMeta = { os: ["linux"], cpu: ["x64"], optional: true };

describe("desktop runtime package selection", () => {
  it("keeps the GNU Claude runtime out of musl bundles and vice versa", () => {
    const gnuTarget = [{ ...linuxX64, libc: "gnu" }];
    const muslTarget = [{ ...linuxX64, libc: "musl" }];
    const gnuPackage = "node_modules/@anthropic-ai/claude-agent-sdk-linux-x64";
    const muslPackage = `${gnuPackage}-musl`;

    expect(packageMatchesTargets(gnuPackage, claudeMeta, gnuTarget)).toBe(true);
    expect(packageMatchesTargets(muslPackage, claudeMeta, gnuTarget)).toBe(false);
    expect(packageMatchesTargets(gnuPackage, claudeMeta, muslTarget)).toBe(false);
    expect(packageMatchesTargets(muslPackage, claudeMeta, muslTarget)).toBe(true);
  });

  it("keeps platform-neutral dependencies", () => {
    expect(packageMatchesTargets("node_modules/zod", {}, [{ ...linuxX64, libc: "gnu" }])).toBe(true);
  });
});
