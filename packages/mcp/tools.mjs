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
  runMissionSmoke,
  validateProjectDir
} from "../cli/lib/project-loader.mjs";
import { compileMapSource, compileMapSources, readMapSources, writeCompiledMaps, writeMapSource } from "../cli/lib/map-compiler.mjs";
import { packageProject } from "../cli/lib/packaging.mjs";
import { validateProjectSchemas } from "../cli/lib/project-schema.mjs";
import { findEntityReferences } from "../cli/lib/references.mjs";
import { mergeValidationResults } from "../cli/lib/trace.mjs";

const BALANCE_PATCH_KEYS = ["enemies", "towers", "waveSets", "missions", "abilities", "constants", "currencies", "defaultMissionId"];

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
    hint: "attack.kind must be one of the engine-implemented kinds (single, pulse, sniper, antiair, splash, support, support_buff). Call describe_schema to see each kind's required fields.",
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
      "Return the machine-readable content schema: every tower attack kind (a closed, engine-implemented set) with required fields; the 3 preset mission abilities (path_water/strike/freeze, usable with no extra fields); and the ability EFFECT vocabulary (damage, status) a CUSTOM ability id (any string) composes via its `effects` array — no engine code needed for a new ability, just declare effects. Also returns the currency-id rule. Call this BEFORE authoring a tower/enemy/ability so the shape is right on the first attempt instead of iterating against validate_project errors.",
    inputSchema: { type: "object", properties: {} }
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
            defaultMissionId: { type: "string" }
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
            defaultMissionId: { type: "string" }
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
            defaultMissionId: { type: "string" }
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
  }
];

const TOOL_RISK = {
  describe_schema: { riskClass: "read_only", sideEffect: "none" },
  explain_validation: { riskClass: "read_only", sideEffect: "none" },
  get_project_summary: { riskClass: "read_only", sideEffect: "none" },
  list_missions: { riskClass: "read_only", sideEffect: "none" },
  validate_project: { riskClass: "compute_only", sideEffect: "builds engine dist if stale" },
  simulate_mission: { riskClass: "compute_only", sideEffect: "builds engine dist if stale" },
  compile_maps_dry_run: { riskClass: "compute_only", sideEffect: "none" },
  compile_maps: { riskClass: "write_local", sideEffect: "writes maps/compiled/maps.json" },
  build_project: { riskClass: "write_local", sideEffect: "writes build output directory" },
  package_mobile: { riskClass: "write_local", sideEffect: "writes mobile scaffold" },
  package_desktop: { riskClass: "write_local", sideEffect: "writes desktop scaffold" },
  balance_report: { riskClass: "compute_only", sideEffect: "builds engine dist if stale" },
  dry_run_balance_patch: { riskClass: "compute_only", sideEffect: "none" },
  apply_balance_patch: { riskClass: "write_local", sideEffect: "writes content/balance.json with backup and rollback" },
  apply_validated_patch: { riskClass: "write_local", sideEffect: "writes content/balance.json with backup and rollback" },
  set_enemy_stat: { riskClass: "write_local", sideEffect: "writes content/balance.json with backup and rollback" },
  upsert_tower: { riskClass: "write_local", sideEffect: "writes content/balance.json with backup and rollback" },
  add_wave_group: { riskClass: "write_local", sideEffect: "writes content/balance.json with backup and rollback" },
  bind_sprite: { riskClass: "write_local", sideEffect: "writes content/visuals.json with backup and rollback" },
  upsert_entity: { riskClass: "write_local", sideEffect: "writes content/balance.json with backup and rollback" },
  delete_entity: { riskClass: "write_local", sideEffect: "writes content/balance.json with backup and rollback; refuses if referenced" },
  write_map: { riskClass: "write_local", sideEffect: "writes maps/src/<mapId>.tmj and maps/compiled/maps.json" }
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
    return {
      attackKinds: engine.ATTACK_KIND_SCHEMA,
      abilityPresets: engine.ABILITY_SCHEMA,
      abilityEffects: engine.ABILITY_EFFECT_SCHEMA,
      abilityNote:
        "Mission ability ids are open (any string). abilityPresets (path_water/strike/freeze) work with no extra fields. A CUSTOM ability id needs no engine code — declare `effects: AbilityEffect[]` composed from abilityEffects (e.g. [{kind:'damage', amount}, {kind:'status', status:{slow:{factor,duration}}}]).",
      currencyRules: engine.CURRENCY_RULES
    };
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
        appliedMigrations: summary.appliedMigrations,
        counts: {
          missions: Object.keys(summary.missions ?? {}).length,
          enemies: Object.keys(summary.enemies ?? {}).length,
          towers: Object.keys(summary.towers ?? {}).length,
          waveSets: Object.keys(summary.waveSets ?? {}).length,
          maps: Object.keys(summary.maps ?? {}).length,
          mapSources: Object.keys(summary.mapSources ?? {}).length
        },
        availableMaps: summary.availableMaps,
        mapRoutes: summary.mapRoutes,
        // Content-hash revisions for optimistic-concurrency writes (upsert_entity, apply_validated_patch,
        // bind_sprite, ...): pass the relevant one back as `ifRevision` to reject a write if the file
        // changed underneath the agent (e.g. a human editing the same project live in Studio).
        revisions: { balance: computeRevision(files.balance), visuals: computeRevision(files.visuals) }
      };
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
        revisions: { balance: computeRevision(files.balance), visuals: computeRevision(files.visuals) }
      };
    }

    case "simulate_mission": {
      // Clamp like the balance sweep does: the smoke loop is fully synchronous, so an unbounded
      // duration (e.g. an agent passing milliseconds) would block the whole single-process MCP
      // server for hours. 3600 time units is far beyond any real mission.
      const duration = Number.isFinite(args.duration) && args.duration > 0 ? Math.min(args.duration, 3600) : 180;
      return runMissionSmoke(projectDir, args.missionId, duration);
    }

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

    case "package_desktop":
      return packageProject(projectDir, { kind: "desktop", targetId: typeof args.targetId === "string" ? args.targetId : null });

    case "apply_balance_patch":
      return applyValidatedBalancePatch(projectDir, args.patch, { compatibilityToolName: "apply_balance_patch", ifRevision: args.ifRevision });

    case "dry_run_balance_patch":
      return toWire(await dryRunBalancePatch(projectDir, args.patch));

    case "apply_validated_patch":
      return applyValidatedBalancePatch(projectDir, args.patch, { ifRevision: args.ifRevision });

    case "set_enemy_stat":
      return setEnemyStat(projectDir, args);

    case "upsert_tower":
      return upsertTower(projectDir, args);

    case "add_wave_group":
      return addWaveGroup(projectDir, args);

    case "bind_sprite":
      return bindSprite(projectDir, args);

    case "upsert_entity":
      return upsertEntity(projectDir, args);

    case "delete_entity":
      return deleteEntity(projectDir, args);

    case "write_map":
      return writeMap(projectDir, args);

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

// Prototype-safe ENTITY_COLLECTIONS lookup: a bare bracket read would resolve inherited
// Object.prototype members (collection: "constructor" → the inherited Function), skating past the
// `!spec` check into a confusing downstream error — the same gap the EXPLAIN_CURATED lookup closed.
function entityCollectionSpec(collection) {
  return Object.prototype.hasOwnProperty.call(ENTITY_COLLECTIONS, collection) ? ENTITY_COLLECTIONS[collection] : undefined;
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

async function validateCandidateFiles(files) {
  const engine = await loadEngine();
  const content = engine.createGameContentRegistry({
    balance: files.balance,
    maps: files.maps,
    worldMap: files.worldMap,
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
