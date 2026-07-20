import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TOOLS, callTool } from "./tools.mjs";
import { loadEngine } from "../cli/lib/project-loader.mjs";

const STARTER = path.resolve("examples/starter.tdproj");

describe("mcp tool registry", () => {
  it("advertises well-formed tool definitions", () => {
    expect(TOOLS.length).toBeGreaterThan(0);
    for (const tool of TOOLS) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema?.type).toBe("object");
      expect(["read_only", "compute_only", "write_local"]).toContain(tool.riskClass);
      expect(typeof tool.sideEffect).toBe("string");
      expect(tool.sideEffect).not.toBe("unspecified");
    }
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain("validate_project");
    expect(names).toContain("release_readiness");
    expect(names).toContain("export_project_pack");
    expect(names).toContain("inspect_project_pack");
    expect(names).toContain("list_recipes");
    expect(names).toContain("get_recipe");
    expect(names).toContain("get_progression");
    expect(names).toContain("dry_run_progression_patch");
    expect(names).toContain("simulate_mission");
    expect(names).toContain("playtest_report");
    expect(names).toContain("build_project");
    expect(names).toContain("package_web");
    expect(names).toContain("dry_run_balance_patch");
    expect(names).toContain("apply_validated_patch");
    expect(names).toContain("apply_progression_patch");
    expect(names).toContain("set_enemy_stat");
    expect(names).toContain("bind_sprite");
    expect(names).toContain("list_theme_packs");
    expect(names).toContain("preview_theme_pack");
    expect(names).toContain("apply_theme_pack");
    expect(names).toContain("list_project_tree");
    expect(names).toContain("get_tower_script");
    expect(names).toContain("upsert_tower_script");
    expect(names).toContain("bind_mission_music");
    expect(names).toContain("import_asset");
    expect(names).toContain("upsert_entity");
    expect(names).toContain("duplicate_entity");
    expect(names).toContain("delete_entity");
    expect(names).toContain("write_map");
    expect(names).toContain("upsert_story_comic");
    expect(names).toContain("set_battle_background");
    expect(TOOLS.find((t) => t.name === "apply_validated_patch")?.riskClass).toBe("write_local");
  });

  it("rejects unknown tools", async () => {
    await expect(callTool("nope", {}, { defaultProjectDir: STARTER })).rejects.toThrow(/Unknown tool/);
  });

  it("summarizes a project via the default project dir", async () => {
    const result = await callTool("get_project_summary", {}, { defaultProjectDir: STARTER });
    expect(result.counts.missions).toBeGreaterThan(0);
    expect(result.counts.towers).toBeGreaterThan(0);
    expect(result.defaultMissionId).toBe("tutorial_01");
    expect(result.progression.defaultDifficultyId).toBe("normal");
    expect(result.progression.difficulties.map((item) => item.id)).toEqual(["story", "normal", "veteran"]);
    expect(result.progression.metaUpgrades.map((item) => item.id)).toContain("reinforced_core");
  });

  it("validates the starter project cleanly", async () => {
    const result = await callTool("validate_project", { projectDir: STARTER }, {});
    expect(result.ok).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it("reports production readiness through stable structured checks", async () => {
    const result = await callTool("release_readiness", { projectDir: STARTER }, {});
    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.id)).toEqual(["validation", "maps", "identity", "content", "build_targets"]);
    expect(result.checks.every((check) => ["ok", "warning", "error"].includes(check.severity))).toBe(true);
    expect(result.projectDir).toBe(STARTER);
  });

  it("exports and verifies a confined project handoff pack", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-pack-"));
    try {
      fs.cpSync(STARTER, projectDir, { recursive: true });
      const exported = await callTool("export_project_pack", { projectDir, fileName: "handoff.tdpack" }, {});
      expect(exported).toMatchObject({ ok: true, fileName: "handoff.tdpack", relativePath: ".towerforge/exports/handoff.tdpack" });
      expect(exported.sha256).toMatch(/^[a-f0-9]{64}$/);
      const inspected = await callTool("inspect_project_pack", { projectDir, fileName: "handoff.tdpack" }, {});
      expect(inspected.sha256).toBe(exported.sha256);
      expect(inspected.files.some((entry) => entry.path === "content/balance.json")).toBe(true);
      await expect(callTool("export_project_pack", { projectDir, fileName: "../escape.tdpack" }, {})).rejects.toThrow(/basename/);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("lists missions", async () => {
    const result = await callTool("list_missions", {}, { defaultProjectDir: STARTER });
    expect(result.missions.some((m) => m.id === "tutorial_01")).toBe(true);
  });

  it("lists visual and audio catalogs without returning the whole visuals document", async () => {
    const sprites = await callTool("list_entities", { projectDir: STARTER, collection: "visualSprites" }, {});
    expect(sprites.entities.some((entry) => entry.id === "frontier_before_battle")).toBe(true);
    expect(sprites.revision).toMatch(/^[a-f0-9]{12}$/);
    const tracks = await callTool("list_entities", { projectDir: STARTER, collection: "musicTracks" }, {});
    expect(tracks.entities).toEqual([]);
    expect(tracks.revision).toBe(sprites.revision);
  });

  it("returns an evidence-backed playtest diagnosis", async () => {
    const result = await callTool("playtest_report", { projectDir: STARTER, missionId: "tutorial_01", duration: 180 }, {});
    expect(result.outcome).toBe("victory");
    expect(result.diagnosis).toMatchObject({
      status: "pass",
      metrics: { kills: 20, leaks: 0, completedWaves: 3, totalWaves: 3 }
    });
    expect(result.diagnosis.enemyPressure).toContainEqual(expect.objectContaining({ enemyTypeId: "basic_grunt", killed: 16 }));
    expect(TOOLS.find((tool) => tool.name === "playtest_report")?.riskClass).toBe("compute_only");
  });

  it("describes the schema with no project context at all — pure metadata", async () => {
    const result = await callTool("describe_schema", {}, {});
    expect(result.schemaVersion).toBe(2);
    expect(Object.keys(result.attackKinds).sort()).toEqual(
      ["antiair", "pipeline", "pulse", "single", "splash", "sniper", "support", "support_buff"].sort()
    );
    expect(result.attackKinds.splash.requiredFields.some((f) => f.name === "slowFactor" && f.lessThanOne)).toBe(true);
    expect(result.towerPipeline.deliveryKinds).toEqual(["single", "multi", "area", "chain", "aura"]);
    // Ability presets are 3 named, engine-implemented shortcuts, but the ability id space itself
    // is open — abilityEffects documents the primitives a custom (non-preset) ability composes.
    expect(Object.keys(result.abilityPresets).sort()).toEqual(["freeze", "path_water", "strike"].sort());
    expect(result.abilityEffects.damage).toBeTruthy();
    expect(result.abilityEffects.status).toBeTruthy();
    expect(result.currencyRules.primaryRequired).toBe("coins");
    expect(result.missionEconomy.sellRefundRatio.default).toBe(0.7);
    expect(Object.keys(result.missionObjectives.victory)).toEqual(["clearWaves", "surviveSeconds", "killCount", "accumulateResource"]);
    expect(result.simulationActions).toContain("sellTower");
    expect(result.towerScript.scopes).toContain("tower");
    expect(result.towerScript.actions.emitSignal.required.signal).toBe("safe identifier");
    expect(result.towerScript.eventFields.enemyKilled).toContain("enemyTypeId");
    expect(result.towerScript.limits.actionsPerTransaction).toBe(512);
    expect(result.difficulty.multiplierFields.enemyHpMultiplier).toBe(">0 optional");
    expect(result.metaProgression.effects.towerDamage).toBeTruthy();
  });

  it("returns focused schema domains for progressive discovery", async () => {
    const scripts = await callTool("describe_schema", { domain: "scripts" }, {});
    expect(scripts.requestedDomain).toBe("scripts");
    expect(scripts.towerScript.actions.spawnEnemy).toBeTruthy();
    expect(scripts).not.toHaveProperty("attackKinds");

    const assets = await callTool("describe_schema", { domain: "assets" }, {});
    expect(assets.assetAuthoring.bindings).toContain("bind_sprite");
    expect(assets).not.toHaveProperty("metaProgression");
  });

  it("previews and applies a bundled theme through a guarded local write", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-theme-"));
    try {
      fs.cpSync(STARTER, projectDir, { recursive: true });
      const listed = await callTool("list_theme_packs", {}, {});
      expect(listed.packs.map((pack) => pack.id)).toEqual(expect.arrayContaining(["verdant-frontier", "frostbound-citadel"]));
      const preview = await callTool("preview_theme_pack", { projectDir, packId: "frostbound-citadel" }, {});
      expect(preview).toMatchObject({ ok: true, dryRun: true, pack: { id: "frostbound-citadel" } });
      const applied = await callTool("apply_theme_pack", { projectDir, packId: "frostbound-citadel", ifRevision: preview.revision }, {});
      expect(applied).toMatchObject({ ok: true, dryRun: false, pack: { id: "frostbound-citadel" } });
      expect(fs.existsSync(path.join(projectDir, "assets/themes/frostbound-citadel/battle-background.png"))).toBe(true);
      const visuals = JSON.parse(fs.readFileSync(path.join(projectDir, "content/visuals.json"), "utf8"));
      expect(visuals.theme.id).toBe("frostbound-citadel");
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("previews and applies difficulty/meta progression through a scoped guarded tool", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-progression-"));
    try {
      fs.cpSync(STARTER, projectDir, { recursive: true });
      const current = await callTool("get_progression", { projectDir }, {});
      expect(current.metaProgression.upgrades.reinforced_core).toBeTruthy();
      const difficulties = current.difficulties.map((difficulty) => ({
        ...difficulty,
        ...(difficulty.id === "normal" ? { description: "Updated through MCP." } : {})
      }));
      const preview = await callTool("dry_run_progression_patch", { projectDir, difficulties }, {});
      expect(preview).toMatchObject({ ok: true, dryRun: true, applied: ["difficulties"] });
      expect(preview.diff.changes).toContainEqual(expect.objectContaining({ path: "difficulties[1].description", after: "Updated through MCP." }));

      const applied = await callTool("apply_progression_patch", {
        projectDir, difficulties, ifRevision: current.revision
      }, {});
      expect(applied).toMatchObject({ ok: true, written: true });
      const balance = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
      expect(balance.difficulties.find((difficulty) => difficulty.id === "normal").description).toBe("Updated through MCP.");
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("shares curated content recipes with agents and binds project references", async () => {
    const listed = await callTool("list_recipes", { collection: "towers" }, {});
    expect(listed.recipes.map((recipe) => recipe.id)).toContain("sniper");
    expect(listed.recipes.map((recipe) => recipe.id)).toContain("pipeline_chain");

    const pipeline = await callTool("get_recipe", {
      projectDir: STARTER,
      collection: "towers",
      recipeId: "pipeline_chain"
    }, {});
    expect(pipeline.recipe.entity.attack).toMatchObject({
      kind: "pipeline",
      delivery: { kind: "chain" },
      effects: [{ kind: "damage" }, { kind: "status" }]
    });

    const result = await callTool("get_recipe", {
      projectDir: STARTER,
      collection: "missions",
      recipeId: "survival"
    }, {});
    expect(result.recipe.entity).toMatchObject({
      id: "survival",
      mapId: "tutorial_map",
      waveSetId: "tutorial_waves",
      objectives: { victory: [{ kind: "surviveSeconds", seconds: 180 }] }
    });
    expect(result.recipe.entity.buildTowerIds).toEqual(expect.arrayContaining(["arrow_tower", "cannon_tower"]));
    expect(result.revision).toMatch(/^[a-f0-9]{12}$/);
    expect(TOOLS.find((tool) => tool.name === "get_recipe")?.riskClass).toBe("read_only");
  });
});

describe("mcp TowerScript tools", () => {
  let projectDir;
  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-scripts-"));
    fs.cpSync(STARTER, projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, ".env"), "TOKEN=private\n");
  });
  afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

  it("lists a redacted project tree and reads a script by id", async () => {
    const tree = await callTool("list_project_tree", { projectDir }, {});
    expect(JSON.stringify(tree.nodes)).toContain("starter-gameplay.tower.json");
    expect(JSON.stringify(tree.nodes)).not.toContain(".env");
    const script = await callTool("get_tower_script", { projectDir, scriptId: "starter_gameplay" }, {});
    expect(script.path).toBe("scripts/gameplay/starter-gameplay.tower.json");
    expect(script.script.handlers.waveStarted).toHaveLength(1);
  });

  it("dry-runs and commits one guarded validated script", async () => {
    const summary = await callTool("get_project_summary", { projectDir }, {});
    const script = {
      schemaVersion: 1, id: "kill_bonus", enabled: true,
      bindings: [{ scope: "global" }],
      handlers: { enemyKilled: [{ actions: [{ action: "grantResource", resourceId: "coins", amount: 1 }] }] }
    };
    const preview = await callTool("upsert_tower_script", {
      projectDir, path: "scripts/gameplay/kill-bonus.tower.json", script, dryRun: true, ifRevision: summary.revisions.scripts
    }, {});
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false });
    const committed = await callTool("upsert_tower_script", {
      projectDir, path: "scripts/gameplay/kill-bonus.tower.json", script, ifRevision: preview.revision
    }, {});
    expect(committed).toMatchObject({ ok: true, written: true, scriptId: "kill_bonus" });
    expect(fs.existsSync(path.join(projectDir, "scripts", "gameplay", "kill-bonus.tower.json"))).toBe(true);
    const stale = await callTool("upsert_tower_script", {
      projectDir, path: "scripts/gameplay/kill-bonus.tower.json", script, ifRevision: preview.revision
    }, {});
    expect(stale).toMatchObject({ ok: false, conflict: true, written: false });
  });
});

describe("mcp entity reads", () => {
  it("lists compact entity summaries without returning the full collection", async () => {
    const result = await callTool("list_entities", {
      projectDir: STARTER,
      collection: "enemies"
    }, {});
    expect(result.collection).toBe("enemies");
    expect(result.entities).toContainEqual(expect.objectContaining({ id: "basic_grunt" }));
    expect(result.entities.find((entity) => entity.id === "basic_grunt")).not.toHaveProperty("reward");
    expect(result.revision).toMatch(/^[a-f0-9]{12}$/);
  });

  it("reads the normalized effective entity and its guarded-write revision", async () => {
    const result = await callTool("get_entity", {
      projectDir: STARTER,
      collection: "enemies",
      id: "basic_grunt"
    }, {});
    expect(result).toMatchObject({
      collection: "enemies",
      id: "basic_grunt",
      source: "normalized_effective",
      entity: { id: "basic_grunt" }
    });
    expect(result.entity.maxHp).toBeGreaterThan(0);
    expect(result.revision).toMatch(/^[a-f0-9]{12}$/);
  });

  it("reads map sources by source filename", async () => {
    const result = await callTool("get_entity", {
      projectDir: STARTER,
      collection: "mapSources",
      id: "tutorial_map.tmj"
    }, {});
    expect(result.entity).toMatchObject({ width: 15, height: 20 });
    expect(result.revision).toBeNull();
  });

  it("reads compact narrative entities with independent revisions", async () => {
    const stories = await callTool("list_entities", { projectDir: STARTER, collection: "storyComics" }, {});
    expect(stories.entities).toContainEqual(expect.objectContaining({ id: "frontier_briefing", missionId: "tutorial_01", panelCount: 2 }));
    expect(stories.revision).toMatch(/^[a-f0-9]{12}$/);
    const backgrounds = await callTool("get_entity", { projectDir: STARTER, collection: "battleBackgrounds", id: "tutorial_01" }, {});
    expect(backgrounds.entity).toMatchObject({ spriteId: "frontier_before_battle" });
    expect(backgrounds.revision).toMatch(/^[a-f0-9]{12}$/);
  });

  it("rejects unknown collections and missing ids", async () => {
    await expect(callTool("list_entities", { projectDir: STARTER, collection: "secrets" }, {}))
      .rejects.toThrow(/Unknown entity collection/);
    await expect(callTool("get_entity", { projectDir: STARTER, collection: "towers", id: "missing" }, {}))
      .rejects.toThrow(/was not found/);
  });
});

describe("mcp narrative writes", () => {
  it("previews and commits narrow validated story/background changes", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-narrative-"));
    try {
      fs.cpSync(STARTER, projectDir, { recursive: true });
      const summary = await callTool("get_project_summary", { projectDir }, {});
      const comic = {
        missionId: "tutorial_01",
        trigger: "afterVictory",
        replay: "once",
        panels: [{ speaker: "Commander", text: "The frontier is secure." }]
      };
      const preview = await callTool("upsert_story_comic", {
        projectDir,
        comicId: "frontier_victory",
        comic,
        dryRun: true,
        ifRevision: summary.revisions.storyComics
      }, {});
      expect(preview).toMatchObject({ ok: true, written: false, dryRun: true });
      expect(preview.diff.changes.some((change) => change.path.includes("frontier_victory"))).toBe(true);

      const committed = await callTool("upsert_story_comic", {
        projectDir,
        comicId: "frontier_victory",
        comic,
        ifRevision: preview.revision
      }, {});
      expect(committed).toMatchObject({ ok: true, written: true, rolledBack: false });
      expect(JSON.parse(fs.readFileSync(path.join(projectDir, "content", "story-comics.json"), "utf8")).comics.frontier_victory).toMatchObject(comic);

      const backgroundPreview = await callTool("set_battle_background", {
        projectDir,
        missionId: "tutorial_01",
        background: { color: "#162016", opacity: 0.5 },
        dryRun: true
      }, {});
      expect(backgroundPreview).toMatchObject({ ok: true, written: false, dryRun: true });
      const backgroundCommit = await callTool("set_battle_background", {
        projectDir,
        missionId: "tutorial_01",
        background: { color: "#162016", opacity: 0.5 },
        ifRevision: backgroundPreview.revision
      }, {});
      expect(backgroundCommit).toMatchObject({ ok: true, written: true });

      const beforeInvalid = fs.readFileSync(path.join(projectDir, "content", "story-comics.json"), "utf8");
      const invalid = await callTool("upsert_story_comic", {
        projectDir,
        comicId: "broken",
        comic: { missionId: "missing", panels: [] },
        ifRevision: committed.revision
      }, {});
      expect(invalid).toMatchObject({ ok: false, written: false });
      expect(fs.readFileSync(path.join(projectDir, "content", "story-comics.json"), "utf8")).toBe(beforeInvalid);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe("mcp duplicate_entity", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-duplicate-"));
    fs.cpSync(STARTER, projectDir, { recursive: true });
  });

  afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

  it("duplicates one authored entity through the guarded write pipeline", async () => {
    const summary = await callTool("get_project_summary", { projectDir }, {});
    const result = await callTool("duplicate_entity", {
      projectDir,
      collection: "towers",
      sourceId: "arrow_tower",
      targetId: "arrow_tower_mk2",
      label: "Arrow Tower Mk II",
      ifRevision: summary.revisions.balance
    }, {});
    expect(result).toMatchObject({ ok: true, written: true, duplicated: { sourceId: "arrow_tower", targetId: "arrow_tower_mk2" } });
    const duplicate = await callTool("get_entity", { projectDir, collection: "towers", id: "arrow_tower_mk2" }, {});
    expect(duplicate.entity).toMatchObject({ id: "arrow_tower_mk2", label: "Arrow Tower Mk II", attack: { kind: "single" } });
    expect(result.backupPath).toBeTruthy();
  });

  it("refuses collisions without touching the project", async () => {
    const before = fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8");
    await expect(callTool("duplicate_entity", {
      projectDir, collection: "enemies", sourceId: "basic_grunt", targetId: "swift_runner"
    }, {})).rejects.toThrow(/already exists/);
    expect(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8")).toBe(before);
  });
});

describe("mcp import_asset", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-asset-"));
    fs.cpSync(STARTER, projectDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, "imports"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "imports", "tower.png"), "mcp asset", "utf8");
    fs.writeFileSync(path.join(projectDir, "imports", "frontier.ogg"), "mcp music", "utf8");
  });

  afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

  it("imports only a project-local file and returns a guarded visuals diff", async () => {
    const summary = await callTool("get_project_summary", { projectDir }, {});
    const result = await callTool("import_asset", {
      projectDir,
      sourcePath: "imports/tower.png",
      targetPath: "mcp/tower.png",
      id: "mcp_tower",
      kind: "sprite",
      ifRevision: summary.revisions.visuals
    }, {});
    expect(result).toMatchObject({ ok: true, written: true, asset: { id: "mcp_tower", kind: "sprite", path: "assets/mcp/tower.png" } });
    expect(result.diff.changes.some((change) => change.path.includes("sprites.mcp_tower"))).toBe(true);
    expect(fs.readFileSync(path.join(projectDir, "assets", "mcp", "tower.png"), "utf8")).toBe("mcp asset");
  });

  it("rejects traversal before creating an asset", async () => {
    await expect(callTool("import_asset", {
      projectDir, sourcePath: "../outside.png", targetPath: "bad.png", kind: "sprite"
    }, {})).rejects.toThrow(/must not contain/);
    expect(fs.existsSync(path.join(projectDir, "assets", "bad.png"))).toBe(false);
  });

  it("imports and dry-runs a mission music binding before a guarded commit", async () => {
    const summary = await callTool("get_project_summary", { projectDir }, {});
    const imported = await callTool("import_asset", {
      projectDir,
      sourcePath: "imports/frontier.ogg",
      targetPath: "music/frontier.ogg",
      id: "frontier",
      kind: "music",
      volume: 0.4,
      ifRevision: summary.revisions.visuals
    }, {});
    expect(imported).toMatchObject({ ok: true, written: true, asset: { id: "frontier", kind: "music" } });

    const preview = await callTool("bind_mission_music", {
      projectDir,
      missionId: "tutorial_01",
      trackId: "frontier",
      dryRun: true,
      ifRevision: imported.revision
    }, {});
    expect(preview).toMatchObject({ ok: true, written: false, dryRun: true, binding: { missionId: "tutorial_01", trackId: "frontier" } });
    expect(preview.diff.changes.some((change) => change.path.includes("musicByMission.tutorial_01"))).toBe(true);

    const committed = await callTool("bind_mission_music", {
      projectDir,
      missionId: "tutorial_01",
      trackId: "frontier",
      ifRevision: preview.revision
    }, {});
    expect(committed).toMatchObject({ ok: true, written: true, binding: { missionId: "tutorial_01", trackId: "frontier" } });
    const visuals = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "visuals.json"), "utf8"));
    expect(visuals.audio.musicByMission.tutorial_01).toBe("frontier");
  });

  it("rejects unknown music tracks without touching visuals", async () => {
    const visualsPath = path.join(projectDir, "content", "visuals.json");
    const before = fs.readFileSync(visualsPath, "utf8");
    await expect(callTool("bind_mission_music", {
      projectDir, missionId: "tutorial_01", trackId: "missing"
    }, {})).rejects.toThrow(/not found/);
    expect(fs.readFileSync(visualsPath, "utf8")).toBe(before);
  });
});

describe("mcp balance patch", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-"));
    fs.mkdirSync(path.join(projectDir, "content"), { recursive: true });
    fs.cpSync(STARTER, projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("merges recognized balance sections and re-validates", async () => {
    const balanceBefore = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
    const towers = { ...balanceBefore.towers };
    towers.arrow_tower = { ...towers.arrow_tower, cost: { coins: 999 } };

    const result = await callTool("apply_balance_patch", { projectDir, patch: { towers } }, {});

    expect(result.applied).toEqual(["towers"]);
    expect(result.validation.ok).toBe(true);
    const balanceAfter = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
    expect(balanceAfter.towers.arrow_tower.cost.coins).toBe(999);
    expect(fs.existsSync(path.join(projectDir, ".towerforge", "mcp-backups"))).toBe(true);
  });

  it("dry-runs invalid balance patches without writing", async () => {
    const balancePath = path.join(projectDir, "content", "balance.json");
    const before = fs.readFileSync(balancePath, "utf8");
    const balanceBefore = JSON.parse(before);
    const enemies = { ...balanceBefore.enemies, basic_grunt: { ...balanceBefore.enemies.basic_grunt, maxHp: -1 } };

    const result = await callTool("apply_validated_patch", { projectDir, patch: { enemies } }, {});

    expect(result.ok).toBe(false);
    expect(result.written).toBe(false);
    expect(result.validation.ok).toBe(false);
    expect(fs.readFileSync(balancePath, "utf8")).toBe(before);
  });

  it("supports granular validated balance edits", async () => {
    const result = await callTool("set_enemy_stat", {
      projectDir,
      enemyId: "basic_grunt",
      field: "maxHp",
      value: 12
    }, {});

    expect(result.ok).toBe(true);
    expect(result.applied).toEqual(["enemies"]);
    const balanceAfter = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
    expect(balanceAfter.enemies.basic_grunt.maxHp).toBe(12);
  });

  it("appends one wave group through a validated granular tool", async () => {
    const result = await callTool("add_wave_group", {
      projectDir,
      waveSetId: "tutorial_waves",
      waveId: "wave_1",
      group: { enemyId: "basic_grunt", count: 1, spawnInterval: 1, startDelay: 9 }
    }, {});

    expect(result.ok).toBe(true);
    const balanceAfter = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
    expect(balanceAfter.waveSets.tutorial_waves[0].groups.at(-1)).toMatchObject({ enemyId: "basic_grunt", count: 1 });
  });

  it("binds existing sprites without touching balance data", async () => {
    const visualsPath = path.join(projectDir, "content", "visuals.json");
    const visuals = JSON.parse(fs.readFileSync(visualsPath, "utf8"));
    visuals.sprites ??= {};
    visuals.sprites.arrow_icon = { src: "assets/arrow.png" };
    fs.writeFileSync(visualsPath, JSON.stringify(visuals, null, 2) + "\n", "utf8");

    const result = await callTool("bind_sprite", {
      projectDir,
      kind: "towers",
      entityId: "arrow_tower",
      spriteId: "arrow_icon"
    }, {});

    expect(result.ok).toBe(true);
    const visualsAfter = JSON.parse(fs.readFileSync(visualsPath, "utf8"));
    expect(visualsAfter.bindings.towers.arrow_tower).toBe("arrow_icon");
  });

  it("compiles maps in dry-run mode without writing", async () => {
    const result = await callTool("compile_maps_dry_run", { projectDir }, {});

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.mapIds).toContain("tutorial_map");
  });

  it("rejects patches with no recognized keys", async () => {
    await expect(callTool("apply_balance_patch", { projectDir, patch: { nonsense: 1 } }, {})).rejects.toThrow(/recognized balance keys/);
  });
});

describe("mcp entity CRUD (upsert_entity / delete_entity)", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-entity-"));
    fs.mkdirSync(path.join(projectDir, "content"), { recursive: true });
    fs.cpSync(STARTER, projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  function balance() {
    return JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
  }

  it("creates a brand-new tower by id without resending the whole towers section", async () => {
    const result = await callTool("upsert_entity", {
      projectDir, collection: "towers", id: "frost_tower",
      value: { label: "Frost", cost: { coins: 20 }, footprintRadius: 0, range: 5, attack: { kind: "single", fireRate: 1, damagePerStack: 1, startingStacks: 1, maxStacks: 1, upgradeCost: 1 } }
    }, {});
    expect(result.ok).toBe(true);
    expect(balance().towers.frost_tower).toMatchObject({ id: "frost_tower", label: "Frost" });
    expect(balance().towers.arrow_tower).toBeTruthy(); // untouched
  });

  it("shallow-merges into an existing entity when merge:true", async () => {
    const result = await callTool("upsert_entity", {
      projectDir, collection: "enemies", id: "basic_grunt", value: { maxHp: 999 }, merge: true
    }, {});
    expect(result.ok).toBe(true);
    const grunt = balance().enemies.basic_grunt;
    expect(grunt.maxHp).toBe(999);
    expect(grunt.speed).toBeGreaterThan(0); // other fields preserved by the merge
  });

  it("creates a new wave set from an array of waves", async () => {
    const result = await callTool("upsert_entity", {
      projectDir, collection: "waveSets", id: "endless_waves",
      value: [{ id: "w1", label: "W1", groups: [{ enemyId: "basic_grunt", count: 3, spawnInterval: 1, startDelay: 0 }] }]
    }, {});
    expect(result.ok).toBe(true);
    expect(balance().waveSets.endless_waves).toHaveLength(1);
  });

  it("adds a currency via the array-shaped collection", async () => {
    const result = await callTool("upsert_entity", {
      projectDir, collection: "currencies", id: "gems", value: { label: "Gems" }
    }, {});
    expect(result.ok).toBe(true);
    expect(balance().currencies).toContainEqual({ id: "gems", label: "Gems" });
  });

  it("rejects an unknown collection", async () => {
    await expect(callTool("upsert_entity", { projectDir, collection: "bogus", id: "x", value: {} }, {})).rejects.toThrow(/unknown collection/);
  });

  it("refuses to delete a referenced enemy and reports the references", async () => {
    const result = await callTool("delete_entity", { projectDir, collection: "enemies", id: "basic_grunt" }, {});
    expect(result.ok).toBe(false);
    expect(result.refused).toBe("referenced");
    expect(result.references.length).toBeGreaterThan(0);
    expect(balance().enemies.basic_grunt).toBeTruthy(); // nothing written
  });

  it("deletes an unreferenced entity cleanly", async () => {
    await callTool("upsert_entity", {
      projectDir, collection: "enemies", id: "unused_enemy",
      value: { label: "Unused", maxHp: 1, speed: 1, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 }
    }, {});
    const result = await callTool("delete_entity", { projectDir, collection: "enemies", id: "unused_enemy" }, {});
    expect(result.ok).toBe(true);
    expect(balance().enemies.unused_enemy).toBeUndefined();
  });

  it("never allows deleting the required primary currency \"coins\", even with force", async () => {
    await expect(callTool("delete_entity", { projectDir, collection: "currencies", id: "coins", force: true }, {}))
      .rejects.toThrow(/primary currency/);
  });

  it("rejects deleting an entity that doesn't exist", async () => {
    await expect(callTool("delete_entity", { projectDir, collection: "towers", id: "nope" }, {})).rejects.toThrow(/not found/);
  });
});

describe("mcp write_map", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-map-"));
    fs.mkdirSync(path.join(projectDir, "content"), { recursive: true });
    fs.cpSync(STARTER, projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("authors a brand-new map from scratch and compiles it", async () => {
    const result = await callTool("write_map", {
      projectDir, mapId: "canyon", width: 6, height: 3,
      spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 5, r: 1 },
      pathCenterline: [{ q: 0, r: 1 }, { q: 1, r: 1 }, { q: 2, r: 1 }, { q: 3, r: 1 }, { q: 4, r: 1 }, { q: 5, r: 1 }]
    }, {});
    expect(result.ok).toBe(true);
    expect(result.mapIds).toContain("canyon");
    expect(fs.existsSync(path.join(projectDir, "maps", "src", "canyon.tmj"))).toBe(true);
    const compiled = JSON.parse(fs.readFileSync(path.join(projectDir, "maps", "compiled", "maps.json"), "utf8"));
    expect(compiled.canyon.width).toBe(6);
  });

  it("supports multi-route paths", async () => {
    const result = await callTool("write_map", {
      projectDir, mapId: "fork", width: 6, height: 5,
      spawnCoord: { q: 0, r: 2 }, coreCoord: { q: 5, r: 2 },
      pathCenterline: [{ q: 0, r: 2 }, { q: 5, r: 2 }],
      pathRoutes: [
        { id: "top", pathCenterline: [{ q: 0, r: 2 }, { q: 3, r: 0 }, { q: 5, r: 2 }] },
        { id: "bottom", pathCenterline: [{ q: 0, r: 2 }, { q: 3, r: 4 }, { q: 5, r: 2 }] }
      ]
    }, {});
    expect(result.ok).toBe(true);
    const compiled = JSON.parse(fs.readFileSync(path.join(projectDir, "maps", "compiled", "maps.json"), "utf8"));
    expect(compiled.fork.pathRoutes.map((r) => r.id).sort()).toEqual(["bottom", "top"]);
  });

  it("validates BEFORE writing — a malformed map never touches disk", async () => {
    const result = await callTool("write_map", {
      projectDir, mapId: "broken", width: -1, height: 3,
      spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 1, r: 0 },
      pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }]
    }, {});
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(projectDir, "maps", "src", "broken.tmj"))).toBe(false);
  });
});

describe("mcp diff payload (2.4)", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-diff-"));
    fs.mkdirSync(path.join(projectDir, "content"), { recursive: true });
    fs.cpSync(STARTER, projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("reports a leaf-level diff of exactly what a dry-run patch would change", async () => {
    // dry_run_balance_patch REPLACES the whole `enemies` section, so preserve the other enemies —
    // only basic_grunt's maxHp should show up in the diff.
    const before = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
    const result = await callTool("dry_run_balance_patch", {
      projectDir,
      patch: { enemies: { ...before.enemies, basic_grunt: { ...before.enemies.basic_grunt, maxHp: 999 } } }
    }, {});
    expect(result.ok).toBe(true);
    expect(typeof result.revision).toBe("string");
    const maxHpChange = result.diff.changes.find((c) => c.path === "enemies.basic_grunt.maxHp");
    expect(maxHpChange).toBeTruthy();
    expect(maxHpChange.after).toBe(999);
    expect(result.diff.truncated).toBe(false);
  });

  it("carries the same diff through to the actual write on apply_validated_patch", async () => {
    const before = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
    const result = await callTool("upsert_entity", {
      projectDir, collection: "enemies", id: "basic_grunt", value: { speed: 5 }, merge: true
    }, {});
    expect(result.ok).toBe(true);
    const speedChange = result.diff.changes.find((c) => c.path === "enemies.basic_grunt.speed");
    expect(speedChange).toEqual({ path: "enemies.basic_grunt.speed", before: before.enemies.basic_grunt.speed, after: 5 });
  });

  it("reports no diff entries when a patch value is identical to the current one", async () => {
    const before = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
    const result = await callTool("dry_run_balance_patch", { projectDir, patch: { enemies: before.enemies } }, {});
    expect(result.diff.changeCount).toBe(0);
  });

  // Regression: an off-by-one bug used to mark truncated:true whenever the walk happened to hit
  // exactly DIFF_LIMIT entries, even if that was the true total (nothing was actually dropped).
  it("does not false-positive truncated when the real change count lands exactly on the limit", async () => {
    const before = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
    const enemies = { ...before.enemies };
    // 200 distinct real leaf changes across 100 synthetic enemies (2 fields each).
    for (let i = 0; i < 100; i += 1) {
      enemies[`synthetic_${i}`] = { id: `synthetic_${i}`, label: `S${i}`, maxHp: 999 + i, speed: 5 + i, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 };
    }
    const beforeWithBaseline = { ...before.enemies };
    for (let i = 0; i < 100; i += 1) {
      beforeWithBaseline[`synthetic_${i}`] = { id: `synthetic_${i}`, label: `S${i}`, maxHp: 1, speed: 1, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 };
    }
    const result = await callTool("dry_run_balance_patch", {
      projectDir: (() => {
        // Seed a fresh project whose baseline already has the 100 synthetic enemies at maxHp:1/speed:1,
        // so the patch produces exactly 200 real changed leaves (maxHp+speed x 100), nothing more.
        const seeded = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-diff-limit-"));
        fs.mkdirSync(path.join(seeded, "content"), { recursive: true });
        fs.cpSync(STARTER, seeded, { recursive: true });
        const balancePath = path.join(seeded, "content", "balance.json");
        const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
        balance.enemies = beforeWithBaseline;
        fs.writeFileSync(balancePath, JSON.stringify(balance, null, 2));
        return seeded;
      })(),
      patch: { enemies }
    }, {});
    expect(result.diff.changeCount).toBe(200);
    expect(result.diff.changes).toHaveLength(200);
    expect(result.diff.truncated).toBe(false);
  });

  it("correctly marks truncated when there really are more than DIFF_LIMIT changes", async () => {
    const seeded = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-diff-over-"));
    fs.mkdirSync(path.join(seeded, "content"), { recursive: true });
    fs.cpSync(STARTER, seeded, { recursive: true });
    const balancePath = path.join(seeded, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    const baseline = { ...balance.enemies };
    const patched = { ...balance.enemies };
    for (let i = 0; i < 101; i += 1) {
      baseline[`e${i}`] = { id: `e${i}`, label: `E${i}`, maxHp: 1, speed: 1, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 };
      patched[`e${i}`] = { id: `e${i}`, label: `E${i}`, maxHp: 2, speed: 2, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 }; // 202 real changes
    }
    balance.enemies = baseline;
    fs.writeFileSync(balancePath, JSON.stringify(balance, null, 2));
    const result = await callTool("dry_run_balance_patch", { projectDir: seeded, patch: { enemies: patched } }, {});
    expect(result.diff.changeCount).toBeGreaterThan(200);
    expect(result.diff.changes).toHaveLength(200); // output capped
    expect(result.diff.truncated).toBe(true);
    fs.rmSync(seeded, { recursive: true, force: true });
  });

  it("diffs a changed element of an existing array field-by-field, not the whole array twice", async () => {
    const before = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
    const waveSets = structuredClone(before.waveSets);
    waveSets.tutorial_waves[0].groups[0].startDelay = 9; // wave_1's existing (only) group
    const result = await callTool("dry_run_balance_patch", { projectDir, patch: { waveSets } }, {});
    expect(result.ok).toBe(true);
    // Both sides of this array element already existed as plain objects, so the walk recurses to
    // the single leaf field that actually changed, instead of reporting the whole group/array.
    const entry = result.diff.changes.find((c) => c.path === "waveSets.tutorial_waves[0].groups[0].startDelay");
    expect(entry).toBeTruthy();
    expect(entry.before).toBe(0);
    expect(entry.after).toBe(9);
    // The unrelated sibling field (count) on that same group must not appear — only the true diff.
    expect(result.diff.changes.some((c) => c.path === "waveSets.tutorial_waves[0].groups[0].count")).toBe(false);
    expect(result.diff.changes.some((c) => c.path === "waveSets.tutorial_waves")).toBe(false);
  });

  it("reports a brand-new array element as a single whole-object leaf (nothing to recurse into on the before side)", async () => {
    const result = await callTool("add_wave_group", {
      projectDir, waveSetId: "tutorial_waves", waveId: "wave_1",
      group: { enemyId: "basic_grunt", count: 1, spawnInterval: 1, startDelay: 9 }
    }, {});
    expect(result.ok).toBe(true);
    const groupEntry = result.diff.changes.find((c) => /^waveSets\.tutorial_waves\[0\]\.groups\[\d+\]$/.test(c.path));
    expect(groupEntry).toBeTruthy();
    expect(groupEntry.before).toBeUndefined();
    expect(groupEntry.after).toEqual({ enemyId: "basic_grunt", count: 1, spawnInterval: 1, startDelay: 9 });
    expect(result.diff.changes.some((c) => c.path === "waveSets.tutorial_waves")).toBe(false);
  });

  it("distinguishes an absent field from an explicit null in a diff entry", async () => {
    const before = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
    const withNull = { ...before.enemies, basic_grunt: { ...before.enemies.basic_grunt, customNote: null } };
    const addResult = await callTool("dry_run_balance_patch", { projectDir, patch: { enemies: withNull } }, {});
    const addEntry = addResult.diff.changes.find((c) => c.path === "enemies.basic_grunt.customNote");
    expect(addEntry.before).toBeUndefined(); // was absent, not null
    expect(addEntry.after).toBeNull();
    const removeResult = await callTool("dry_run_balance_patch", {
      projectDir: (() => {
        const seeded = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-diff-null-"));
        fs.mkdirSync(path.join(seeded, "content"), { recursive: true });
        fs.cpSync(STARTER, seeded, { recursive: true });
        const balancePath = path.join(seeded, "content", "balance.json");
        const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
        balance.enemies.basic_grunt.customNote = null;
        fs.writeFileSync(balancePath, JSON.stringify(balance, null, 2));
        return seeded;
      })(),
      patch: { enemies: before.enemies } // no customNote key at all
    }, {});
    const removeEntry = removeResult.diff.changes.find((c) => c.path === "enemies.basic_grunt.customNote");
    expect(removeEntry.before).toBeNull();
    expect(removeEntry.after).toBeUndefined(); // now absent, not null
  });
});

describe("mcp optimistic-concurrency revision tokens (2.8)", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-revision-"));
    fs.mkdirSync(path.join(projectDir, "content"), { recursive: true });
    fs.cpSync(STARTER, projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns a stable balance revision from get_project_summary and validate_project", async () => {
    const summary = await callTool("get_project_summary", { projectDir }, {});
    const validation = await callTool("validate_project", { projectDir }, {});
    expect(summary.revisions.balance).toBe(validation.revisions.balance);
    expect(typeof summary.revisions.balance).toBe("string");
  });

  it("accepts a write whose ifRevision matches the current revision", async () => {
    const { revisions } = await callTool("get_project_summary", { projectDir }, {});
    const result = await callTool("set_enemy_stat", {
      projectDir, enemyId: "basic_grunt", field: "maxHp", value: 15, ifRevision: revisions.balance
    }, {});
    expect(result.ok).toBe(true);
    expect(typeof result.revision).toBe("string");
    expect(result.revision).not.toBe(revisions.balance); // content actually changed
  });

  it("rejects a write whose ifRevision is stale, without touching the file", async () => {
    const balancePath = path.join(projectDir, "content", "balance.json");
    const before = fs.readFileSync(balancePath, "utf8");
    const result = await callTool("set_enemy_stat", {
      projectDir, enemyId: "basic_grunt", field: "maxHp", value: 15, ifRevision: "stale-not-a-real-revision"
    }, {});
    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.expectedRevision).toBe("stale-not-a-real-revision");
    expect(fs.readFileSync(balancePath, "utf8")).toBe(before);
  });

  it("detects a concurrent edit: a write based on a now-stale revision is rejected", async () => {
    const { revisions } = await callTool("get_project_summary", { projectDir }, {});
    // Someone else writes first...
    await callTool("set_enemy_stat", { projectDir, enemyId: "basic_grunt", field: "maxHp", value: 20 }, {});
    // ...then our agent's write, still holding the OLD revision, is rejected rather than clobbering it.
    const result = await callTool("set_enemy_stat", {
      projectDir, enemyId: "armored_brute", field: "maxHp", value: 30, ifRevision: revisions.balance
    }, {});
    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
  });

  it("guards bind_sprite writes with the visuals revision independently of the balance one", async () => {
    const { revisions } = await callTool("get_project_summary", { projectDir }, {});
    const result = await callTool("bind_sprite", {
      projectDir, kind: "towers", entityId: "arrow_tower", spriteId: "", ifRevision: revisions.visuals
    }, {});
    expect(result.ok).toBe(true);
  });

  // Regression: the revision a successful write reported used to be the pre-write in-memory
  // candidate's hash, computed before the final validateProjectDir await point — a concurrent
  // writer landing in that window made the reported revision stale (didn't match the file on disk).
  // This asserts the returned revision always matches an independent fresh read right after.
  it("returns a revision that matches a fresh read of the file right after a successful write", async () => {
    const result = await callTool("set_enemy_stat", { projectDir, enemyId: "basic_grunt", field: "maxHp", value: 42 }, {});
    expect(result.ok).toBe(true);
    const { revisions } = await callTool("get_project_summary", { projectDir }, {});
    expect(result.revision).toBe(revisions.balance);
  });

  // Regression: applyValidatedBalancePatch used to re-load-and-re-merge the patch against whatever
  // was on disk immediately before writing, instead of reusing the already-validated dry-run
  // candidate — reopening the exact TOCTOU window the pre-write revision check exists to close.
  // Firing overlapping writes lets the (now-unconditional) pre-write check reject the loser rather
  // than silently building its write on top of the winner's already-persisted change.
  it("never silently loses a concurrent write: the pre-write revision check is unconditional, not opt-in", async () => {
    const [a, b] = await Promise.all([
      callTool("set_enemy_stat", { projectDir, enemyId: "basic_grunt", field: "maxHp", value: 111 }, {}),
      callTool("set_enemy_stat", { projectDir, enemyId: "armored_brute", field: "maxHp", value: 222 }, {})
    ]);
    const outcomes = [a, b];
    const succeeded = outcomes.filter((r) => r.ok);
    const rejected = outcomes.filter((r) => !r.ok);
    // Either both serialized cleanly (no real overlap this run) or the loser detected the race —
    // never both claiming ok:true while one write is silently missing from the final file.
    expect(rejected.every((r) => r.conflict === true)).toBe(true);
    if (succeeded.length === 2) {
      const finalBalance = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
      expect(finalBalance.enemies.basic_grunt.maxHp).toBe(111);
      expect(finalBalance.enemies.armored_brute.maxHp).toBe(222);
    } else {
      expect(succeeded.length).toBe(1);
      expect(rejected.length).toBe(1);
    }
  });
});

describe("mcp explain_validation (2.6)", () => {
  it("explains a curated code with an example, no project needed", async () => {
    const result = await callTool("explain_validation", { code: "TOWER_ATTACK_KIND" }, {});
    expect(result.curated).toBe(true);
    expect(result.example.attack.kind).toBeTruthy();
    expect(result.seeAlso).toBe("describe_schema");
  });

  it("echoes the issue's own hint/expected/got when given a whole issue object", async () => {
    const result = await callTool("explain_validation", {
      issue: { code: "TOWER_ATTACK_SLOWFACTOR", message: "must be < 1", hint: "custom hint", expected: "0 < x < 1", got: "1.5" }
    }, {});
    expect(result.hint).toBe("custom hint"); // the issue's own hint wins over the curated one
    expect(result.expected).toBe("0 < x < 1");
    expect(result.curated).toBe(true); // still has a curated example even though hint came from the issue
  });

  it("falls back gracefully for an uncurated code", async () => {
    const result = await callTool("explain_validation", { code: "SOME_MADE_UP_CODE" }, {});
    expect(result.curated).toBe(false);
    expect(result.note).toMatch(/no curated example/i);
  });

  it("rejects a call with neither code nor issue", async () => {
    await expect(callTool("explain_validation", {}, {})).rejects.toThrow(/requires .code. or/i);
  });

  it("round-trips end-to-end: an unknown attack kind's issue code is explainable", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-explain-"));
    fs.mkdirSync(path.join(projectDir, "content"), { recursive: true });
    fs.cpSync(STARTER, projectDir, { recursive: true });
    try {
      await callTool("upsert_entity", {
        projectDir, collection: "towers", id: "typo_tower",
        value: { label: "Typo", cost: { coins: 1 }, footprintRadius: 0, range: 1, attack: { kind: "sinlge" } }
      }, {}).catch(() => {}); // expected to fail validation; we just want the issue shape below
      const dry = await callTool("dry_run_balance_patch", {
        projectDir, patch: { towers: { typo_tower: { id: "typo_tower", label: "Typo", cost: { coins: 1 }, footprintRadius: 0, range: 1, attack: { kind: "sinlge" } } } }
      }, {});
      const kindIssue = dry.validation.issues.find((i) => i.fieldPath === "attack.kind");
      expect(kindIssue).toBeTruthy();
      const explained = await callTool("explain_validation", { issue: kindIssue }, {});
      expect(explained.curated).toBe(true);
      expect(explained.example).toBeTruthy();
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  // Regression: an unguarded `EXPLAIN_CURATED[code]` bracket lookup resolves inherited
  // Object.prototype members (constructor, toString, hasOwnProperty, ...) instead of undefined,
  // producing a false curated:true with garbage content for an attacker/agent-supplied code.
  it.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "does not resolve the inherited Object.prototype member for code %j",
    async (code) => {
      const result = await callTool("explain_validation", { code }, {});
      expect(result.curated).toBe(false);
      expect(result.example).toBeUndefined();
      expect(typeof result.hint === "string" || result.hint === undefined).toBe(true);
    }
  );

  it("rejects a non-string `code` with a distinct error from the missing-code case", async () => {
    await expect(callTool("explain_validation", { code: 42 }, {})).rejects.toThrow(/code.*must be a string/i);
  });

  // Regression: TOWER_ATTACK_SLOWFACTOR's curated example used to omit several fields the
  // "splash" attack kind actually requires (interval/damage/splashDamage/armoredChipDamage/
  // splashRadius), so an agent copying it verbatim would immediately fail validation again.
  it("TOWER_ATTACK_SLOWFACTOR's curated example is itself a fully valid splash attack", async () => {
    const engine = await loadEngine();
    const { example } = await callTool("explain_validation", { code: "TOWER_ATTACK_SLOWFACTOR" }, {});
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-explain-example-"));
    fs.mkdirSync(path.join(projectDir, "content"), { recursive: true });
    fs.cpSync(STARTER, projectDir, { recursive: true });
    try {
      const dry = await callTool("dry_run_balance_patch", {
        projectDir,
        patch: { towers: { example_tower: { id: "example_tower", label: "Example", cost: { coins: 1 }, footprintRadius: 0, range: 3, ...example } } }
      }, {});
      const attackIssues = dry.validation.issues.filter((i) => i.entityId === "example_tower" && i.fieldPath.startsWith("attack"));
      expect(attackIssues).toEqual([]);
      expect(engine.ATTACK_KIND_SCHEMA.splash).toBeTruthy(); // sanity: splash is still a real kind
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  // Regression (finding #8): EXPLAIN_CURATED's keys are hand-written strings that must stay in
  // sync with deriveValidationCode(entityKind, fieldPath) — this pins the (entityKind, fieldPath)
  // pair each curated code actually corresponds to, so a future rename of either derivation input
  // breaks this test instead of silently desyncing the curated map from the real issue codes.
  it("keeps every curated code in sync with deriveValidationCode(entityKind, fieldPath)", async () => {
    const engine = await loadEngine();
    const pairs = [
      ["TOWER_ATTACK_KIND", "tower", "attack.kind"],
      ["TOWER_ATTACK_SLOWFACTOR", "tower", "attack.slowFactor"],
      ["ABILITY_ID", "ability", "id"]
    ];
    for (const [code, entityKind, fieldPath] of pairs) {
      expect(engine.deriveValidationCode(entityKind, fieldPath)).toBe(code);
      const result = await callTool("explain_validation", { code }, {});
      expect(result.curated).toBe(true);
    }
  });
});

describe("mcp review fixes: raw-delta writes, guards, protocol", () => {
  let projectDir;
  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-rawwrite-"));
    fs.mkdirSync(path.join(projectDir, "content"), { recursive: true });
    fs.cpSync(STARTER, projectDir, { recursive: true });
  });
  afterEach(() => { fs.rmSync(projectDir, { recursive: true, force: true }); });

  const balancePath = () => path.join(projectDir, "content", "balance.json");
  const readBalance = () => JSON.parse(fs.readFileSync(balancePath(), "utf8"));

  // Regression (HIGH): every MCP write used to persist the NORMALIZED balance — freezing
  // constants-inherited mission defaults and hex→decimal colors into the authored file on any
  // unrelated write (same defect class as the old `migrate --write` bug).
  it("writes only the author's delta: minimal missions and hex color strings survive an unrelated set_enemy_stat", async () => {
    const authored = readBalance();
    const missionId = Object.keys(authored.missions)[0];
    // Make the authored file rely on inheritance + friendly notation.
    delete authored.missions[missionId].startingResources;
    delete authored.missions[missionId].prepTimeUnits;
    authored.enemies.basic_grunt.color = "#ff0000";
    fs.writeFileSync(balancePath(), JSON.stringify(authored, null, 2));

    const result = await callTool("set_enemy_stat", { projectDir, enemyId: "basic_grunt", field: "maxHp", value: 42 }, {});
    expect(result.ok, JSON.stringify(result.validation?.issues ?? result)).toBe(true);

    const after = readBalance();
    expect(after.enemies.basic_grunt.maxHp).toBe(42); // the delta landed
    expect(after.enemies.basic_grunt.color).toBe("#ff0000"); // authored notation preserved
    expect(after.missions[missionId].startingResources).toBeUndefined(); // inheritance NOT frozen
    expect(after.missions[missionId].prepTimeUnits).toBeUndefined();
  });

  it("upsert_entity leaves sibling entities in their authored (raw) shape", async () => {
    const authored = readBalance();
    authored.enemies.basic_grunt.color = "#00ff00";
    fs.writeFileSync(balancePath(), JSON.stringify(authored, null, 2));

    const result = await callTool("upsert_entity", {
      projectDir, collection: "enemies", id: "new_creep",
      value: { label: "Creep", maxHp: 3, speed: 1, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 255 }
    }, {});
    expect(result.ok, JSON.stringify(result.validation?.issues ?? result)).toBe(true);
    const after = readBalance();
    expect(after.enemies.new_creep.label).toBe("Creep");
    expect(after.enemies.basic_grunt.color).toBe("#00ff00"); // sibling untouched, not re-normalized
  });

  it("upsert_entity(currencies) on a legacy project materializes the implied registry instead of dropping coins", async () => {
    const authored = readBalance();
    delete authored.currencies; // legacy: currencies only implied via resource bags
    fs.writeFileSync(balancePath(), JSON.stringify(authored, null, 2));

    const result = await callTool("upsert_entity", { projectDir, collection: "currencies", id: "gems", value: { label: "Gems" } }, {});
    expect(result.ok, JSON.stringify(result.validation?.issues ?? result)).toBe(true);
    const ids = readBalance().currencies.map((c) => c.id).sort();
    expect(ids).toContain("coins"); // implied primary currency survives
    expect(ids).toContain("gems");
  });

  // Regression (#6): dry-run and failed-apply responses used to echo the entire merged balance.
  it("keeps the merged balance objects off the wire", async () => {
    const dry = await callTool("dry_run_balance_patch", { projectDir, patch: { defaultMissionId: readBalance().defaultMissionId } }, {});
    expect(dry.balance).toBeUndefined();
    expect(dry.rawBalance).toBeUndefined();
    expect(dry.diff).toBeTruthy(); // the capped diff is still there

    const failed = await callTool("apply_validated_patch", {
      projectDir, patch: { towers: { broken: { id: "broken", label: "B", cost: { coins: 1 }, footprintRadius: 0, range: 1, attack: { kind: "nope" } } } }
    }, {});
    expect(failed.ok).toBe(false);
    expect(failed.balance).toBeUndefined();
    expect(failed.rawBalance).toBeUndefined();
  });

  // Regression (#2): write_map/compile_maps scaffolded into arbitrary directories, and
  // compile_maps wiped an existing maps.json to {} when maps/src was missing.
  it("write_map refuses a directory that is not a project", async () => {
    const notAProject = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-not-a-project-"));
    try {
      await expect(callTool("write_map", {
        projectDir: notAProject, mapId: "m", width: 3, height: 3,
        spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 2, r: 1 }, pathCenterline: [{ q: 0, r: 1 }, { q: 2, r: 1 }]
      }, {})).rejects.toThrow(/No project\.json found/);
      expect(fs.existsSync(path.join(notAProject, "maps"))).toBe(false); // nothing scaffolded
    } finally {
      fs.rmSync(notAProject, { recursive: true, force: true });
    }
  });

  it("compile_maps refuses to overwrite compiled maps with an empty set when maps/src is missing", async () => {
    const compiledPath = path.join(projectDir, "maps", "compiled", "maps.json");
    const before = fs.readFileSync(compiledPath, "utf8");
    fs.rmSync(path.join(projectDir, "maps", "src"), { recursive: true, force: true });
    await expect(callTool("compile_maps", { projectDir }, {})).rejects.toThrow(/No map sources found/);
    expect(fs.readFileSync(compiledPath, "utf8")).toBe(before); // untouched
  });

  // Regression (#4): failure responses used to steer agents at phantom tools.
  it("only ever suggests nextValidActions that start with a real registered tool name", async () => {
    const registered = new Set(TOOLS.map((t) => t.name));
    const check = (actions) => {
      for (const action of actions ?? []) {
        const first = String(action).split(/[ (]/)[0];
        expect(registered.has(first), `phantom tool in nextValidActions: "${action}"`).toBe(true);
      }
    };
    const failedApply = await callTool("apply_validated_patch", {
      projectDir, patch: { towers: { broken: { id: "broken", label: "B", cost: { coins: 1 }, footprintRadius: 0, range: 1, attack: { kind: "nope" } } } }
    }, {});
    check(failedApply.nextValidActions);
    const smoke = await callTool("simulate_mission", { projectDir, duration: 5 }, {});
    check(smoke.nextValidActions);
  });

  // Regression (#5): backups grew without bound and same-millisecond writes collided.
  it("gives every write a distinct backup file and prunes old backups past the retention cap", async () => {
    const backupDir = path.join(projectDir, ".towerforge", "mcp-backups");
    // Seed 30 fake old backups (lexicographically older than any new ISO stamp).
    fs.mkdirSync(backupDir, { recursive: true });
    for (let i = 0; i < 30; i += 1) {
      fs.writeFileSync(path.join(backupDir, `balance.json.1999-01-01T00-00-00-000Z.${String(i).padStart(6, "0")}.bak`), "old");
    }
    const a = await callTool("set_enemy_stat", { projectDir, enemyId: "basic_grunt", field: "maxHp", value: 11 }, {});
    const b = await callTool("set_enemy_stat", { projectDir, enemyId: "basic_grunt", field: "maxHp", value: 12 }, {});
    expect(a.backupPath).not.toBe(b.backupPath); // no same-millisecond collision
    const remaining = fs.readdirSync(backupDir).filter((n) => n.startsWith("balance.json."));
    expect(remaining.length).toBeLessThanOrEqual(20); // pruned to the retention cap
  });

  // Regression (#8): ENTITY_COLLECTIONS lookups resolved inherited Object.prototype members.
  it.each(["constructor", "toString", "__proto__"])(
    "rejects prototype-member collection name %j with the designed unknown-collection error",
    async (collection) => {
      await expect(callTool("upsert_entity", { projectDir, collection, id: "x", value: {} }, {}))
        .rejects.toThrow(/unknown collection/);
      await expect(callTool("delete_entity", { projectDir, collection, id: "x" }, {}))
        .rejects.toThrow(/unknown collection/);
    }
  );
});
