// templates.mjs — starter-project variants for `towerforge create --template <name>`.
// Each template returns { balance, maps, mapSources, worldMap } over the shared scaffolding in
// create.mjs. They are intentionally small but distinct and winnable (verified via the balance sweep).

export const TEMPLATE_NAMES = ["classic", "maze", "idle", "roguelike"];

export function getTemplate(name) {
  const factory = TEMPLATES[name] ?? TEMPLATES.classic;
  return factory();
}

// ── Map helpers ───────────────────────────────────────────────────────────────
/** Build a compiled map + its .tmj-style source from an explicit hex path (buildable elsewhere). */
function mapFromPath(id, label, width, height, path) {
  const spawnCoord = path[0];
  const coreCoord = path[path.length - 1];
  const pathRoutes = [{ id: "main", pathCenterline: path }];
  // defaultTerrain MUST be on the compiled map too — builds embed the compiled map directly (they
  // don't recompile from source), so without it non-path tiles would have no buildable terrain.
  const map = { id, label, width, height, defaultTerrain: "buildable", spawnCoord, coreCoord, pathCenterline: path, pathRoutes, terrainOverrides: [] };
  const source = {
    id, type: "map", orientation: "hexagonal", width, height,
    properties: [
      { name: "id", type: "string", value: id },
      { name: "defaultTerrain", type: "string", value: "buildable" },
      { name: "spawnCoord", type: "string", value: JSON.stringify(spawnCoord) },
      { name: "coreCoord", type: "string", value: JSON.stringify(coreCoord) },
      { name: "pathCenterline", type: "string", value: JSON.stringify(path) }
    ],
    pathRoutes, terrainOverrides: []
  };
  return { map, source };
}

/** A straight horizontal lane at row r. */
function straightPath(width, r) {
  return Array.from({ length: width }, (_, q) => ({ q, r }));
}

/** A serpentine S-path that snakes down the board (vertical legs joined by full-width rows). */
function serpentinePath(width, height) {
  const path = [];
  for (let r = 0; r < height; r += 2) {
    const leftToRight = (r / 2) % 2 === 0;
    const cols = leftToRight ? range(0, width - 1) : range(width - 1, 0);
    for (const q of cols) path.push({ q, r });
    if (r + 1 < height) path.push({ q: leftToRight ? width - 1 : 0, r: r + 1 }); // step down on the wall
  }
  return path;
}
function range(a, b) {
  const out = [];
  if (a <= b) for (let i = a; i <= b; i++) out.push(i);
  else for (let i = a; i >= b; i--) out.push(i);
  return out;
}

function worldMap(missionNodes, regionLabel, accent, biome) {
  return {
    width: 800, height: 600,
    regions: [{ id: "region_1", label: regionLabel, description: "", bounds: { x: 0, y: 0, width: 800, height: 600 }, accent, biome, connections: [] }],
    missionNodes
  };
}

/** Difficulty knob applied to a finished template: scales enemy HP, wave counts, and starting budget.
 *  Tuned per template (via the balance sweep) to land winnable-but-not-trivial. */
function applyDifficulty(balance, { hp = 1, count = 1, budget = 1 } = {}) {
  for (const e of Object.values(balance.enemies)) e.maxHp = Math.round(e.maxHp * hp);
  for (const set of Object.values(balance.waveSets)) for (const w of set) for (const g of w.groups) g.count = Math.max(1, Math.round(g.count * count));
  const scaleBag = (bag) => { if (bag) for (const k of Object.keys(bag)) bag[k] = Math.max(0, Math.round(bag[k] * budget)); };
  scaleBag(balance.constants.startingResources);
  scaleBag(balance.constants.moveTowerCost);
  for (const m of Object.values(balance.missions)) scaleBag(m.startingResources);
  if (typeof balance.constants.startingCoins === "number") balance.constants.startingCoins = balance.constants.startingResources?.coins ?? balance.constants.startingCoins;
  return balance;
}

function constants(extra = {}) {
  return {
    timeUnitSeconds: 0.1, startingCoreHp: 20, startingCoins: 150,
    startingResources: { coins: 150 }, prepTimeUnits: 100, moveTowerCost: { coins: 25 },
    waterGroundSpeedFactor: 0.6, pathWaterCooldownUnits: 300, pathWaterDurationUnits: 100,
    pathWaterRadius: 2, pathWaterGroundSpeedFactor: 0.5, ...extra
  };
}

// Reusable enemy/tower builders keep the templates terse and balanced.
function enemy(id, label, maxHp, speed, coins, color, extra = {}) {
  return { id, label, maxHp, speed, reward: { coins, ...(extra.reward ?? {}) }, coinReward: coins, coreDamage: extra.coreDamage ?? 1, color, hitRadius: 0.5, ...stripReward(extra) };
}
function stripReward(extra) { const { reward, coreDamage, ...rest } = extra; return rest; }

function singleTower(id, label, cost, dmg, fireRate = 1, range = 3) {
  return { id, label, footprintRadius: 0, range, cost, attack: { kind: "single", fireRate, damagePerStack: dmg, startingStacks: 1, maxStacks: 5, upgradeCost: typeof cost.coins === "number" ? cost.coins : 50 } };
}
function sniperTower(id, label, cost, dmg, interval = 1.6, range = 6) {
  return { id, label, footprintRadius: 0, range, cost, attack: { kind: "sniper", interval, damage: dmg, targetPriority: "largest_hp", rangeByLevel: [range, range + 1, range + 2], upgradeCosts: [{ coins: cost.coins }, { coins: cost.coins }] } };
}
function splashTower(id, label, cost, dmg, interval = 1.4, range = 3) {
  return { id, label, footprintRadius: 0, range, cost, attack: { kind: "splash", interval, damage: dmg, splashDamage: Math.max(1, Math.round(dmg * 0.5)), armoredChipDamage: 1, splashRadius: 1, slowFactor: 0.6, slowDuration: 2, intervalByLevel: [interval, interval * 0.85, interval * 0.7], upgradeCosts: [{ coins: cost.coins }, { coins: cost.coins }] } };
}
function mission(id, label, description, mapId, waveSetId, buildTowerIds, extra = {}) {
  return { id, label, description, availability: extra.availability ?? "playable", countsTowardProgress: true, startingCoreHp: extra.startingCoreHp ?? 20, startingResources: extra.startingResources ?? { coins: 150 }, prepTimeUnits: 100, mapId, waveSetId, buildTowerIds, abilityIds: [] };
}

// ── Templates ─────────────────────────────────────────────────────────────────
const TEMPLATES = {
  classic() {
    const { map, source } = mapFromPath("lane", "Forest Lane", 11, 5, straightPath(11, 2));
    const balance = {
      schemaVersion: 1, defaultMissionId: "mission_1",
      currencies: [{ id: "coins", label: "Coins", color: 0xf5c542 }],
      constants: constants(),
      abilities: {},
      enemies: {
        grunt: enemy("grunt", "Grunt", 70, 1.4, 6, 0x8db070),
        runner: enemy("runner", "Runner", 45, 2.6, 5, 0xe0b050),
        brute: enemy("brute", "Brute", 220, 0.9, 14, 0xc06050, { coreDamage: 2 })
      },
      towers: {
        arrow: singleTower("arrow", "Arrow Tower", { coins: 45 }, 14, 1.3, 3),
        cannon: sniperTower("cannon", "Cannon", { coins: 80 }, 60, 1.7, 6),
        mortar: splashTower("mortar", "Mortar", { coins: 70 }, 26, 1.4, 3)
      },
      waveSets: {
        waves: [
          { id: "w1", groups: [{ enemyId: "grunt", count: 6, spawnInterval: 9, startDelay: 0 }] },
          { id: "w2", groups: [{ enemyId: "runner", count: 8, spawnInterval: 6, startDelay: 0 }, { enemyId: "grunt", count: 4, spawnInterval: 9, startDelay: 30 }] },
          { id: "w3", groups: [{ enemyId: "grunt", count: 10, spawnInterval: 6, startDelay: 0 }] },
          { id: "w4", groups: [{ enemyId: "brute", count: 3, spawnInterval: 24, startDelay: 0 }, { enemyId: "runner", count: 10, spawnInterval: 5, startDelay: 20 }] }
        ]
      },
      missions: { mission_1: mission("mission_1", "Forest Lane", "Classic single-lane tower defense. Stop the advance before the core falls.", "lane", "waves", ["arrow", "cannon", "mortar"]) }
    };
    applyDifficulty(balance, { hp: 1.8, count: 1.4, budget: 0.7 });
    return finalize(balance, { lane: map }, { lane: source }, worldMap(
      [{ missionId: "mission_1", regionId: "region_1", x: 400, y: 300, difficulty: 1, unlockRequiresMissionIds: [] }],
      "Forest", "#4a7c59", "forest"
    ));
  },

  maze() {
    const path = serpentinePath(9, 7);
    const { map, source } = mapFromPath("maze", "Maze Run", 9, 7, path);
    const balance = {
      schemaVersion: 1, defaultMissionId: "mission_1",
      currencies: [{ id: "coins", label: "Coins", color: 0xf5c542 }],
      constants: constants({ startingCoins: 200, startingResources: { coins: 200 } }),
      abilities: {},
      enemies: {
        skitter: enemy("skitter", "Skitter", 55, 1.8, 5, 0x70b0c0),
        swarm: enemy("swarm", "Swarmling", 30, 2.4, 3, 0xb0d050),
        tank: enemy("tank", "Tank", 320, 0.8, 18, 0x9060c0, { coreDamage: 2 })
      },
      towers: {
        spike: singleTower("spike", "Spike", { coins: 40 }, 12, 1.5, 2),
        bolt: sniperTower("bolt", "Bolt", { coins: 85 }, 55, 1.5, 5),
        blast: splashTower("blast", "Blast", { coins: 75 }, 18, 1.3, 2)
      },
      waveSets: {
        waves: [
          { id: "w1", groups: [{ enemyId: "skitter", count: 8, spawnInterval: 7, startDelay: 0 }] },
          { id: "w2", groups: [{ enemyId: "swarm", count: 14, spawnInterval: 4, startDelay: 0 }] },
          { id: "w3", groups: [{ enemyId: "skitter", count: 8, spawnInterval: 6, startDelay: 0 }, { enemyId: "swarm", count: 8, spawnInterval: 4, startDelay: 24 }] },
          { id: "w4", groups: [{ enemyId: "tank", count: 4, spawnInterval: 20, startDelay: 0 }, { enemyId: "swarm", count: 12, spawnInterval: 4, startDelay: 16 }] }
        ]
      },
      missions: { mission_1: mission("mission_1", "Maze Run", "The path snakes across the field — cover the corners. Long sight-lines win.", "maze", "waves", ["spike", "bolt", "blast"], { startingResources: { coins: 200 } }) }
    };
    applyDifficulty(balance, { hp: 2.2, count: 1.5, budget: 0.62 });
    return finalize(balance, { maze: map }, { maze: source }, worldMap(
      [{ missionId: "mission_1", regionId: "region_1", x: 400, y: 300, difficulty: 2, unlockRequiresMissionIds: [] }],
      "Caverns", "#5a6b8c", "cave"
    ));
  },

  idle() {
    const { map, source } = mapFromPath("loop", "Idle Loop", 9, 5, straightPath(9, 2));
    const balance = {
      schemaVersion: 1, defaultMissionId: "mission_1",
      currencies: [
        { id: "coins", label: "Coins", color: 0xf5c542 },
        { id: "cores", label: "Cores", color: 0x6fb6ff }
      ],
      constants: constants({ startingCoins: 400, startingResources: { coins: 400, cores: 2 }, prepTimeUnits: 60 }),
      abilities: {},
      enemies: {
        mote: enemy("mote", "Mote", 40, 1.8, 8, 0x9bd0a0),
        sprite: enemy("sprite", "Sprite", 60, 2.0, 10, 0xe0c060, { reward: { cores: 1 } }),
        golem: enemy("golem", "Golem", 260, 1.0, 30, 0x8a8a9a, { coreDamage: 2, reward: { cores: 2 } })
      },
      towers: {
        popper: singleTower("popper", "Popper", { coins: 30 }, 10, 1.6, 3),
        booster: { id: "booster", label: "Booster", footprintRadius: 0, range: 3, cost: { coins: 120, cores: 1 }, attack: { kind: "support_buff", auraRadius: 3, fireRateMultiplierByLevel: [1.4, 1.6, 1.8], upgradeCosts: [{ cores: 1 }, { cores: 2 }], affectsTowerIds: ["popper", "ranger"] } },
        ranger: sniperTower("ranger", "Ranger", { coins: 150, cores: 1 }, 50, 1.4, 6)
      },
      waveSets: {
        waves: [
          { id: "w1", groups: [{ enemyId: "mote", count: 12, spawnInterval: 4, startDelay: 0 }] },
          { id: "w2", groups: [{ enemyId: "mote", count: 14, spawnInterval: 3, startDelay: 0 }, { enemyId: "sprite", count: 4, spawnInterval: 8, startDelay: 10 }] },
          { id: "w3", groups: [{ enemyId: "sprite", count: 10, spawnInterval: 5, startDelay: 0 }] },
          { id: "w4", groups: [{ enemyId: "golem", count: 3, spawnInterval: 18, startDelay: 0 }, { enemyId: "mote", count: 16, spawnInterval: 3, startDelay: 12 }] }
        ]
      },
      missions: { mission_1: mission("mission_1", "Idle Loop", "Economy-first: enemies pay Coins and rare Cores. Spend Cores on Boosters and Rangers.", "loop", "waves", ["popper", "booster", "ranger"], { startingResources: { coins: 400, cores: 2 } }) }
    };
    applyDifficulty(balance, { hp: 1.8, count: 1.4, budget: 0.72 });
    return finalize(balance, { loop: map }, { loop: source }, worldMap(
      [{ missionId: "mission_1", regionId: "region_1", x: 400, y: 300, difficulty: 1, unlockRequiresMissionIds: [] }],
      "Workshop", "#7a6a4a", "industrial"
    ));
  },

  roguelike() {
    const { map, source } = mapFromPath("arena", "Arena", 9, 5, straightPath(9, 2));
    const towers = {
      dagger: singleTower("dagger", "Dagger", { coins: 40 }, 13, 1.4, 3),
      arbalest: sniperTower("arbalest", "Arbalest", { coins: 85 }, 58, 1.5, 6),
      bomb: splashTower("bomb", "Bombard", { coins: 75 }, 17, 1.4, 3)
    };
    const enemies = {
      imp: enemy("imp", "Imp", 60, 1.6, 6, 0xc06888),
      shade: enemy("shade", "Shade", 40, 2.6, 5, 0x6a6a9a),
      ogre: enemy("ogre", "Ogre", 260, 1.0, 16, 0x808048, { coreDamage: 2 }),
      lich: enemy("lich", "Lich", 520, 0.85, 40, 0x5aa0a0, { coreDamage: 3 })
    };
    const balance = {
      schemaVersion: 1, defaultMissionId: "run_1",
      currencies: [{ id: "coins", label: "Coins", color: 0xf5c542 }],
      constants: constants(),
      abilities: {},
      enemies, towers,
      waveSets: {
        run1: [
          { id: "r1w1", groups: [{ enemyId: "imp", count: 6, spawnInterval: 8, startDelay: 0 }] },
          { id: "r1w2", groups: [{ enemyId: "shade", count: 8, spawnInterval: 5, startDelay: 0 }, { enemyId: "imp", count: 4, spawnInterval: 8, startDelay: 24 }] }
        ],
        run2: [
          { id: "r2w1", groups: [{ enemyId: "imp", count: 10, spawnInterval: 6, startDelay: 0 }] },
          { id: "r2w2", groups: [{ enemyId: "ogre", count: 3, spawnInterval: 20, startDelay: 0 }, { enemyId: "shade", count: 10, spawnInterval: 4, startDelay: 16 }] }
        ],
        run3: [
          { id: "r3w1", groups: [{ enemyId: "shade", count: 14, spawnInterval: 4, startDelay: 0 }, { enemyId: "ogre", count: 3, spawnInterval: 18, startDelay: 10 }] },
          { id: "r3w2", groups: [{ enemyId: "lich", count: 2, spawnInterval: 30, startDelay: 0 }, { enemyId: "ogre", count: 4, spawnInterval: 16, startDelay: 14 }] }
        ]
      },
      missions: {
        run_1: mission("run_1", "Run 1 — Descent", "First floor of the run. Build a foundation.", "arena", "run1", ["dagger", "arbalest", "bomb"], { startingResources: { coins: 160 } }),
        run_2: mission("run_2", "Run 2 — Deeper", "Tougher floor. Ogres arrive.", "arena", "run2", ["dagger", "arbalest", "bomb"], { startingResources: { coins: 180 } }),
        run_3: mission("run_3", "Run 3 — The Lich", "Final floor. Survive the boss.", "arena", "run3", ["dagger", "arbalest", "bomb"], { startingResources: { coins: 220 } })
      }
    };
    applyDifficulty(balance, { hp: 1.7, count: 1.35, budget: 0.72 });
    return finalize(balance, { arena: map }, { arena: source }, worldMap(
      [
        { missionId: "run_1", regionId: "region_1", x: 220, y: 300, difficulty: 1, unlockRequiresMissionIds: [] },
        { missionId: "run_2", regionId: "region_1", x: 400, y: 300, difficulty: 2, unlockRequiresMissionIds: ["run_1"] },
        { missionId: "run_3", regionId: "region_1", x: 580, y: 300, difficulty: 3, unlockRequiresMissionIds: ["run_2"] }
      ],
      "Dungeon", "#6a4a6a", "dungeon"
    ));
  }
};

function finalize(balance, maps, mapSources, world) {
  balance.defaultDifficultyId ??= "normal";
  balance.difficulties ??= [
    { id: "story", label: "Story", description: "More room to learn and experiment.", enemyHpMultiplier: 0.8, enemySpeedMultiplier: 0.9, enemyRewardMultiplier: 1.15, coreDamageMultiplier: 0.75, startingResourceMultiplier: 1.2, coreHpMultiplier: 1.2 },
    { id: "normal", label: "Normal", description: "The authored baseline." },
    { id: "veteran", label: "Veteran", description: "Tighter economy and faster, tougher enemies.", enemyHpMultiplier: 1.25, enemySpeedMultiplier: 1.1, enemyRewardMultiplier: 0.9, coreDamageMultiplier: 1.25, startingResourceMultiplier: 0.85, coreHpMultiplier: 0.9 }
  ];
  balance.metaProgression ??= {
    currencies: [{ id: "forge_shards", label: "Forge Shards", color: 0x7eb8d8 }],
    upgrades: {
      sharpened_tools: {
        id: "sharpened_tools", label: "Sharpened Tools", description: "All towers deal 8% more damage per level.", maxLevel: 3,
        costs: [{ forge_shards: 2 }, { forge_shards: 4 }, { forge_shards: 7 }],
        effects: [{ kind: "towerDamage", multiplierPerLevel: 0.08 }]
      },
      clockwork_drills: {
        id: "clockwork_drills", label: "Clockwork Drills", description: "All towers fire 6% faster per level.", maxLevel: 3,
        costs: [{ forge_shards: 2 }, { forge_shards: 4 }, { forge_shards: 7 }],
        effects: [{ kind: "towerFireRate", multiplierPerLevel: 0.06 }]
      },
      reinforced_core: {
        id: "reinforced_core", label: "Reinforced Core", description: "Begin each mission with 2 additional core HP per level.", maxLevel: 3,
        costs: [{ forge_shards: 1 }, { forge_shards: 3 }, { forge_shards: 5 }],
        effects: [{ kind: "coreHp", amountPerLevel: 2 }]
      }
    },
    rewardsByMission: Object.fromEntries(Object.keys(balance.missions).map((missionId) => [missionId, {
      firstClear: { forge_shards: 2 }, repeatClear: { forge_shards: 1 }, perStar: { forge_shards: 1 }
    }]))
  };
  return { balance, maps, mapSources, worldMap: world };
}
