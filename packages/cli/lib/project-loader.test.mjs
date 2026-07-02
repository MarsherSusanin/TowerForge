import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadProjectFiles, runMissionSmoke, selectBuildTarget } from "./project-loader.mjs";

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

  it("returns aggregate smoke-run observability instead of final-frame events only", async () => {
    const result = await runMissionSmoke(path.resolve("examples/starter.tdproj"), "tutorial_01", 20);

    expect(result.eventCounts.waveStarted).toBeGreaterThanOrEqual(1);
    expect(result.eventTimeline.some((event) => event.type === "towerPlaced")).toBe(true);
    expect(result.milestones.length).toBeGreaterThanOrEqual(2);
    expect(result.strategy.placement).toBe("auto_nearest_path");
    expect(result.nextValidActions.length).toBeGreaterThan(0);
  });
});
