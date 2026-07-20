const RECIPES = Object.freeze({
  enemies: [
    recipe("grunt", "Grunt", "Baseline ground unit for early waves.", {
      label: "Grunt", maxHp: 12, speed: 1, coreDamage: 1, reward: { coins: 3 }, coinReward: 3, color: 0x79b86a, hitRadius: 0.5
    }),
    recipe("runner", "Runner", "Fast, fragile pressure unit that ignores water slow.", {
      label: "Runner", maxHp: 7, speed: 2.4, coreDamage: 1, reward: { coins: 3 }, coinReward: 3, color: 0xe4c85b, hitRadius: 0.4, ignoresWaterSlow: true
    }),
    recipe("tank", "Tank", "Slow armored body with high core damage.", {
      label: "Tank", maxHp: 70, speed: 0.45, coreDamage: 3, reward: { coins: 12 }, coinReward: 12, color: 0x8d759f, hitRadius: 0.85, pathCollisionRadius: 0.9, armor: { kind: "pierce_only" }
    }),
    recipe("flying", "Flying", "Direct-path air target for anti-air checks.", {
      label: "Flying", maxHp: 20, speed: 1.4, coreDamage: 2, reward: { coins: 6 }, coinReward: 6, color: 0x67b6d6, hitRadius: 0.5, movementKind: "direct_flying", targetClass: "flying"
    }),
    recipe("healer", "Healer", "Support unit that restores nearby enemies.", {
      label: "Healer", maxHp: 24, speed: 0.8, coreDamage: 1, reward: { coins: 8 }, coinReward: 8, color: 0x74cfa3, hitRadius: 0.55, healAura: { radius: 2, healPerUnit: 0.35, includeSelf: false, stacks: false }
    }),
    recipe("boss", "Boss", "Durable encounter unit that disrupts and attacks towers.", {
      label: "Boss", maxHp: 450, speed: 0.32, coreDamage: 10, reward: { coins: 60 }, coinReward: 60, color: 0xd65d67, hitRadius: 1, pathCollisionRadius: 1, towerDisrupt: { interval: 8, radius: 3, duration: 3 }, towerAttack: { interval: 5, damage: 15, range: 2.5 }
    })
  ],
  towers: [
    recipe("pipeline_chain", "Pipeline Chain", "Preferred composable tower: deterministic targeting, chained delivery, ordered damage and slow effects.", {
      label: "Pipeline Chain Tower", cost: { coins: 85 }, footprintRadius: 1, range: 5,
      attack: {
        kind: "pipeline",
        interval: 1.5,
        targeting: { classes: ["ground", "flying"], mode: "first", maxTargets: 1 },
        delivery: { kind: "chain", maxJumps: 3, jumpRadius: 2.5, damageFalloff: 0.8 },
        effects: [
          { kind: "damage", amount: 7, damageType: "arc" },
          { kind: "status", status: { slow: { factor: 0.8, duration: 1.5 }, slowAffectsClasses: ["ground", "flying"] } }
        ],
        upgradeCosts: [{ coins: 65 }, { coins: 95 }]
      }
    }),
    recipe("single", "Single Target", "Reliable general-purpose tower with stack upgrades.", {
      label: "Single Target Tower", cost: { coins: 45 }, footprintRadius: 1, range: 5,
      attack: { kind: "single", fireRate: 1.4, damagePerStack: 1, startingStacks: 3, maxStacks: 8, upgradeCost: 35 }
    }),
    recipe("pulse", "Pulse", "Aura damage with a lingering damage-over-time effect.", {
      label: "Pulse Tower", cost: { coins: 70 }, footprintRadius: 1, range: 3.5,
      attack: { kind: "pulse", pulseRate: 1, pulseDamage: 1.2, dotDamagePerUnit: 0.15, dotDuration: 5, pulseRateByLevel: [1, 1.25, 1.5], upgradeCosts: [{ coins: 55 }, { coins: 80 }] }
    }),
    recipe("sniper", "Sniper", "Long-range burst damage that prioritizes large targets.", {
      label: "Sniper Tower", cost: { coins: 90 }, footprintRadius: 1, range: 7,
      attack: { kind: "sniper", interval: 2.5, damage: 18, targetPriority: "largest_hp", rangeByLevel: [7, 8, 9], upgradeCosts: [{ coins: 70 }, { coins: 100 }] }
    }),
    recipe("antiair", "Anti-Air", "Dedicated defense against flying enemies.", {
      label: "Anti-Air Tower", cost: { coins: 60 }, footprintRadius: 1, range: 6,
      attack: { kind: "antiair", fireRate: 1.6, damage: 4, maxTargetsByLevel: [1, 2, 3], upgradeCosts: [{ coins: 50 }, { coins: 75 }] }
    }),
    recipe("splash", "Splash Control", "Area damage with slow for dense ground waves.", {
      label: "Splash Tower", cost: { coins: 80 }, footprintRadius: 1, range: 4,
      attack: { kind: "splash", interval: 2, damage: 6, splashDamage: 3, armoredChipDamage: 1, splashRadius: 1.2, slowFactor: 0.65, slowDuration: 2.5, intervalByLevel: [2, 1.7, 1.4], upgradeCosts: [{ coins: 60 }, { coins: 90 }] }
    }),
    recipe("support_buff", "Support Buff", "Aura that accelerates the project's damaging towers.", {
      label: "Support Tower", cost: { coins: 75 }, footprintRadius: 1, range: 3,
      attack: { kind: "support_buff", auraRadius: 3, fireRateMultiplierByLevel: [1.2, 1.3, 1.4], affectsTowerIds: [], upgradeCosts: [{ coins: 55 }, { coins: 80 }] }
    })
  ],
  missions: [
    recipe("classic", "Classic Defense", "Clear every wave with the standard economy.", {
      label: "Classic Defense", description: "Defend the core and clear every wave.", availability: "playable", startingCoreHp: 20, startingResources: { coins: 120 }, prepTimeUnits: 30, buildTowerIds: [], abilityIds: []
    }),
    recipe("survival", "Timed Survival", "Stay alive for a fixed duration, even after waves clear.", {
      label: "Timed Survival", description: "Survive until the timer expires.", availability: "playable", startingCoreHp: 20, startingResources: { coins: 120 }, prepTimeUnits: 20, buildTowerIds: [], abilityIds: [],
      objectives: { victory: [{ id: "survive", label: "Survive", kind: "surviveSeconds", seconds: 180 }], failure: [{ id: "leak_limit", label: "Leak limit", kind: "maxLeaks", maxLeaks: 12 }] }
    }),
    recipe("economy", "Economy Challenge", "Clear waves while growing the coin reserve.", {
      label: "Economy Challenge", description: "Clear the assault and finish with a strong reserve.", availability: "playable", startingCoreHp: 20, startingResources: { coins: 90 }, prepTimeUnits: 25, buildTowerIds: [], abilityIds: [],
      economy: { perWaveClear: { coins: 12 }, interestRate: 0.05, interestCap: { coins: 20 }, sellRefundRatio: 0.65 },
      objectives: { victory: [{ id: "clear_waves", label: "Clear all waves", kind: "clearWaves" }, { id: "reserve", label: "Build a reserve", kind: "accumulateResource", resourceId: "coins", amount: 180 }] }
    }),
    recipe("perfect_defense", "Perfect Defense", "No-leak challenge with an explicit perfect star.", {
      label: "Perfect Defense", description: "Clear every wave without a single leak.", availability: "playable", startingCoreHp: 20, startingResources: { coins: 140 }, prepTimeUnits: 30, buildTowerIds: [], abilityIds: [],
      objectives: { victory: [{ id: "clear_waves", label: "Clear all waves", kind: "clearWaves" }], failure: [{ id: "no_leaks", label: "No leaks", kind: "maxLeaks", maxLeaks: 0 }], stars: [{ id: "perfect", label: "Perfect defense", kind: "maxLeaks", maxLeaks: 0 }] }
    })
  ]
});

function recipe(id, label, description, entity) {
  return { id, label, description, suggestedId: id, entity };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export const CONTENT_RECIPE_COLLECTIONS = Object.freeze(Object.keys(RECIPES));

export function listContentRecipes(collection) {
  assertCollection(collection);
  return RECIPES[collection].map(({ entity, ...metadata }) => ({ ...metadata, attackKind: entity.attack?.kind ?? null }));
}

export function materializeContentRecipe(collection, recipeId, context = {}) {
  assertCollection(collection);
  const source = RECIPES[collection].find((item) => item.id === recipeId);
  if (!source) throw new Error(`Unknown ${collection} recipe "${recipeId}".`);
  const result = clone(source);
  result.entity.id = result.suggestedId;

  if (collection === "towers" && result.entity.attack?.kind === "support_buff") {
    result.entity.attack.affectsTowerIds = [...(context.towerIds ?? [])];
  }
  if (collection === "missions") {
    result.entity.mapId = context.mapIds?.[0] ?? "";
    result.entity.waveSetId = context.waveSetIds?.[0] ?? "";
    result.entity.buildTowerIds = [...(context.towerIds ?? [])];
    result.entity.abilityIds = [...(context.abilityIds ?? [])];
  }
  return result;
}

export function contentRecipeContext(files) {
  return {
    mapIds: Object.keys(files.maps ?? {}),
    waveSetIds: Object.keys(files.balance?.waveSets ?? files.waveSets ?? {}),
    towerIds: Object.keys(files.balance?.towers ?? files.towers ?? {}),
    abilityIds: Object.keys(files.balance?.abilities ?? files.abilities ?? {})
  };
}

function assertCollection(collection) {
  if (!CONTENT_RECIPE_COLLECTIONS.includes(collection)) {
    throw new Error(`Unknown recipe collection "${collection}". Expected one of ${CONTENT_RECIPE_COLLECTIONS.join(", ")}.`);
  }
}
