import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadProjectFiles, selectBuildTarget } from "./project-loader.mjs";

describe("project loader", () => {
  it("selects the canonical web build target", () => {
    const files = loadProjectFiles(path.resolve("examples/starter.tdproj"));
    const [targetId, target] = selectBuildTarget(files.buildTargets);

    expect(targetId).toBe("web-pwa");
    expect(target.platform).toBe("web");
    expect(target.webDir).toBe("dist");
    expect(target.appName).toBe("Web PWA");
    expect(target.appTitle).toBe("Starter Tower Defense");
  });
});
