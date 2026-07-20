// tools.mjs — Constructor tool registry shared by the MCP server.
//
// Each tool wraps an existing CLI library function so any MCP-capable AI agent gets the same
// capabilities as the TowerForge CLI and Studio. Kept transport-agnostic (no stdio here) so the
// registry and dispatcher can be unit-tested directly.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  loadEngine,
  loadProjectFiles,
  normalizeProjectFiles,
  projectSummary,
  readRawProjectFiles,
  repoRoot,
  runBalanceSweepForProject,
  runMissionPlaytestReport,
  runMissionSmoke,
  validateProjectDir
} from "../cli/lib/project-loader.mjs";
import { compileMapSource, compileMapSources, readMapSources, writeCompiledMaps, writeMapSource } from "../cli/lib/map-compiler.mjs";
import { commitProjectAssetImport, planProjectAssetImport } from "../cli/lib/assets.mjs";
import { exportProjectPack, inspectProjectPack } from "../cli/lib/project-pack.mjs";
import { packageProject } from "../cli/lib/packaging.mjs";
import { validateProjectSchemas } from "../cli/lib/project-schema.mjs";
import { applyThemePack, listThemePacks, previewThemePack } from "../cli/lib/theme-packs.mjs";
import { listProjectTree } from "../cli/lib/project-tree.mjs";
import { resolveTowerScriptPath, restoreTowerScriptWrite, scriptFileRevision, writeTowerScriptAtomic } from "../cli/lib/project-scripts.mjs";
import { findEntityReferences } from "../cli/lib/references.mjs";
import { mergeValidationResults } from "../cli/lib/trace.mjs";
import {
  CONTENT_RECIPE_COLLECTIONS,
  contentRecipeContext,
  listContentRecipes,
  materializeContentRecipe
} from "../cli/lib/content-recipes.mjs";
import { TOWERFORGE_AGENT_GUIDE_VERSION } from "./agent-instructions.mjs";

const BALANCE_PATCH_KEYS = [
  "enemies", "towers", "waveSets", "missions", "abilities", "constants", "currencies", "defaultMissionId",
  "defaultDifficultyId", "difficulties", "metaProgression"
];
const SCHEMA_DOMAINS = Object.freeze(["all", "combat", "missions", "progression", "scripts", "assets"]);

// Maps an upsert_entity/delete_entity `collection` to (a) the balance.json key, (b) the shape
// (a map keyed by id, or an array of {id,...} items — currencies only), and (c) the
// findEntityReferences `kind` used for delete_entity's reference check.
const ENTITY_COLLECTIONS = {
  towers: { balanceKey: "towers", shape: "map", referenceKind: "tower" },
  enemies: { balanceKey: "enemies", shape: "map", referenceKind: "enemy" },
  missions: { balanceKey: "missions", shape: "map", referenceKind: "mission" },
  abilities: { balanceKey: "abilities", shape: "map", referenceKind: "ability" },
  waveSets: { balanceKey: "waveSets", shape: "map", referenceKind: "waveSet" },
  currencies: { balanceKey: "currencies", shape: "array", referenceKind: "currency" }
};

const READ_ENTITY_COLLECTIONS = Object.freeze([
  "towers",
  "enemies",
  "missions",
  "abilities",
  "waveSets",
  "currencies",
  "maps",
  "mapSources",
  "visualSprites",
  "audioSounds",
  "musicTracks",
  "storyComics",
  "battleBackgrounds"
]);

function entityEntries(files, collection) {
  if (!READ_ENTITY_COLLECTIONS.includes(collection)) {
    throw new Error(`Unknown entity collection "${collection}". Expected one of ${READ_ENTITY_COLLECTIONS.join(", ")}.`);
  }
  if (collection === "maps") return Object.entries(files.maps ?? {});
  if (collection === "mapSources") return Object.entries(files.mapSources ?? {});
  if (collection === "storyComics") return Object.entries(files.storyComics?.comics ?? {});
  if (collection === "battleBackgrounds") return Object.entries(files.battleBackgrounds?.definitions ?? {});
  if (collection === "visualSprites") return Object.entries(files.visuals?.sprites ?? {});
  if (collection === "audioSounds") return Object.entries(files.visuals?.audio?.sounds ?? {});
  if (collection === "musicTracks") return Object.entries(files.visuals?.audio?.musicTracks ?? {});
  const value = files.balance?.[collection];
  if (collection === "currencies") {
    return (Array.isArray(value) ? value : []).map((currency) => [currency.id, currency]);
  }
  return Object.entries(value ?? {});
}

function entityListItem(collection, id, value) {
  if (collection === "towers") return { id, label: value.label ?? id, attackKind: value.attack?.kind ?? null, range: value.range ?? null, cost: value.cost ?? {} };
  if (collection === "enemies") return { id, label: value.label ?? id, maxHp: value.maxHp ?? null, speed: value.speed ?? null, coreDamage: value.coreDamage ?? null, movementKind: value.movementKind ?? "path", targetClass: value.targetClass ?? "ground" };
  if (collection === "missions") return { id, label: value.label ?? id, mapId: value.mapId ?? null, waveSetId: value.waveSetId ?? null, towerCount: value.buildTowerIds?.length ?? 0, abilityCount: value.abilityIds?.length ?? 0 };
  if (collection === "abilities") return { id, label: value.label ?? id, preset: value.effects?.length ? null : id, effectKinds: (value.effects ?? []).map((effect) => effect.kind) };
  if (collection === "waveSets") return { id, waveCount: Array.isArray(value) ? value.length : 0, groupCount: Array.isArray(value) ? value.reduce((count, wave) => count + (wave.groups?.length ?? 0), 0) : 0 };
  if (collection === "currencies") return { id, label: value.label ?? id };
  if (collection === "maps") return { id, width: value.width ?? null, height: value.height ?? null, routeIds: (value.pathRoutes ?? []).map((route) => route.id) };
  if (collection === "storyComics") return { id, missionId: value.missionId ?? null, trigger: value.trigger ?? "beforeMission", panelCount: value.panels?.length ?? 0 };
  if (collection === "battleBackgrounds") return { id, missionId: value.missionId ?? id, color: value.color ?? null, spriteId: value.spriteId ?? null };
  if (collection === "visualSprites") return { id, src: value.src ?? null, atlas: value.atlas ?? null, frame: value.frame ?? null };
  if (collection === "audioSounds") return { id, src: value.src ?? null };
  if (collection === "musicTracks") return { id, src: value.src ?? null, volume: value.volume ?? 1 };
  return { id, width: value.width ?? null, height: value.height ?? null, type: value.type ?? null };
}

function entityRevision(files, collection) {
  if (["maps", "mapSources"].includes(collection)) return null;
  if (["visualSprites", "audioSounds", "musicTracks"].includes(collection)) return computeRevision(files.visuals);
  if (collection === "storyComics") return computeRevision(files.storyComics);
  if (collection === "battleBackgrounds") return computeRevision(files.battleBackgrounds);
  return computeRevision(files.balance);
}

// A small, hand-curated set of the highest-value validation codes (2.6): every issue already
// carries an auto-derived `code` (see deriveValidationCode in validate.ts/project-schema.mjs) and,
// where cheap, its own `hint`/`expected`/`got` — this map adds a runnable EXAMPLE snippet for the
// codes an agent hits most often when authoring new content. explain_validation falls back to the
// issue's own fields (or a generic message) for any code not curated here.
// `hint` is duplicated here (not just left on the ValidationIssue) so a caller who only has a bare
// `code` string — an explicitly supported call shape, see the explain_validation tool description
// below — still gets the constraint explanation, not just the example.
const EXPLAIN_CURATED = {
  TOWER_ATTACK_KIND: {
    hint: "Use the universal pipeline kind for new targeting/delivery/effect combinations, or one of the supported legacy kinds. Call describe_schema to see each kind's required fields.",
    example: { attack: { kind: "single", fireRate: 1, damagePerStack: 1, startingStacks: 1, maxStacks: 3, upgradeCost: 5 } },
    seeAlso: "describe_schema"
  },
  TOWER_ATTACK_SLOWFACTOR: {
    hint: "slowFactor multiplies speed (0.5 = half speed) — it must be strictly less than 1, or the enemy wouldn't actually slow down.",
    // Every field a "splash" attack requires (schema-descriptor.ts) — not just slowFactor/slowDuration
    // — so this example is actually runnable, not just illustrative of the one field that failed.
    example: { attack: { kind: "splash", interval: 1.5, damage: 4, splashDamage: 2, armoredChipDamage: 1, splashRadius: 1.5, slowFactor: 0.5, slowDuration: 2 } }
  },
  ABILITY_ID: {
    hint: 'Any ability id is valid once it declares effects: [{kind:"damage", amount} | {kind:"status", status:{stun|slow|poison}}] — no engine code needed.',
    example: { effects: [{ kind: "damage", amount: 20 }, { kind: "status", status: { slow: { factor: 0.5, duration: 3 } } }] },
    seeAlso: "describe_schema"
  }
};

// Shared input-schema fragment for optimistic-concurrency writes (2.8): pass the `revisions`
// value read from get_project_summary/validate_project back here to reject the write (a structured
// conflict result, no file touched) if the project changed underneath the agent since that read —
// e.g. a human editing the same project live in Studio, or another agent's write.
const IF_REVISION_PROPERTY = {
  type: "string",
  description: "Optional. The revision hash last read (from get_project_summary/validate_project/a prior write's response). If the file has since changed, the write is rejected with {conflict:true} instead of clobbering it."
};

/** Tool definitions advertised over `tools/list`. */
export const TOOLS = [
  {
    name: "describe_schema",
    description:
      "Return versioned machine-readable authoring contracts by domain: universal combat pipeline and abilities, mission economy/objectives, difficulty/meta progression, deterministic TowerScript, or safe asset/theme workflows. Call this before creating a new shape; use domain to keep the response focused.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string", enum: SCHEMA_DOMAINS, description: "Focused contract to return; defaults to all." } },
      additionalProperties: false
    }
  },
  {
    name: "list_recipes",
    description:
      "List curated, production-oriented archetypes for enemies, towers, or missions. Recipes are shared with Studio's Add flow and are safer than inventing a raw entity shape from memory. Follow with get_recipe for a project-bound, runnable entity.",
    inputSchema: {
      type: "object",
      properties: { collection: { type: "string", enum: CONTENT_RECIPE_COLLECTIONS } },
      required: ["collection"],
      additionalProperties: false
    }
  },
  {
    name: "get_recipe",
    description:
      "Materialize one curated enemy/tower/mission recipe against the current project. Mission references and support-tower targets are bound to real ids. Review the returned entity, choose a unique id, then write through upsert_entity with ifRevision.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory. Defaults to the server's project." },
        collection: { type: "string", enum: CONTENT_RECIPE_COLLECTIONS },
        recipeId: { type: "string" }
      },
      required: ["collection", "recipeId"],
      additionalProperties: false
    }
  },
  {
    name: "explain_validation",
    description:
      "Explain a validation issue: pass either the whole `issue` object from validate_project/dry_run_balance_patch, or just its `code`, and get back the constraint being enforced plus — where curated — a runnable example snippet that satisfies it. Turns a validation failure into a concrete fix instead of a guess-and-retry loop.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "A validation issue's stable `code` (e.g. \"TOWER_ATTACK_SLOWFACTOR\")." },
        issue: { type: "object", description: "Alternative to `code`: the whole issue object, so its own message/hint/expected/got are echoed back too." }
      }
    }
  },
  {
    name: "get_project_summary",
    description:
      "Load and summarize a .tdproj project: manifest, constants, counts of missions/enemies/towers/maps, applied schema migrations, and content-hash revisions (pass one back as ifRevision on a write tool to guard against a concurrent edit).",
    inputSchema: {
      type: "object",
      properties: { projectDir: { type: "string", description: "Path to the .tdproj directory. Defaults to the server's project." } }
    }
  },
  {
    name: "get_progression",
    description:
      "Read the complete effective defaultDifficultyId, difficulties, and metaProgression sections plus the balance revision. Call this before apply_progression_patch so unchanged multipliers, upgrades, and rewards are preserved.",
    inputSchema: {
      type: "object",
      properties: { projectDir: { type: "string", description: "Path to the .tdproj directory. Defaults to the server's project." } },
      additionalProperties: false
    }
  },
  {
    name: "list_entities",
    description:
      "List compact summaries from one project collection (gameplay entities, maps, visual sprites, sounds, music tracks, story comics, or battle backgrounds). Use this before get_entity instead of guessing ids or requesting a broad project dump.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory. Defaults to the server's project." },
        collection: { type: "string", enum: READ_ENTITY_COLLECTIONS }
      },
      required: ["collection"],
      additionalProperties: false
    }
  },
  {
    name: "get_entity",
    description:
      "Read one effective normalized entity by collection and id. Returns the exact current values the engine sees plus the relevant revision for guarded writes. Prefer this after list_entities and before modifying an existing entity.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory. Defaults to the server's project." },
        collection: { type: "string", enum: READ_ENTITY_COLLECTIONS },
        id: { type: "string" }
      },
      required: ["collection", "id"],
      additionalProperties: false
    }
  },
  {
    name: "list_missions",
    description: "List the missions defined in the project with their map, wave set, available towers, and availability.",
    inputSchema: {
      type: "object",
      properties: { projectDir: { type: "string", description: "Path to the .tdproj directory." } }
    }
  },
  {
    name: "validate_project",
    description:
      "Run the full project validation (schema-level checks plus engine cross-reference and numeric guards). Returns the list of errors and warnings, plus content-hash revisions for optimistic-concurrency writes.",
    inputSchema: {
      type: "object",
      properties: { projectDir: { type: "string", description: "Path to the .tdproj directory." } }
    }
  },
  {
    name: "release_readiness",
    description:
      "Run a read-only production-readiness audit over validation, map compilation, project identity, playable content, and build targets. Returns structured checks with stable ids and severities for Studio, CI, or an AI agent.",
    inputSchema: {
      type: "object",
      properties: { projectDir: { type: "string", description: "Path to the .tdproj directory." } },
      additionalProperties: false
    }
  },
  {
    name: "inspect_project_pack",
    description: "Verify a .tdpack previously exported into this project's .towerforge/exports directory. Checks container version, path allowlist, size limits, and every per-file SHA-256 without extracting it.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the source .tdproj directory." },
        fileName: { type: "string", description: "Basename such as my-game.tdpack; directories are rejected." }
      },
      required: ["fileName"],
      additionalProperties: false
    }
  },
  {
    name: "export_project_pack",
    description: "Validate and export the current project as one integrity-checked .tdpack under .towerforge/exports. The filename is confined to that directory; returns the archive SHA-256 for handoff or release notes.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the source .tdproj directory." },
        fileName: { type: "string", description: "Optional safe basename ending in .tdpack." }
      },
      additionalProperties: false
    }
  },
  {
    name: "simulate_mission",
    description:
      "Run a deterministic headless smoke simulation of a mission (auto-places towers, starts waves) and return the outcome and event/wave statistics.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        missionId: { type: "string", description: "Mission id to simulate. Defaults to the project's defaultMissionId." },
        duration: { type: "number", description: "Simulation duration in time units (default 180, capped at 3600 — the loop is synchronous)." }
      }
    }
  },
  {
    name: "playtest_report",
    description:
      "Run the deterministic auto-play smoke strategy and return a diagnosis with stable finding codes, compact metrics, per-enemy kill/leak pressure, evidence, recommendations, milestones, and the raw event/resource timeline. Prefer this over simulate_mission when deciding what to fix.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory. Defaults to the server's project." },
        missionId: { type: "string", description: "Mission id to diagnose. Defaults to the project's defaultMissionId." },
        duration: { type: "number", description: "Simulation duration in time units (default 180, capped at 3600)." }
      },
      additionalProperties: false
    }
  },
  {
    name: "compile_maps",
    description: "Compile maps/src/*.tmj sources into maps/compiled/maps.json and return the compiled map ids and any issues.",
    inputSchema: {
      type: "object",
      properties: { projectDir: { type: "string", description: "Path to the .tdproj directory." } }
    }
  },
  {
    name: "compile_maps_dry_run",
    description: "Compile maps/src/*.tmj in memory and return compiled map ids and issues without writing maps/compiled/maps.json.",
    inputSchema: {
      type: "object",
      properties: { projectDir: { type: "string", description: "Path to the .tdproj directory." } },
      additionalProperties: false
    }
  },
  {
    name: "build_project",
    description: "Validate the project and build a deployable static web bundle. Returns the output directory and asset copy report.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        targetId: { type: "string", description: "Build target id from build-targets.json. Defaults to the canonical web target." }
      }
    }
  },
  {
    name: "package_mobile",
    description:
      "Wrap the built web bundle into a Capacitor mobile project (Android/iOS) under <project>/mobile — config, package.json, the built game in www/, and a README with the native build + store steps. Does not publish anything. Returns app metadata and next steps.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        targetId: { type: "string", description: "Build target id whose app metadata (appId/appName/version) to use. Defaults to the canonical web target." }
      }
    }
  },
  {
    name: "package_web",
    description:
      "Create a portable, offline web release under <project>/web: a deterministic .zip, a file://-runnable index.single.html, the normal installable PWA build, and a zero-dependency loopback-only Node launcher. Does not upload or publish anything.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        targetId: { type: "string", description: "Optional web build target id." }
      }
    }
  },
  {
    name: "package_desktop",
    description:
      "Wrap the built web bundle into a Tauri v2 desktop project (Windows/macOS/Linux) under <project>/desktop — tauri.conf.json, Cargo/Rust scaffold, the built game in dist/, and a README with the local build + distribution steps. Does not publish anything. Returns app metadata and next steps.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        targetId: { type: "string", description: "Build target id whose app metadata (appId/appName/version) to use. Defaults to the canonical web target." }
      }
    }
  },
  {
    name: "balance_report",
    description:
      "Run a deterministic multi-strategy simulation sweep and return a balance report per mission (win-rate, surviving core HP, tower usage, and advisor flags like unwinnable / trivial / dominant-tower). Use this to diagnose balance before applying patches.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        missionId: { type: "string", description: "Restrict the sweep to a single mission. Omit to sweep all missions." },
        simSeconds: { type: "number", description: "Max simulated time-units per run (default 600)." }
      }
    }
  },
  {
    name: "apply_balance_patch",
    description:
      "Validate and merge top-level balance sections into content/balance.json. Writes only after a successful dry-run; if post-write validation fails, rolls back from the previous file.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        patch: {
          type: "object",
          description: "Object whose recognized top-level keys replace the matching sections of balance.json.",
          properties: {
            enemies: { type: "object" },
            towers: { type: "object" },
            waveSets: { type: "object" },
            missions: { type: "object" },
            abilities: { type: "object" },
            constants: { type: "object" },
            currencies: { type: "array" },
            defaultMissionId: { type: "string" },
            defaultDifficultyId: { type: "string" },
            difficulties: { type: "array" },
            metaProgression: { type: "object" }
          }
        },
        ifRevision: IF_REVISION_PROPERTY
      },
      required: ["patch"]
    }
  },
  {
    name: "dry_run_balance_patch",
    description:
      "Merge top-level balance sections in memory and validate the candidate project without writing files. Returns a leaf-level `diff` ({path, before, after} entries, capped and marked truncated if large) so you can review exactly what would change before committing. Use before risky balance changes.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        patch: {
          type: "object",
          description: "Object whose recognized top-level keys replace the matching sections of balance.json.",
          properties: {
            enemies: { type: "object" },
            towers: { type: "object" },
            waveSets: { type: "object" },
            missions: { type: "object" },
            abilities: { type: "object" },
            constants: { type: "object" },
            currencies: { type: "array" },
            defaultMissionId: { type: "string" },
            defaultDifficultyId: { type: "string" },
            difficulties: { type: "array" },
            metaProgression: { type: "object" }
          },
          additionalProperties: false
        }
      },
      required: ["patch"],
      additionalProperties: false
    }
  },
  {
    name: "apply_validated_patch",
    description:
      "Dry-run a balance patch, then write it only if validation passes. Rolls back if the post-write validation does not match the dry-run.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        patch: {
          type: "object",
          properties: {
            enemies: { type: "object" },
            towers: { type: "object" },
            waveSets: { type: "object" },
            missions: { type: "object" },
            abilities: { type: "object" },
            constants: { type: "object" },
            currencies: { type: "array" },
            defaultMissionId: { type: "string" },
            defaultDifficultyId: { type: "string" },
            difficulties: { type: "array" },
            metaProgression: { type: "object" }
          },
          additionalProperties: false
        },
        ifRevision: IF_REVISION_PROPERTY
      },
      required: ["patch"],
      additionalProperties: false
    }
  },
  {
    name: "dry_run_progression_patch",
    description:
      "Validate a candidate difficulty/meta-progression replacement in memory and return its leaf diff without writing. Read the complete source with get_progression first.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        defaultDifficultyId: { type: "string" },
        difficulties: { type: "array", description: "Complete difficulty definition list." },
        metaProgression: { type: "object", description: "Complete currencies/upgrades/rewardsByMission object." }
      },
      additionalProperties: false
    }
  },
  {
    name: "apply_progression_patch",
    description:
      "Apply only difficulty and persistent meta-progression sections. The complete candidate project is validated; writes use a balance revision guard, backup, and rollback. Call dry_run_progression_patch first, then pass its revision as ifRevision.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        defaultDifficultyId: { type: "string" },
        difficulties: { type: "array", description: "Complete difficulty definition list." },
        metaProgression: { type: "object", description: "Complete currencies/upgrades/rewardsByMission object." },
        ifRevision: IF_REVISION_PROPERTY
      },
      additionalProperties: false
    }
  },
  {
    name: "set_enemy_stat",
    description: "Set one numeric enemy field and validate before writing. Prefer this over replacing the whole enemies section.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        enemyId: { type: "string" },
        field: { type: "string", enum: ["maxHp", "speed", "coreDamage", "coinReward", "color", "hitRadius", "pathCollisionRadius"] },
        value: { type: "number" },
        ifRevision: IF_REVISION_PROPERTY
      },
      required: ["enemyId", "field", "value"],
      additionalProperties: false
    }
  },
  {
    name: "upsert_tower",
    description: "Insert or replace one tower definition and validate before writing. The tower id is forced to towerId.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        towerId: { type: "string" },
        tower: { type: "object" },
        ifRevision: IF_REVISION_PROPERTY
      },
      required: ["towerId", "tower"],
      additionalProperties: false
    }
  },
  {
    name: "add_wave_group",
    description: "Append one enemy group to an existing wave and validate before writing.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        waveSetId: { type: "string" },
        waveId: { type: "string" },
        group: { type: "object" },
        ifRevision: IF_REVISION_PROPERTY
      },
      required: ["waveSetId", "waveId", "group"],
      additionalProperties: false
    }
  },
  {
    name: "list_theme_packs",
    description: "List bundled, locally stored visual theme packs and their renderer palettes. No project or network access is required.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "preview_theme_pack",
    description: "Preview one bundled theme pack against the active project without writing. Returns affected files, missions, prior theme, and the revision required by apply_theme_pack.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        packId: { type: "string" }
      },
      required: ["packId"],
      additionalProperties: false
    }
  },
  {
    name: "list_project_tree",
    description: "List the safe .tdproj tree. Build/cache directories, symlinks, credentials, private keys, and environment files are excluded. This tool never returns file contents.",
    inputSchema: {
      type: "object",
      properties: { projectDir: { type: "string", description: "Path to the .tdproj directory." } },
      additionalProperties: false
    }
  },
  {
    name: "get_tower_script",
    description: "Read one TowerScript definition by script id or project-relative scripts/**/*.tower.json path.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        scriptId: { type: "string" },
        path: { type: "string", description: "Project-relative .tower.json path." }
      },
      additionalProperties: false
    }
  },
  {
    name: "upsert_tower_script",
    description: "Dry-run or write one deterministic TowerScript under scripts/. Validates bindings, expressions, actions, references, and the complete project. Commits atomically with backup and rollback. Use dryRun:true first and pass the returned revision as ifRevision.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        path: { type: "string", description: "Project-relative scripts/**/*.tower.json destination." },
        script: { type: "object", description: "TowerScript definition with schemaVersion, id, bindings, and handlers." },
        dryRun: { type: "boolean" },
        ifRevision: { ...IF_REVISION_PROPERTY, description: "Optional revision of the complete scripts catalog." }
      },
      required: ["path", "script"],
      additionalProperties: false
    }
  },
  {
    name: "apply_theme_pack",
    description: "Apply one bundled theme pack after preview_theme_pack. The destination path is derived by TowerForge, every mission background is updated, the project is validated, and an invalid write is rolled back. Pass the preview revision as ifRevision; dryRun remains a compatibility alias for preview.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        packId: { type: "string", enum: ["verdant-frontier", "frostbound-citadel"] },
        dryRun: { type: "boolean", description: "Return the exact files, missions, and prior theme without writing." },
        ifRevision: IF_REVISION_PROPERTY
      },
      required: ["packId"],
      additionalProperties: false
    }
  },
  {
    name: "bind_sprite",
    description: "Bind an existing sprite id to a tower, enemy, tile, or UI id in content/visuals.json and validate before writing.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        kind: { type: "string", enum: ["towers", "enemies", "tiles", "ui"] },
        entityId: { type: "string" },
        spriteId: { type: "string", description: "Existing sprite id. Empty string removes the binding." },
        ifRevision: { ...IF_REVISION_PROPERTY, description: "Optional. The visuals revision (not the balance one) last read, to guard against a concurrent visuals.json edit." }
      },
      required: ["kind", "entityId", "spriteId"],
      additionalProperties: false
    }
  },
  {
    name: "bind_mission_music",
    description:
      "Preview, set, or remove the looping music track for one mission without replacing the audio catalog. Validates the mission and track, supports dry-run diff, guards visuals with ifRevision, and writes with backup and rollback.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        missionId: { type: "string", description: "Existing mission id." },
        trackId: { type: "string", description: "Existing audio.musicTracks id. Empty string removes the mission binding." },
        dryRun: { type: "boolean", description: "When true, validate and return the diff without writing." },
        ifRevision: { ...IF_REVISION_PROPERTY, description: "Optional visuals revision from get_project_summary." }
      },
      required: ["missionId", "trackId"],
      additionalProperties: false
    }
  },
  {
    name: "import_asset",
    description:
      "Import a file that already exists inside the .tdproj directory into its confined assetsRoot and register it as a sprite, atlas, sound, or looping music track. Rejects absolute/external/traversal paths; validates before commit; guards visuals with ifRevision; backs up and rolls back both visuals.json and an overwritten destination file.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        sourcePath: { type: "string", description: "Project-relative source path, often imports/<file>." },
        targetPath: { type: "string", description: "Path relative to assetsRoot." },
        id: { type: "string", description: "Optional registry id; derived safely from the filename when omitted." },
        kind: { type: "string", enum: ["sprite", "atlas", "sound", "music"] },
        columns: { type: "integer", minimum: 1 },
        rows: { type: "integer", minimum: 1 },
        volume: { type: "number", minimum: 0, maximum: 1, description: "Initial per-track volume for kind=music." },
        ifRevision: { ...IF_REVISION_PROPERTY, description: "Optional visuals revision from get_project_summary." }
      },
      required: ["sourcePath", "kind"],
      additionalProperties: false
    }
  },
  {
    name: "upsert_entity",
    description:
      "Create or replace ONE entity by id in a balance collection (towers, enemies, missions, abilities, waveSets, currencies) without resending the whole collection. For waveSets, `value` is the full array of waves for that wave-set id (creates a NEW wave set if the id doesn't exist yet — this is how an agent authors a wave set, alongside the narrower add_wave_group for appending one group). Set merge:true to shallow-merge into an existing entity instead of replacing it. Validates before writing; rolls back on failure.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        collection: { type: "string", enum: ["towers", "enemies", "missions", "abilities", "waveSets", "currencies"] },
        id: { type: "string", description: "The entity id (for currencies, its `id` field)." },
        value: { description: "The entity object (or, for waveSets, an array of WaveDefinition)." },
        merge: { type: "boolean", description: "Shallow-merge into the existing entity instead of replacing it. Ignored for waveSets (always replaces the array)." },
        ifRevision: IF_REVISION_PROPERTY
      },
      required: ["collection", "id", "value"],
      additionalProperties: false
    }
  },
  {
    name: "duplicate_entity",
    description:
      "Duplicate one existing tower, enemy, mission, ability, waveSet, or currency under a new id. Uses the authored source shape, optionally overrides its label, validates the complete project, and writes through the same backup/rollback and ifRevision guard as upsert_entity.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        collection: { type: "string", enum: ["towers", "enemies", "missions", "abilities", "waveSets", "currencies"] },
        sourceId: { type: "string" },
        targetId: { type: "string" },
        label: { type: "string", description: "Optional label override. Defaults to '<source label> Copy' for labeled entities." },
        ifRevision: IF_REVISION_PROPERTY
      },
      required: ["collection", "sourceId", "targetId"],
      additionalProperties: false
    }
  },
  {
    name: "delete_entity",
    description:
      "Delete ONE entity by id from a balance collection. Refuses (no write) if the id is referenced elsewhere in the project — e.g. an enemy still spawned by a wave, a tower still buildable in a mission, a currency still used in a cost bag — and returns the list of references instead. Pass force:true to delete anyway. The required primary currency \"coins\" can never be deleted.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        collection: { type: "string", enum: ["towers", "enemies", "missions", "abilities", "waveSets", "currencies"] },
        id: { type: "string" },
        force: { type: "boolean", description: "Delete even if references were found." },
        ifRevision: IF_REVISION_PROPERTY
      },
      required: ["collection", "id"],
      additionalProperties: false
    }
  },
  {
    name: "write_map",
    description:
      "Author a new (or replace an existing) map from scratch: dimensions, spawn/core coords, path centerline, and optional multi-route paths / terrain overrides. Writes a maps/src/<mapId>.tmj source, then compiles it into maps/compiled/maps.json. This is the only way to author a playfield over MCP — compile_maps only recompiles EXISTING sources. Validates the map shape before writing anything.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        mapId: { type: "string", description: "Map id; also the source filename (<mapId>.tmj)." },
        width: { type: "integer", description: "Positive integer." },
        height: { type: "integer", description: "Positive integer." },
        spawnCoord: { type: "object", properties: { q: { type: "number" }, r: { type: "number" } }, required: ["q", "r"] },
        coreCoord: { type: "object", properties: { q: { type: "number" }, r: { type: "number" } }, required: ["q", "r"] },
        pathCenterline: {
          type: "array",
          description: "At least 2 hex coords {q,r} from spawn to core.",
          items: { type: "object", properties: { q: { type: "number" }, r: { type: "number" } }, required: ["q", "r"] }
        },
        pathRoutes: {
          type: "array",
          description: "Optional named alternate routes; each { id, pathCenterline }. Omit for a single default route.",
          items: { type: "object" }
        },
        terrainOverrides: {
          type: "array",
          description: "Optional explicit per-tile terrain overrides beyond the default terrain.",
          items: { type: "object", properties: { q: { type: "number" }, r: { type: "number" }, terrain: { type: "string" } } }
        }
      },
      required: ["mapId", "width", "height", "spawnCoord", "coreCoord", "pathCenterline"],
      additionalProperties: false
    }
  },
  {
    name: "upsert_story_comic",
    description:
      "Preview or write one mission-linked story comic without replacing the whole story-comics.json file. Validates mission/sprite references and panel text, supports optimistic concurrency, and backs up + rolls back an invalid write. Call first with dryRun:true, then commit with the returned revision.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        comicId: { type: "string" },
        comic: { type: "object", description: "{missionId,title?,trigger?,replay?,panels:[{text,speaker?,spriteId?}]}" },
        dryRun: { type: "boolean", description: "Validate and return the leaf diff without writing." },
        ifRevision: IF_REVISION_PROPERTY
      },
      required: ["comicId", "comic"],
      additionalProperties: false
    }
  },
  {
    name: "set_battle_background",
    description:
      "Preview, set, or remove one mission background without replacing the whole battle-backgrounds.json file. References an existing standalone sprite ID and/or a color, validates the project, and uses revision guard + backup/rollback.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to the .tdproj directory." },
        missionId: { type: "string" },
        background: { type: "object", description: "{color?,spriteId?,opacity?}. The key is forced to missionId." },
        remove: { type: "boolean", description: "Remove the mission's background definition." },
        dryRun: { type: "boolean", description: "Validate and return the leaf diff without writing." },
        ifRevision: IF_REVISION_PROPERTY
      },
      required: ["missionId"],
      additionalProperties: false
    }
  }
];

const TOOL_RISK = {
  describe_schema: { riskClass: "read_only", sideEffect: "none" },
  list_recipes: { riskClass: "read_only", sideEffect: "none" },
  get_recipe: { riskClass: "read_only", sideEffect: "none" },
  explain_validation: { riskClass: "read_only", sideEffect: "none" },
  get_project_summary: { riskClass: "read_only", sideEffect: "none" },
  get_progression: { riskClass: "read_only", sideEffect: "none" },
  list_entities: { riskClass: "read_only", sideEffect: "none" },
  get_entity: { riskClass: "read_only", sideEffect: "none" },
  list_missions: { riskClass: "read_only", sideEffect: "none" },
  list_theme_packs: { riskClass: "read_only", sideEffect: "none" },
  preview_theme_pack: { riskClass: "compute_only", sideEffect: "none" },
  list_project_tree: { riskClass: "read_only", sideEffect: "none" },
  get_tower_script: { riskClass: "read_only", sideEffect: "none" },
  upsert_tower_script: { riskClass: "write_local", sideEffect: "optionally writes one confined scripts/**/*.tower.json file with backup and rollback" },
  apply_theme_pack: { riskClass: "write_local", sideEffect: "optionally writes a bundled background asset plus visuals and mission background catalogs with backup and rollback" },
  validate_project: { riskClass: "compute_only", sideEffect: "builds engine dist if stale" },
  release_readiness: { riskClass: "compute_only", sideEffect: "compiles maps in memory and builds engine dist if stale" },
  inspect_project_pack: { riskClass: "read_only", sideEffect: "reads one confined .towerforge/exports archive" },
  export_project_pack: { riskClass: "write_local", sideEffect: "writes one .tdpack under .towerforge/exports" },
  simulate_mission: { riskClass: "compute_only", sideEffect: "builds engine dist if stale" },
  playtest_report: { riskClass: "compute_only", sideEffect: "builds engine dist if stale" },
  compile_maps_dry_run: { riskClass: "compute_only", sideEffect: "none" },
  compile_maps: { riskClass: "write_local", sideEffect: "writes maps/compiled/maps.json" },
  build_project: { riskClass: "write_local", sideEffect: "writes build output directory" },
  package_mobile: { riskClass: "write_local", sideEffect: "writes mobile scaffold" },
  package_web: { riskClass: "write_local", sideEffect: "writes a portable web bundle and deterministic zip under the project" },
  package_desktop: { riskClass: "write_local", sideEffect: "writes desktop scaffold" },
  balance_report: { riskClass: "compute_only", sideEffect: "builds engine dist if stale" },
  dry_run_balance_patch: { riskClass: "compute_only", sideEffect: "none" },
  apply_balance_patch: { riskClass: "write_local", sideEffect: "writes content/balance.json with backup and rollback" },
  apply_validated_patch: { riskClass: "write_local", sideEffect: "writes content/balance.json with backup and rollback" },
  dry_run_progression_patch: { riskClass: "compute_only", sideEffect: "none" },
  apply_progression_patch: { riskClass: "write_local", sideEffect: "optionally writes difficulty/meta-progression sections in content/balance.json with backup and rollback" },
  set_enemy_stat: { riskClass: "write_local", sideEffect: "writes content/balance.json with backup and rollback" },
  upsert_tower: { riskClass: "write_local", sideEffect: "writes content/balance.json with backup and rollback" },
  add_wave_group: { riskClass: "write_local", sideEffect: "writes content/balance.json with backup and rollback" },
  bind_sprite: { riskClass: "write_local", sideEffect: "writes content/visuals.json with backup and rollback" },
  bind_mission_music: { riskClass: "write_local", sideEffect: "optionally writes one audio.musicByMission binding in content/visuals.json with backup and rollback" },
  import_asset: { riskClass: "write_local", sideEffect: "copies one project-local asset and writes content/visuals.json with backup and rollback" },
  upsert_entity: { riskClass: "write_local", sideEffect: "writes content/balance.json with backup and rollback" },
  duplicate_entity: { riskClass: "write_local", sideEffect: "writes content/balance.json with backup and rollback" },
  delete_entity: { riskClass: "write_local", sideEffect: "writes content/balance.json with backup and rollback; refuses if referenced" },
  write_map: { riskClass: "write_local", sideEffect: "writes maps/src/<mapId>.tmj and maps/compiled/maps.json" },
  upsert_story_comic: { riskClass: "write_local", sideEffect: "optionally writes content/story-comics.json with backup and rollback" },
  set_battle_background: { riskClass: "write_local", sideEffect: "optionally writes content/battle-backgrounds.json with backup and rollback" }
};

for (const tool of TOOLS) Object.assign(tool, TOOL_RISK[tool.name] ?? { riskClass: "unknown", sideEffect: "unspecified" });

const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));

/**
 * Dispatch a tool call. Returns a plain serializable object (the MCP layer wraps it as text content).
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {{ defaultProjectDir: string }} ctx
 */
export async function callTool(name, args = {}, ctx = {}) {
  if (!TOOL_NAMES.has(name)) {
    throw new Error(`Unknown tool: ${name}`);
  }

  // Pure schema metadata — no project needed, so it runs before (and without) resolveDir.
  if (name === "describe_schema") {
    const engine = await loadEngine();
    const domain = args.domain ?? "all";
    if (!SCHEMA_DOMAINS.includes(domain)) throw new Error(`Unknown schema domain "${domain}".`);
    const includes = (candidate) => domain === "all" || domain === candidate;
    return {
      schemaVersion: 2,
      agentGuideVersion: TOWERFORGE_AGENT_GUIDE_VERSION,
      requestedDomain: domain,
      availableDomains: SCHEMA_DOMAINS,
      mechanismSelection: {
        standardContent: "granular entity/map tools",
        towerCombat: "universal pipeline preferred; legacy kinds remain for compatibility",
        customLifecycle: "TowerScript",
        campaignVariants: "difficulties and metaProgression",
        visuals: "theme packs and confined asset/binding tools"
      },
      ...(includes("combat") ? {
        attackKinds: engine.ATTACK_KIND_SCHEMA,
        towerPipeline: engine.TOWER_PIPELINE_SCHEMA,
        abilityPresets: engine.ABILITY_SCHEMA,
        abilityEffects: engine.ABILITY_EFFECT_SCHEMA,
        targetModes: engine.TARGET_MODE_SCHEMA,
        abilityNote:
          "Mission ability ids are open. Presets work without effects; a custom id composes damage/status effects without engine code."
      } : {}),
      ...(includes("missions") ? {
        currencyRules: engine.CURRENCY_RULES,
        missionEconomy: engine.MISSION_ECONOMY_SCHEMA,
        missionObjectives: engine.MISSION_OBJECTIVES_SCHEMA,
        simulationActions: ["startWave", "placeTower", "moveTower", "upgradeTower", "sellTower", "setTargetMode", "useAbility", "emitSignal"]
      } : {}),
      ...(includes("progression") ? {
        difficulty: engine.DIFFICULTY_SCHEMA,
        metaProgression: engine.META_PROGRESSION_SCHEMA
      } : {}),
      ...(includes("scripts") ? { towerScript: engine.TOWER_SCRIPT_SCHEMA } : {}),
      ...(includes("assets") ? {
        assetAuthoring: {
          themePacks: "Call list_theme_packs, preview_theme_pack, then apply_theme_pack with ifRevision.",
          imports: "Use import_asset for one project-local image/audio asset; never write arbitrary paths.",
          bindings: ["bind_sprite", "bind_mission_music", "upsert_story_comic", "set_battle_background"],
          pathRule: "Project-relative paths only; absolute paths, external URLs, traversal, and symlink escapes are rejected."
        }
      } : {})
    };
  }

  if (name === "list_recipes") {
    return { collection: args.collection, recipes: listContentRecipes(args.collection) };
  }

  if (name === "list_theme_packs") {
    return { packs: listThemePacks() };
  }

  if (name === "explain_validation") {
    if (args.code !== undefined && typeof args.code !== "string") {
      throw new Error("explain_validation: `code` must be a string.");
    }
    const code = args.code ?? args.issue?.code;
    if (!code) throw new Error("explain_validation requires `code` or an `issue` object carrying one.");
    // hasOwnProperty guard: EXPLAIN_CURATED is a plain object literal, so an unguarded bracket
    // lookup would resolve an Object.prototype member name (e.g. code:"constructor") to the
    // inherited Function instead of undefined, producing a false curated:true with no content.
    const curated = Object.prototype.hasOwnProperty.call(EXPLAIN_CURATED, code) ? EXPLAIN_CURATED[code] : undefined;
    return {
      code,
      message: args.issue?.message,
      hint: args.issue?.hint ?? curated?.hint,
      expected: args.issue?.expected,
      got: args.issue?.got,
      example: curated?.example,
      seeAlso: curated?.seeAlso,
      curated: Boolean(curated),
      note: curated ? undefined : "No curated example for this code yet — see message/hint/expected/got above, or call describe_schema for the general shape."
    };
  }

  const projectDir = resolveDir(args.projectDir, ctx.defaultProjectDir);

  switch (name) {
    case "get_project_summary": {
      const files = loadProjectFiles(projectDir);
      const summary = projectSummary(files);
      return {
        projectDir,
        manifest: summary.manifest,
        constants: summary.constants,
        defaultMissionId: summary.defaultMissionId,
        progression: {
          defaultDifficultyId: summary.defaultDifficultyId,
          difficulties: (summary.difficulties ?? []).map((difficulty) => ({ id: difficulty.id, label: difficulty.label })),
          metaCurrencies: (summary.metaProgression?.currencies ?? []).map((currency) => ({ id: currency.id, label: currency.label })),
          metaUpgrades: Object.values(summary.metaProgression?.upgrades ?? {}).map((upgrade) => ({ id: upgrade.id, label: upgrade.label, maxLevel: upgrade.maxLevel, effectKinds: (upgrade.effects ?? []).map((effect) => effect.kind) })),
          rewardMissionIds: Object.keys(summary.metaProgression?.rewardsByMission ?? {})
        },
        appliedMigrations: summary.appliedMigrations,
        counts: {
          missions: Object.keys(summary.missions ?? {}).length,
          enemies: Object.keys(summary.enemies ?? {}).length,
          towers: Object.keys(summary.towers ?? {}).length,
          waveSets: Object.keys(summary.waveSets ?? {}).length,
          maps: Object.keys(summary.maps ?? {}).length,
          mapSources: Object.keys(summary.mapSources ?? {}).length,
          visualSprites: Object.keys(summary.visuals?.sprites ?? {}).length,
          audioSounds: Object.keys(summary.visuals?.audio?.sounds ?? {}).length,
          musicTracks: Object.keys(summary.visuals?.audio?.musicTracks ?? {}).length,
          storyComics: Object.keys(summary.storyComics?.comics ?? {}).length,
          battleBackgrounds: Object.keys(summary.battleBackgrounds?.definitions ?? {}).length,
          scripts: Object.keys(summary.scripts ?? {}).length
        },
        availableMaps: summary.availableMaps,
        mapRoutes: summary.mapRoutes,
        // Content-hash revisions for optimistic-concurrency writes (upsert_entity, apply_validated_patch,
        // bind_sprite, ...): pass the relevant one back as `ifRevision` to reject a write if the file
        // changed underneath the agent (e.g. a human editing the same project live in Studio).
        revisions: {
          balance: computeRevision(files.balance),
          visuals: computeRevision(files.visuals),
          storyComics: computeRevision(files.storyComics),
          battleBackgrounds: computeRevision(files.battleBackgrounds),
          scripts: computeRevision(files.scripts)
        }
      };
    }

    case "get_progression": {
      const files = loadProjectFiles(projectDir);
      return {
        projectDir,
        defaultDifficultyId: files.balance.defaultDifficultyId,
        difficulties: files.balance.difficulties,
        metaProgression: files.balance.metaProgression,
        revision: computeRevision(files.balance),
        nextValidActions: ["describe_schema with domain progression", "dry_run_progression_patch", "apply_progression_patch with ifRevision"]
      };
    }

    case "list_project_tree":
      return { projectDir, ...listProjectTree(projectDir) };

    case "get_tower_script": {
      const files = loadProjectFiles(projectDir);
      let entry;
      if (typeof args.path === "string") entry = files.scriptFiles?.[args.path];
      else if (typeof args.scriptId === "string") entry = Object.values(files.scriptFiles ?? {}).find((file) => file.definition?.id === args.scriptId);
      else throw new Error("get_tower_script requires scriptId or path.");
      if (!entry) throw new Error("TowerScript was not found.");
      return { projectDir, path: entry.path, source: entry.source, script: entry.definition, error: entry.error, revision: computeRevision(entry.definition ?? entry.source) };
    }

    case "upsert_tower_script":
      return upsertTowerScript(projectDir, args);

    case "list_entities": {
      const files = loadProjectFiles(projectDir);
      return {
        projectDir,
        collection: args.collection,
        entities: entityEntries(files, args.collection).map(([id, value]) => entityListItem(args.collection, id, value)),
        revision: entityRevision(files, args.collection)
      };
    }

    case "get_entity": {
      const files = loadProjectFiles(projectDir);
      const entries = entityEntries(files, args.collection);
      const found = entries.find(([id]) => id === args.id);
      if (!found) throw new Error(`get_entity: ${args.collection} entity "${args.id}" was not found.`);
      return {
        projectDir,
        collection: args.collection,
        id: args.id,
        entity: found[1],
        source: "normalized_effective",
        revision: entityRevision(files, args.collection)
      };
    }
    case "get_recipe": {
      const files = loadProjectFiles(projectDir);
      return {
        projectDir,
        collection: args.collection,
        recipe: materializeContentRecipe(args.collection, args.recipeId, contentRecipeContext(files)),
        revision: computeRevision(files.balance),
        nextValidActions: ["review and set a unique entity.id", "upsert_entity with ifRevision", "validate_project"]
      };
    }
    case "release_readiness": {
      const files = loadProjectFiles(projectDir);
      const { result: validation } = await validateProjectDir(projectDir);
      const mapCompile = compileMapSources(files.mapSources ?? {});
      const targets = Object.values(files.buildTargets?.targets ?? {});
      const checks = [
        {
          id: "validation",
          label: "Project validation",
          severity: validation.ok ? "ok" : "error",
          message: validation.ok ? "No validation errors." : `${validation.errorCount ?? validation.issues?.filter((issue) => issue.severity === "error").length ?? 0} validation error(s).`
        },
        {
          id: "maps",
          label: "Map compilation",
          severity: mapCompile.ok ? "ok" : "error",
          message: mapCompile.ok ? `${Object.keys(mapCompile.maps ?? {}).length} map(s) compile in memory.` : `${mapCompile.issues?.length ?? 0} map issue(s).`
        },
        {
          id: "identity",
          label: "Project identity",
          severity: files.manifest?.name && files.manifest?.engineVersion ? "ok" : "error",
          message: files.manifest?.name && files.manifest?.engineVersion ? `${files.manifest.name} · engine ${files.manifest.engineVersion}` : "project.json needs name and engineVersion."
        },
        {
          id: "content",
          label: "Playable content",
          severity: Object.keys(files.balance?.missions ?? {}).length && Object.keys(files.balance?.towers ?? {}).length && Object.keys(files.balance?.enemies ?? {}).length ? "ok" : "error",
          message: `${Object.keys(files.balance?.missions ?? {}).length} missions · ${Object.keys(files.balance?.towers ?? {}).length} towers · ${Object.keys(files.balance?.enemies ?? {}).length} enemies`
        },
        {
          id: "build_targets",
          label: "Build targets",
          severity: targets.length ? "ok" : "warning",
          message: targets.length ? `${targets.length} configured target(s): ${targets.map((target) => target.id).join(", ")}` : "No build target is configured."
        }
      ];
      return {
        projectDir,
        ok: checks.every((check) => check.severity !== "error"),
        checks,
        validation,
        mapIssues: mapCompile.issues ?? [],
        revisions: { balance: computeRevision(files.balance) }
      };
    }

    case "inspect_project_pack": {
      const packPath = confinedPackPath(projectDir, args.fileName);
      const { entries, ...report } = inspectProjectPack(packPath);
      return { projectDir, fileName: args.fileName, ...report, files: entries.map(({ path: filePath, size, sha256: hash }) => ({ path: filePath, size, sha256: hash })) };
    }

    case "export_project_pack": {
      const defaultName = `${path.basename(projectDir, ".tdproj").replace(/[^A-Za-z0-9_-]+/g, "-") || "project"}.tdpack`;
      const fileName = args.fileName ?? defaultName;
      const outputPath = confinedPackPath(projectDir, fileName);
      const result = await exportProjectPack(projectDir, outputPath);
      return { projectDir, ...result, fileName, relativePath: path.relative(projectDir, outputPath).split(path.sep).join("/") };
    }

    case "list_missions": {
      const files = loadProjectFiles(projectDir);
      const missions = files.balance.missions ?? {};
      return {
        projectDir,
        missions: Object.values(missions).map((mission) => ({
          id: mission.id,
          label: mission.label,
          availability: mission.availability ?? "playable",
          mapId: mission.mapId,
          waveSetId: mission.waveSetId,
          buildTowerIds: mission.buildTowerIds ?? [],
          abilityIds: mission.abilityIds ?? []
        }))
      };
    }

    case "validate_project": {
      const { result } = await validateProjectDir(projectDir);
      const files = loadProjectFiles(projectDir);
      return {
        projectDir,
        ok: result.ok,
        errorCount: result.issues.filter((issue) => issue.severity === "error").length,
        warningCount: result.issues.filter((issue) => issue.severity === "warning").length,
        issues: result.issues,
        revisions: {
          balance: computeRevision(files.balance),
          visuals: computeRevision(files.visuals),
          storyComics: computeRevision(files.storyComics),
          battleBackgrounds: computeRevision(files.battleBackgrounds)
        }
      };
    }

    case "simulate_mission": {
      // Clamp like the balance sweep does: the smoke loop is fully synchronous, so an unbounded
      // duration (e.g. an agent passing milliseconds) would block the whole single-process MCP
      // server for hours. 3600 time units is far beyond any real mission.
      const duration = Number.isFinite(args.duration) && args.duration > 0 ? Math.min(args.duration, 3600) : 180;
      return runMissionSmoke(projectDir, args.missionId, duration);
    }

    case "playtest_report": {
      const duration = Number.isFinite(args.duration) && args.duration > 0 ? Math.min(args.duration, 3600) : 180;
      return runMissionPlaytestReport(projectDir, args.missionId, duration);
    }

    case "duplicate_entity":
      return duplicateEntity(projectDir, args);

    case "import_asset":
      return importAsset(projectDir, args);

    case "compile_maps": {
      assertProjectDir(projectDir);
      const sources = readMapSources(projectDir);
      if (Object.keys(sources).length === 0) {
        // Refuse rather than "succeed": compiling zero sources would overwrite an existing
        // maps/compiled/maps.json with {} — almost certainly a typo'd projectDir, not intent.
        throw new Error(`No map sources found in ${path.join(projectDir, "maps", "src")} — refusing to overwrite maps/compiled/maps.json with an empty set. Use write_map to author a map first.`);
      }
      const result = compileMapSources(sources);
      if (!result.ok) {
        return { projectDir, ok: false, issues: result.issues };
      }
      const outFile = writeCompiledMaps(projectDir, result.maps);
      return { projectDir, ok: true, outFile, mapIds: Object.keys(result.maps), issues: result.issues };
    }

    case "compile_maps_dry_run": {
      assertProjectDir(projectDir);
      const sources = readMapSources(projectDir);
      const result = compileMapSources(sources);
      return {
        projectDir,
        ok: result.ok,
        dryRun: true,
        mapIds: Object.keys(result.maps ?? {}),
        issues: result.issues
      };
    }

    case "balance_report": {
      const report = await runBalanceSweepForProject(projectDir, {
        missionIds: typeof args.missionId === "string" ? [args.missionId] : [],
        simSeconds: Number.isFinite(args.simSeconds) ? args.simSeconds : undefined
      });
      return { projectDir, ...report };
    }

    case "build_project":
      return runBuild(projectDir, typeof args.targetId === "string" ? args.targetId : null);

    case "package_mobile":
      return packageProject(projectDir, { kind: "mobile", targetId: typeof args.targetId === "string" ? args.targetId : null });

    case "package_web":
      return packageProject(projectDir, { kind: "web", targetId: typeof args.targetId === "string" ? args.targetId : null });

    case "package_desktop":
      return packageProject(projectDir, { kind: "desktop", targetId: typeof args.targetId === "string" ? args.targetId : null });

    case "apply_balance_patch":
      return applyValidatedBalancePatch(projectDir, args.patch, { compatibilityToolName: "apply_balance_patch", ifRevision: args.ifRevision });

    case "dry_run_balance_patch":
      return toWire(await dryRunBalancePatch(projectDir, args.patch));

    case "apply_validated_patch":
      return applyValidatedBalancePatch(projectDir, args.patch, { ifRevision: args.ifRevision });

    case "dry_run_progression_patch":
      return toWire(await dryRunBalancePatch(projectDir, progressionPatchFromArgs(args)));

    case "apply_progression_patch":
      return applyValidatedBalancePatch(projectDir, progressionPatchFromArgs(args), { ifRevision: args.ifRevision });

    case "set_enemy_stat":
      return setEnemyStat(projectDir, args);

    case "upsert_tower":
      return upsertTower(projectDir, args);

    case "add_wave_group":
      return addWaveGroup(projectDir, args);

    case "bind_sprite":
      return bindSprite(projectDir, args);

    case "apply_theme_pack":
      return args.dryRun
        ? previewThemePack(projectDir, args.packId)
        : applyThemePack(projectDir, args.packId, { ifRevision: args.ifRevision });

    case "preview_theme_pack":
      return previewThemePack(projectDir, args.packId);

    case "bind_mission_music":
      return bindMissionMusic(projectDir, args);

    case "upsert_entity":
      return upsertEntity(projectDir, args);

    case "delete_entity":
      return deleteEntity(projectDir, args);

    case "write_map":
      return writeMap(projectDir, args);

    case "upsert_story_comic":
      return writeNarrativeEntry(projectDir, "storyComics", args.comicId, args.comic, args);

    case "set_battle_background":
      return writeNarrativeEntry(projectDir, "battleBackgrounds", args.missionId, args.remove ? null : (args.background ?? {}), args);

    default:
      throw new Error(`Unhandled tool: ${name}`);
  }
}

/** Tools that scaffold files (write_map, compile_maps) don't go through loadProjectFiles, which is
 *  what normally rejects a non-project directory — without this check a typo'd projectDir gets a
 *  maps/ tree silently created inside it (and the agent "succeeds" against the wrong directory). */
function assertProjectDir(projectDir) {
  if (!fs.existsSync(path.join(projectDir, "project.json"))) {
    throw new Error(`No project.json found at: ${projectDir}`);
  }
}

function resolveDir(explicit, fallback) {
  if (typeof explicit === "string" && explicit.trim()) return path.resolve(explicit);
  if (typeof fallback === "string" && fallback.trim()) return fallback;
  throw new Error("No project directory provided and no default configured for this MCP server.");
}

const BUILD_TIMEOUT_MS = 180_000;

function runBuild(projectDir, targetId) {
  return new Promise((resolve) => {
    const buildArgs = [path.join(repoRoot, "packages", "cli", "build.mjs"), "--project", projectDir, "--json"];
    if (targetId) buildArgs.push("--target", targetId);
    // A timeout guards against a hung child (e.g. a stalled tsc) leaving the promise — and thus the
    // MCP server's graceful shutdown — pending forever.
    const child = spawn(process.execPath, buildArgs, { cwd: repoRoot, timeout: BUILD_TIMEOUT_MS, killSignal: "SIGKILL" });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => done({ ok: false, projectDir, error: error.message }));
    child.on("close", (code, signal) => {
      if (signal) {
        done({ ok: false, projectDir, error: `Build process terminated (${signal}) after ${BUILD_TIMEOUT_MS}ms.`, output: stdout.trim() || undefined });
        return;
      }
      try {
        done(JSON.parse(stdout));
      } catch {
        done({ ok: code === 0, projectDir, output: stdout.trim(), error: stderr.trim() || undefined });
      }
    });
  });
}

async function dryRunBalancePatch(projectDir, patch) {
  // One raw read is the source of truth for this whole operation: the WRITE payload is the
  // AUTHORED (raw) balance with the patch's top-level sections replaced, so a write persists only
  // the agent's delta — NOT the loader's normalization (constants-inherited mission defaults,
  // hex→decimal colors, injected per-entity defaults). Writing the normalized object froze that
  // inheritance into the source file on every MCP write — same defect class as the old
  // `migrate --write` bug. Validation, revision, and diff all run on the NORMALIZED view (what the
  // engine will actually see), derived in-memory from the same raw read.
  const raw = readRawProjectFiles(projectDir);
  const files = normalizeProjectFiles(raw);
  const beforeRevision = computeRevision(files.balance);
  const { balance: rawBalance, applied } = mergeBalancePatch(raw.balance, patch);
  const candidateFiles = normalizeProjectFiles({ ...raw, balance: rawBalance });
  const result = await validateCandidateFiles(candidateFiles);
  return {
    projectDir,
    ok: result.ok,
    dryRun: true,
    applied,
    revision: beforeRevision,
    rawBalance, // INTERNAL: the write payload — stripped from wire responses (see toWire below)
    balance: candidateFiles.balance, // INTERNAL: normalized candidate, reused by the apply path
    diff: computeDiff(files.balance, candidateFiles.balance, applied),
    validation: validationSummary(result)
  };
}

async function upsertTowerScript(projectDir, args) {
  const files = loadProjectFiles(projectDir);
  const revision = computeRevision(files.scripts);
  if (args.ifRevision !== undefined && args.ifRevision !== revision) {
    return { projectDir, ok: false, conflict: true, expectedRevision: args.ifRevision, actualRevision: revision, written: false };
  }
  if (typeof args.path !== "string") throw new Error("upsert_tower_script requires a project-relative path.");
  if (!args.script || typeof args.script !== "object" || Array.isArray(args.script)) throw new Error("upsert_tower_script requires a script object.");
  const scriptPath = resolveTowerScriptPath(projectDir, args.path);
  const sourceRevision = scriptFileRevision(scriptPath);
  const scripts = structuredCloneCompat(files.scripts ?? {});
  const previousId = files.scriptFiles?.[args.path]?.definition?.id;
  if (previousId) delete scripts[previousId];
  const duplicate = Object.entries(files.scriptFiles ?? {}).find(([filePath, file]) => filePath !== args.path && file.definition?.id === args.script.id);
  if (duplicate) {
    return { projectDir, ok: false, dryRun: Boolean(args.dryRun), written: false, revision, validation: { ok: false, errorCount: 1, warningCount: 0, issues: [{ severity: "error", entityKind: "script", entityId: args.script.id, fieldPath: "id", code: "SCRIPT_ID", message: `Script id "${args.script.id}" is already declared by ${duplicate[0]}.` }] } };
  }
  scripts[args.script.id] = structuredCloneCompat(args.script);
  const candidateFiles = { ...files, scripts };
  const validation = await validateCandidateFiles(candidateFiles);
  const summary = validationSummary(validation);
  if (args.dryRun || !validation.ok) {
    return { projectDir, ok: validation.ok, dryRun: true, written: false, path: args.path, scriptId: args.script.id, revision, validation: summary };
  }

  const latestRevision = computeRevision(loadProjectFiles(projectDir).scripts);
  if (latestRevision !== revision) return { projectDir, ok: false, conflict: true, expectedRevision: revision, actualRevision: latestRevision, written: false };
  const write = writeTowerScriptAtomic(projectDir, args.path, `${JSON.stringify(args.script, null, 2)}\n`, { ifRevision: sourceRevision });
  if (!write.ok) return { projectDir, ok: false, conflict: true, expectedFileRevision: sourceRevision, actualFileRevision: write.revision, written: false };
  try {
    const post = await validateProjectDir(projectDir);
    if (!post.result.ok) {
      restoreTowerScriptWrite(projectDir, args.path, write.backup);
      return { projectDir, ok: false, written: false, rolledBack: true, path: args.path, revision, validation: validationSummary(post.result) };
    }
    const finalFiles = loadProjectFiles(projectDir);
    return { projectDir, ok: true, written: true, dryRun: false, path: args.path, scriptId: args.script.id, backupCreated: Boolean(write.backup), revision: computeRevision(finalFiles.scripts), validation: validationSummary(post.result) };
  } catch (error) {
    restoreTowerScriptWrite(projectDir, args.path, write.backup);
    throw error;
  }
}

/** Strip internal plumbing (the full merged balance objects) from a dry-run result before it goes
 *  to the wire: agents need the capped diff + validation, not tens of KB of the whole balance.json
 *  echoed back on every call. */
function toWire(dryRun) {
  const { balance, rawBalance, ...wire } = dryRun;
  return wire;
}

async function applyValidatedBalancePatch(projectDir, patch, options = {}) {
  const dryRun = await dryRunBalancePatch(projectDir, patch);
  if (options.ifRevision && dryRun.revision !== options.ifRevision) {
    return {
      projectDir,
      ok: false,
      written: false,
      conflict: true,
      expectedRevision: options.ifRevision,
      actualRevision: dryRun.revision,
      nextValidActions: ["get_project_summary to read the current revision, re-apply the intended change against it"]
    };
  }
  if (!dryRun.validation.ok) {
    return { ...toWire(dryRun), ok: false, written: false, nextValidActions: ["explain_validation on any issue in validation.issues", "dry_run_balance_patch"] };
  }

  const balancePath = path.join(projectDir, "content", "balance.json");

  // Narrow the TOCTOU window as much as possible: re-check the on-disk revision immediately
  // before writing, against a FRESH read — but reuse dryRun.balance (already validated) as the
  // write payload instead of re-reading-and-re-merging, which would silently re-open this exact
  // race by building the write on top of whatever landed on disk in between (a concurrent Studio
  // save, or another MCP write). This check runs unconditionally, not just when the caller passed
  // ifRevision — a mismatch here always means the write would be based on stale content.
  const preWriteRevision = computeRevision(loadProjectFiles(projectDir).balance);
  if (preWriteRevision !== dryRun.revision) {
    return {
      projectDir,
      ok: false,
      written: false,
      conflict: true,
      expectedRevision: dryRun.revision,
      actualRevision: preWriteRevision,
      nextValidActions: ["dry_run_balance_patch against the current state and retry"]
    };
  }

  const originalText = fs.existsSync(balancePath) ? fs.readFileSync(balancePath, "utf8") : null;
  const backupPath = backupFile(projectDir, balancePath);
  // Persist the RAW merge (authored source + patch sections), never the normalized candidate — see
  // the dryRunBalancePatch comment. The post-write validateProjectDir below re-normalizes on load,
  // so the effective content is exactly the validated candidate.
  writeJsonAtomic(balancePath, dryRun.rawBalance);

  const { result } = await validateProjectDir(projectDir);
  const summary = validationSummary(result);
  if (!result.ok) {
    if (originalText === null) {
      fs.rmSync(balancePath, { force: true });
    } else {
      writeTextAtomic(balancePath, originalText);
    }
    return {
      projectDir,
      ok: false,
      written: false,
      rolledBack: true,
      applied: dryRun.applied,
      backupPath,
      compatibilityToolName: options.compatibilityToolName,
      validation: summary,
      nextValidActions: ["explain_validation on any issue in validation.issues", "dry_run_balance_patch"]
    };
  }

  // Report the revision of what's truly on disk right now (a final fresh read), not the
  // in-memory pre-write object — validateProjectDir above awaited a dynamic import, a real yield
  // point another writer could have landed in, and a stale reported revision here would silently
  // hide that from a caller chaining a subsequent ifRevision write.
  const finalRevision = computeRevision(loadProjectFiles(projectDir).balance);

  return {
    projectDir,
    ok: true,
    written: true,
    rolledBack: false,
    applied: dryRun.applied,
    backupPath,
    compatibilityToolName: options.compatibilityToolName,
    revision: finalRevision,
    diff: dryRun.diff,
    validation: summary,
    nextValidActions: ["balance_report", "validate_project"]
  };
}

async function setEnemyStat(projectDir, args) {
  const { enemyId, field, value, ifRevision } = args;
  if (typeof enemyId !== "string" || !enemyId) throw new Error("set_enemy_stat requires enemyId.");
  if (!["maxHp", "speed", "coreDamage", "coinReward", "color", "hitRadius", "pathCollisionRadius"].includes(field)) {
    throw new Error("set_enemy_stat field is not supported.");
  }
  if (!Number.isFinite(value)) throw new Error("set_enemy_stat value must be a finite number.");
  // Clone the section from the RAW (authored) balance so the patched section stays minimal too —
  // cloning the normalized section would freeze loader-injected defaults into the file on write.
  const raw = readRawProjectFiles(projectDir);
  const current = raw.balance.enemies?.[enemyId];
  if (!current) throw new Error(`Enemy "${enemyId}" not found.`);
  const enemies = { ...raw.balance.enemies, [enemyId]: { ...current, [field]: value } };
  return applyValidatedBalancePatch(projectDir, { enemies }, { ifRevision });
}

async function upsertTower(projectDir, args) {
  const { towerId, tower, ifRevision } = args;
  if (typeof towerId !== "string" || !towerId) throw new Error("upsert_tower requires towerId.");
  if (!tower || typeof tower !== "object" || Array.isArray(tower)) throw new Error("upsert_tower requires a tower object.");
  const raw = readRawProjectFiles(projectDir); // raw section: write only the authored delta
  const towers = { ...raw.balance.towers, [towerId]: { ...tower, id: towerId } };
  return applyValidatedBalancePatch(projectDir, { towers }, { ifRevision });
}

async function addWaveGroup(projectDir, args) {
  const { waveSetId, waveId, group, ifRevision } = args;
  if (typeof waveSetId !== "string" || !waveSetId) throw new Error("add_wave_group requires waveSetId.");
  if (typeof waveId !== "string" || !waveId) throw new Error("add_wave_group requires waveId.");
  if (!group || typeof group !== "object" || Array.isArray(group)) throw new Error("add_wave_group requires a group object.");
  const raw = readRawProjectFiles(projectDir); // raw section: write only the authored delta
  const waves = raw.balance.waveSets?.[waveSetId];
  if (!Array.isArray(waves)) throw new Error(`Wave set "${waveSetId}" not found.`);
  let found = false;
  const nextWaves = waves.map((wave) => {
    if (wave.id !== waveId) return wave;
    found = true;
    return { ...wave, groups: [...(wave.groups ?? []), group] };
  });
  if (!found) throw new Error(`Wave "${waveId}" not found in wave set "${waveSetId}".`);
  const waveSets = { ...raw.balance.waveSets, [waveSetId]: nextWaves };
  return applyValidatedBalancePatch(projectDir, { waveSets }, { ifRevision });
}

async function bindSprite(projectDir, args) {
  const { kind, entityId, spriteId, ifRevision } = args;
  if (!["towers", "enemies", "tiles", "ui"].includes(kind)) throw new Error("bind_sprite kind must be towers, enemies, tiles, or ui.");
  if (typeof entityId !== "string" || !entityId) throw new Error("bind_sprite requires entityId.");
  if (typeof spriteId !== "string") throw new Error("bind_sprite requires spriteId.");
  // Raw is the write source (persist only the author's delta, not normalizeVisuals defaults);
  // the normalized view drives checks and revision math (revisions everywhere hash the
  // loadProjectFiles view, so ifRevision comparisons must stay in that space).
  const raw = readRawProjectFiles(projectDir);
  const files = normalizeProjectFiles(raw);
  if (kind === "towers" && !files.balance.towers?.[entityId]) throw new Error(`Tower "${entityId}" not found.`);
  if (kind === "enemies" && !files.balance.enemies?.[entityId]) throw new Error(`Enemy "${entityId}" not found.`);
  if (spriteId && !files.visuals?.sprites?.[spriteId]) throw new Error(`Sprite "${spriteId}" not found.`);

  const beforeRevision = computeRevision(files.visuals);
  if (ifRevision && beforeRevision !== ifRevision) {
    return { projectDir, ok: false, written: false, conflict: true, expectedRevision: ifRevision, actualRevision: beforeRevision };
  }

  const visuals = structuredCloneCompat(raw.visuals ?? {});
  visuals.bindings ??= {};
  visuals.bindings[kind] ??= {};
  if (spriteId) visuals.bindings[kind][entityId] = spriteId;
  else delete visuals.bindings[kind][entityId];

  // Validate the EFFECTIVE (normalized) result of writing this raw payload.
  const candidate = normalizeProjectFiles({ ...raw, visuals });
  const result = validateProjectSchemas(candidate);
  if (!result.ok) {
    return { projectDir, ok: false, written: false, validation: validationSummary(result), nextValidActions: ["explain_validation on any issue in validation.issues"] };
  }

  const visualsPath = path.join(projectDir, "content", "visuals.json");
  const originalText = fs.existsSync(visualsPath) ? fs.readFileSync(visualsPath, "utf8") : null;
  const backupPath = backupFile(projectDir, visualsPath);
  writeJsonAtomic(visualsPath, visuals);
  const postFiles = loadProjectFiles(projectDir);
  const post = validateProjectSchemas(postFiles);
  if (!post.ok) {
    if (originalText === null) fs.rmSync(visualsPath, { force: true });
    else writeTextAtomic(visualsPath, originalText);
    return { projectDir, ok: false, written: false, rolledBack: true, backupPath, validation: validationSummary(post) };
  }
  // Report the normalized-space revision (fresh post-write read) — the same space
  // get_project_summary reports and the next ifRevision write will be checked against.
  return { projectDir, ok: true, written: true, backupPath, revision: computeRevision(postFiles.visuals), binding: { kind, entityId, spriteId }, validation: validationSummary(post) };
}

async function bindMissionMusic(projectDir, args) {
  assertProjectDir(projectDir);
  const { missionId, trackId, dryRun = false, ifRevision } = args;
  if (typeof missionId !== "string" || !missionId.trim()) throw new Error("bind_mission_music requires missionId.");
  if (typeof trackId !== "string") throw new Error("bind_mission_music requires trackId (empty removes the binding).");

  const raw = readRawProjectFiles(projectDir);
  const files = normalizeProjectFiles(raw);
  if (!files.balance.missions?.[missionId]) throw new Error(`Mission "${missionId}" not found.`);
  if (trackId && !files.visuals.audio?.musicTracks?.[trackId]) throw new Error(`Music track "${trackId}" not found.`);

  const revision = computeRevision(files.visuals);
  if (ifRevision && revision !== ifRevision) {
    return { projectDir, ok: false, written: false, conflict: true, expectedRevision: ifRevision, actualRevision: revision };
  }

  const visuals = structuredCloneCompat(raw.visuals ?? {});
  visuals.audio ??= {};
  visuals.audio.musicByMission ??= {};
  if (trackId) visuals.audio.musicByMission[missionId] = trackId;
  else delete visuals.audio.musicByMission[missionId];

  const candidate = normalizeProjectFiles({ ...raw, visuals });
  const result = await validateCandidateFiles(candidate);
  const diff = computeDiff({ visuals: files.visuals }, { visuals: candidate.visuals }, ["visuals"]);
  const validation = validationSummary(result);
  if (!result.ok) {
    return { projectDir, ok: false, written: false, dryRun: Boolean(dryRun), revision, diff, validation, nextValidActions: ["explain_validation"] };
  }
  if (dryRun) {
    return {
      projectDir,
      ok: true,
      written: false,
      dryRun: true,
      revision,
      binding: { missionId, trackId },
      diff,
      validation,
      nextValidActions: ["retry bind_mission_music with dryRun:false and ifRevision"]
    };
  }

  // Candidate validation loads the engine asynchronously. Recheck after that yield so a Studio
  // save becomes a conflict instead of being overwritten by this older candidate.
  const currentRevision = computeRevision(loadProjectFiles(projectDir).visuals);
  if (currentRevision !== revision) {
    return { projectDir, ok: false, written: false, conflict: true, expectedRevision: revision, actualRevision: currentRevision };
  }

  const visualsPath = path.join(projectDir, "content", "visuals.json");
  const originalText = fs.existsSync(visualsPath) ? fs.readFileSync(visualsPath, "utf8") : null;
  const backupPath = backupFile(projectDir, visualsPath);
  writeJsonAtomic(visualsPath, visuals);
  const { result: postResult } = await validateProjectDir(projectDir);
  const postValidation = validationSummary(postResult);
  if (!postResult.ok) {
    if (originalText === null) fs.rmSync(visualsPath, { force: true });
    else writeTextAtomic(visualsPath, originalText);
    return { projectDir, ok: false, written: false, rolledBack: true, backupPath, diff, validation: postValidation };
  }

  const finalFiles = loadProjectFiles(projectDir);
  return {
    projectDir,
    ok: true,
    written: true,
    rolledBack: false,
    backupPath,
    revision: computeRevision(finalFiles.visuals),
    binding: { missionId, trackId },
    diff,
    validation: postValidation,
    nextValidActions: ["validate_project", "build_project"]
  };
}

async function writeNarrativeEntry(projectDir, sectionName, id, value, options = {}) {
  assertProjectDir(projectDir);
  if (typeof id !== "string" || !id.trim()) throw new Error(`${sectionName} write requires a non-empty id.`);
  if (value !== null && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error(`${sectionName} write requires an object value, or remove:true where supported.`);
  }

  const spec = sectionName === "storyComics"
    ? { recordKey: "comics", fileName: "story-comics.json" }
    : { recordKey: "definitions", fileName: "battle-backgrounds.json" };
  const raw = readRawProjectFiles(projectDir);
  const files = normalizeProjectFiles(raw);
  const revision = computeRevision(files[sectionName]);
  if (options.ifRevision && revision !== options.ifRevision) {
    return { projectDir, ok: false, written: false, conflict: true, expectedRevision: options.ifRevision, actualRevision: revision };
  }

  const nextSection = structuredCloneCompat(raw[sectionName] ?? files[sectionName]);
  nextSection[spec.recordKey] ??= {};
  if (value === null) delete nextSection[spec.recordKey][id];
  else nextSection[spec.recordKey][id] = structuredCloneCompat(value);
  const candidate = normalizeProjectFiles({ ...raw, [sectionName]: nextSection });
  const result = await validateCandidateFiles(candidate);
  const diff = computeDiff(
    { [sectionName]: files[sectionName] },
    { [sectionName]: candidate[sectionName] },
    [sectionName]
  );
  const validation = validationSummary(result);
  if (!result.ok) {
    return { projectDir, ok: false, written: false, dryRun: Boolean(options.dryRun), revision, diff, validation, nextValidActions: ["explain_validation", "list_entities"] };
  }
  if (options.dryRun) {
    return { projectDir, ok: true, written: false, dryRun: true, revision, diff, validation, nextValidActions: [`retry ${sectionName === "storyComics" ? "upsert_story_comic" : "set_battle_background"} with ifRevision`] };
  }

  // Validation loads the engine asynchronously. Re-read after that yield so a concurrent Studio
  // save cannot be overwritten by a candidate based on stale narrative content.
  const currentRevision = computeRevision(loadProjectFiles(projectDir)[sectionName]);
  if (currentRevision !== revision) {
    return { projectDir, ok: false, written: false, conflict: true, expectedRevision: revision, actualRevision: currentRevision };
  }

  const filePath = path.join(projectDir, "content", spec.fileName);
  const originalText = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
  const backupPath = backupFile(projectDir, filePath);
  writeJsonAtomic(filePath, nextSection);
  const { result: postResult } = await validateProjectDir(projectDir);
  const postValidation = validationSummary(postResult);
  if (!postResult.ok) {
    if (originalText === null) fs.rmSync(filePath, { force: true });
    else writeTextAtomic(filePath, originalText);
    return { projectDir, ok: false, written: false, rolledBack: true, backupPath, diff, validation: postValidation };
  }
  const finalFiles = loadProjectFiles(projectDir);
  return {
    projectDir,
    ok: true,
    written: true,
    rolledBack: false,
    backupPath,
    revision: computeRevision(finalFiles[sectionName]),
    diff,
    validation: postValidation,
    nextValidActions: ["validate_project", "build_project"]
  };
}

async function importAsset(projectDir, args) {
  assertProjectDir(projectDir);
  const raw = readRawProjectFiles(projectDir);
  const files = normalizeProjectFiles(raw);
  const beforeRevision = computeRevision(files.visuals);
  if (args.ifRevision && beforeRevision !== args.ifRevision) {
    return { projectDir, ok: false, written: false, conflict: true, expectedRevision: args.ifRevision, actualRevision: beforeRevision };
  }

  const plan = planProjectAssetImport(projectDir, raw.visuals ?? files.visuals, args);
  const candidate = normalizeProjectFiles({ ...raw, visuals: plan.visuals });
  const validation = await validateCandidateFiles(candidate);
  if (!validation.ok) {
    return { projectDir, ok: false, written: false, validation: validationSummary(validation), nextValidActions: ["explain_validation"] };
  }

  // Recheck after async engine validation so a concurrent Studio/agent edit cannot be clobbered.
  const currentRevision = computeRevision(loadProjectFiles(projectDir).visuals);
  if (currentRevision !== beforeRevision) {
    return { projectDir, ok: false, written: false, conflict: true, expectedRevision: beforeRevision, actualRevision: currentRevision };
  }

  const visualsPath = path.join(projectDir, "content", "visuals.json");
  const originalVisuals = fs.existsSync(visualsPath) ? fs.readFileSync(visualsPath, "utf8") : null;
  const visualsBackupPath = backupFile(projectDir, visualsPath);
  const assetExisted = plan.copyRequired && fs.existsSync(plan.destPath);
  const assetBackupPath = assetExisted ? backupFile(projectDir, plan.destPath) : null;
  try {
    commitProjectAssetImport(plan);
    writeJsonAtomic(visualsPath, plan.visuals);
    const postFiles = loadProjectFiles(projectDir);
    const post = await validateCandidateFiles(postFiles);
    if (!post.ok) throw new Error("Imported asset made the project invalid after commit.");
    return {
      projectDir,
      ok: true,
      written: true,
      asset: plan.asset,
      backupPath: visualsBackupPath,
      assetBackupPath,
      revision: computeRevision(postFiles.visuals),
      diff: computeDiff({ visuals: files.visuals }, { visuals: postFiles.visuals }, ["visuals"]),
      validation: validationSummary(post)
    };
  } catch (error) {
    if (originalVisuals === null) fs.rmSync(visualsPath, { force: true });
    else writeTextAtomic(visualsPath, originalVisuals);
    if (plan.copyRequired) {
      if (assetExisted && assetBackupPath) fs.copyFileSync(assetBackupPath, plan.destPath);
      else fs.rmSync(plan.destPath, { force: true });
    }
    return { projectDir, ok: false, written: false, rolledBack: true, error: error.message, backupPath: visualsBackupPath, assetBackupPath };
  }
}

// Prototype-safe ENTITY_COLLECTIONS lookup: a bare bracket read would resolve inherited
// Object.prototype members (collection: "constructor" → the inherited Function), skating past the
// `!spec` check into a confusing downstream error — the same gap the EXPLAIN_CURATED lookup closed.
function entityCollectionSpec(collection) {
  return Object.prototype.hasOwnProperty.call(ENTITY_COLLECTIONS, collection) ? ENTITY_COLLECTIONS[collection] : undefined;
}

function confinedPackPath(projectDir, fileName) {
  if (typeof fileName !== "string" || !/^[A-Za-z0-9._-]+\.tdpack$/i.test(fileName) || path.basename(fileName) !== fileName) {
    throw new Error("Project pack fileName must be a basename ending in .tdpack.");
  }
  return path.join(projectDir, ".towerforge", "exports", fileName);
}

async function upsertEntity(projectDir, args) {
  const { collection, id, value, merge, ifRevision } = args;
  const spec = entityCollectionSpec(collection);
  if (!spec) throw new Error(`upsert_entity: unknown collection "${collection}". Expected one of ${Object.keys(ENTITY_COLLECTIONS).join(", ")}.`);
  if (typeof id !== "string" || !id) throw new Error("upsert_entity requires id.");
  if (value === undefined || value === null || typeof value !== "object") throw new Error("upsert_entity requires a value object (or array, for waveSets).");

  const raw = readRawProjectFiles(projectDir);

  if (spec.shape === "map") {
    // Raw section: merge/replace against the AUTHORED entity so a write persists only the delta.
    const balance = raw.balance;
    const current = balance[spec.balanceKey]?.[id];
    const nextEntity = collection === "waveSets"
      ? value // an array of waves — no id field to force, always a full replace
      : { ...(merge && current ? current : {}), ...value, id };
    const nextCollection = { ...(balance[spec.balanceKey] ?? {}), [id]: nextEntity };
    return applyValidatedBalancePatch(projectDir, { [spec.balanceKey]: nextCollection }, { ifRevision });
  }

  // shape === "array" (currencies): deliberately sourced from the NORMALIZED registry, not raw —
  // a legacy project may only imply its currencies via resource bags (the currency-registry
  // migration materializes them), and appending to the raw (possibly absent) list would silently
  // drop the implied ones, including required "coins". Persisting the materialized registry here
  // is a migration delta, not normalization damage.
  const list = normalizeProjectFiles(raw).balance.currencies ?? [];
  const index = list.findIndex((item) => item?.id === id);
  const nextItem = { ...(merge && index !== -1 ? list[index] : {}), ...value, id };
  const nextList = index === -1 ? [...list, nextItem] : list.map((item, i) => (i === index ? nextItem : item));
  return applyValidatedBalancePatch(projectDir, { [spec.balanceKey]: nextList }, { ifRevision });
}

async function duplicateEntity(projectDir, args) {
  const { collection, sourceId, targetId, label, ifRevision } = args;
  const spec = entityCollectionSpec(collection);
  if (!spec) throw new Error(`duplicate_entity: unknown collection "${collection}". Expected one of ${Object.keys(ENTITY_COLLECTIONS).join(", ")}.`);
  if (typeof sourceId !== "string" || !sourceId || typeof targetId !== "string" || !targetId) {
    throw new Error("duplicate_entity requires non-empty sourceId and targetId.");
  }
  if (sourceId === targetId) throw new Error("duplicate_entity targetId must differ from sourceId.");

  const raw = readRawProjectFiles(projectDir);
  const normalized = normalizeProjectFiles(raw);
  let source;
  if (spec.shape === "map") {
    if (normalized.balance[spec.balanceKey]?.[targetId]) throw new Error(`${collection} "${targetId}" already exists.`);
    source = raw.balance[spec.balanceKey]?.[sourceId] ?? normalized.balance[spec.balanceKey]?.[sourceId];
  } else {
    const existing = normalized.balance[spec.balanceKey] ?? [];
    if (existing.some((item) => item?.id === targetId)) throw new Error(`${collection} "${targetId}" already exists.`);
    source = (raw.balance[spec.balanceKey] ?? []).find((item) => item?.id === sourceId)
      ?? existing.find((item) => item?.id === sourceId);
  }
  if (source === undefined) throw new Error(`${collection} "${sourceId}" not found.`);

  const value = structuredCloneCompat(source);
  if (!Array.isArray(value) && collection !== "waveSets") {
    value.id = targetId;
    if (label !== undefined) value.label = label;
    else if (typeof value.label === "string" && value.label) value.label = `${value.label} Copy`;
  }
  const result = await upsertEntity(projectDir, { collection, id: targetId, value, ifRevision });
  return { ...result, duplicated: { collection, sourceId, targetId } };
}

async function deleteEntity(projectDir, args) {
  const { collection, id, force, ifRevision } = args;
  const spec = entityCollectionSpec(collection);
  if (!spec) throw new Error(`delete_entity: unknown collection "${collection}". Expected one of ${Object.keys(ENTITY_COLLECTIONS).join(", ")}.`);
  if (typeof id !== "string" || !id) throw new Error("delete_entity requires id.");
  if (collection === "currencies" && id === "coins") {
    throw new Error('delete_entity: "coins" is the required primary currency and cannot be deleted.');
  }

  const raw = readRawProjectFiles(projectDir);
  // Reference-checking (and currency existence) runs on the NORMALIZED view: inherited resource
  // bags and the materialized currency registry are real usages the raw file doesn't spell out.
  const files = normalizeProjectFiles(raw);

  if (spec.shape === "map") {
    if (!files.balance[spec.balanceKey]?.[id]) throw new Error(`${collection} "${id}" not found.`);
  } else if (!(files.balance[spec.balanceKey] ?? []).some((item) => item?.id === id)) {
    throw new Error(`${collection} "${id}" not found.`);
  }

  if (!force) {
    const references = findEntityReferences(files, spec.referenceKind, id);
    if (references.length > 0) {
      return { projectDir, ok: false, written: false, refused: "referenced", references, nextValidActions: ["retry with force:true, or remove the references first"] };
    }
  }

  if (spec.shape === "map") {
    // Raw section, so deleting one entity doesn't rewrite its siblings in normalized form.
    const nextCollection = { ...raw.balance[spec.balanceKey] };
    delete nextCollection[id];
    return applyValidatedBalancePatch(projectDir, { [spec.balanceKey]: nextCollection }, { ifRevision });
  }
  // currencies: filter the NORMALIZED registry (see upsertEntity for why raw would drop implied ones).
  const nextList = (files.balance[spec.balanceKey] ?? []).filter((item) => item?.id !== id);
  return applyValidatedBalancePatch(projectDir, { [spec.balanceKey]: nextList }, { ifRevision });
}

async function writeMap(projectDir, args) {
  assertProjectDir(projectDir);
  const { mapId, width, height, spawnCoord, coreCoord, pathCenterline, pathRoutes, terrainOverrides } = args;
  if (typeof mapId !== "string" || !mapId) throw new Error("write_map requires mapId.");
  const sourceName = `${mapId}.tmj`;
  const source = {
    id: mapId,
    width,
    height,
    defaultTerrain: "buildable",
    spawnCoord,
    coreCoord,
    pathCenterline,
    terrainOverrides: Array.isArray(terrainOverrides) ? terrainOverrides : [],
    pathRoutes: Array.isArray(pathRoutes) ? pathRoutes : []
  };

  // Validate the map shape BEFORE writing anything, so a malformed map never touches disk.
  try {
    compileMapSource(source, sourceName);
  } catch (error) {
    return { projectDir, ok: false, written: false, mapId, error: error.message };
  }

  writeMapSource(projectDir, sourceName, source);
  const sources = readMapSources(projectDir);
  const result = compileMapSources(sources);
  if (!result.ok) {
    return { projectDir, ok: false, written: true, mapId, issues: result.issues, nextValidActions: ["compile_maps_dry_run"] };
  }
  const outFile = writeCompiledMaps(projectDir, result.maps);
  return {
    projectDir,
    ok: true,
    written: true,
    mapId,
    sourcePath: path.join(projectDir, "maps", "src", sourceName),
    outFile,
    mapIds: Object.keys(result.maps),
    issues: result.issues,
    nextValidActions: ["upsert_entity (missions) to reference this map via mapId", "validate_project"]
  };
}

function mergeBalancePatch(inputBalance, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Balance patch requires a `patch` object.");
  }
  for (const key of Object.keys(patch)) {
    if (!BALANCE_PATCH_KEYS.includes(key)) {
      throw new Error(`Patch contained unrecognized balance keys: ${key}. Allowed: ${BALANCE_PATCH_KEYS.join(", ")}.`);
    }
  }
  const balance = structuredCloneCompat(inputBalance);
  const applied = [];
  for (const key of BALANCE_PATCH_KEYS) {
    if (patch[key] !== undefined) {
      balance[key] = structuredCloneCompat(patch[key]);
      applied.push(key);
    }
  }
  if (applied.length === 0) {
    throw new Error(`Patch contained no recognized balance keys. Allowed: ${BALANCE_PATCH_KEYS.join(", ")}.`);
  }
  return { balance, applied };
}

function progressionPatchFromArgs(args) {
  return Object.fromEntries(["defaultDifficultyId", "difficulties", "metaProgression"]
    .filter((key) => args[key] !== undefined)
    .map((key) => [key, args[key]]));
}

async function validateCandidateFiles(files) {
  const engine = await loadEngine();
  const content = engine.createGameContentRegistry({
    balance: files.balance,
    maps: files.maps,
    worldMap: files.worldMap,
    scripts: files.scripts,
    visuals: files.visuals,
    storyComics: files.storyComics,
    battleBackgrounds: files.battleBackgrounds
  });
  return mergeValidationResults(validateProjectSchemas(files), engine.validateGameContentRegistry(content));
}

function validationSummary(result) {
  return {
    ok: result.ok,
    errorCount: result.issues.filter((issue) => issue.severity === "error").length,
    warningCount: result.issues.filter((issue) => issue.severity === "warning").length,
    issues: result.issues
  };
}

/** A stable content hash for optimistic-concurrency checks (2.8) — same value in, same value out,
 *  independent of on-disk formatting/whitespace. */
function computeRevision(value) {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 12);
}

const DIFF_LIMIT = 200;

/** Deep leaf-level diff between two JSON-compatible values, returning {path, before, after}
 *  entries for every field that actually changed (2.4). Walks the FULL tree first (project
 *  balance.json files are small — dozens to low hundreds of entities — so this is cheap) and only
 *  caps the OUTPUT at DIFF_LIMIT, so `truncated` is unambiguous: true iff there really were more
 *  than DIFF_LIMIT real changes, never a false positive from hitting the cap mid-walk while later
 *  siblings turn out unchanged. `changeCount` is always the TRUE total, even when `changes` is capped. */
function computeDiff(before, after, topLevelKeys) {
  const entries = [];
  for (const key of topLevelKeys) {
    diffValues(before?.[key], after?.[key], key, entries);
  }
  return { changes: entries.slice(0, DIFF_LIMIT), changeCount: entries.length, truncated: entries.length > DIFF_LIMIT };
}

function diffValues(before, after, pathPrefix, entries) {
  if (before === after) return;
  const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (isPlainObject(before) && isPlainObject(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      diffValues(before[key], after[key], `${pathPrefix}.${key}`, entries);
    }
    return;
  }
  // Arrays: index-diff so a one-element change inside a large array (e.g. adding one wave group)
  // reports just that element's leaf fields, not the whole array twice. Elements missing on one
  // side compare against undefined, which the primitive branch below reports as add/remove.
  if (Array.isArray(before) && Array.isArray(after)) {
    if (JSON.stringify(before) === JSON.stringify(after)) return; // fast path: identical
    const maxLength = Math.max(before.length, after.length);
    for (let i = 0; i < maxLength; i += 1) {
      diffValues(before[i], after[i], `${pathPrefix}[${i}]`, entries);
    }
    return;
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  // Leave `undefined` as-is (not coerced to null): JSON.stringify omits an undefined property
  // entirely, so "field was absent" (no before/after key after serialization) stays
  // distinguishable from "field was explicitly null" (before/after: null) on the wire.
  entries.push({ path: pathPrefix, before, after });
}

function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp.${process.pid}.${createHash("sha1").update(filePath).digest("hex").slice(0, 6)}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

function writeTextAtomic(filePath, text) {
  const tmp = `${filePath}.tmp.${process.pid}.${createHash("sha1").update(filePath).digest("hex").slice(0, 6)}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, filePath);
}

const BACKUPS_KEPT_PER_FILE = 20;
let backupSequence = 0;

function backupFile(projectDir, filePath) {
  if (!fs.existsSync(filePath)) return null;
  const backupDir = path.join(projectDir, ".towerforge", "mcp-backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const base = path.basename(filePath);
  // A per-process padded sequence makes two writes within the same millisecond produce distinct
  // backup files instead of silently overwriting each other.
  const seq = String(backupSequence++).padStart(6, "0");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `${base}.${stamp}.${seq}.bak`);
  fs.copyFileSync(filePath, backupPath);
  // Retention: keep only the newest N backups per file, so an agent's iterative tuning loop
  // (hundreds of writes) doesn't grow the directory without bound across sessions. Names start
  // with an ISO stamp, so a lexicographic sort is chronological.
  const siblings = fs.readdirSync(backupDir).filter((name) => name.startsWith(`${base}.`) && name.endsWith(".bak")).sort();
  for (const stale of siblings.slice(0, Math.max(0, siblings.length - BACKUPS_KEPT_PER_FILE))) {
    fs.rmSync(path.join(backupDir, stale), { force: true });
  }
  return backupPath;
}

function structuredCloneCompat(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}
