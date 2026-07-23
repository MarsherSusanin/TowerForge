// references.mjs — cross-reference scanning shared by delete_entity (MCP) and any future
// reference-aware delete flow. Rules are intentionally kept consistent with Studio's client-side
// findReferences() (packages/studio/public/app.js) for enemy/tower/mission, and extended here to
// cover waveSet/ability/currency so delete_entity can safely refuse a referenced deletion across
// every collection it supports. Operates on the `files` shape loadProjectFiles() returns.

const ENTITY_KINDS = ["enemy", "tower", "mission", "waveSet", "ability", "currency"];

/**
 * Find human-readable references to `id` of the given `kind` elsewhere in the project.
 * @param {object} files - the shape returned by loadProjectFiles(): { balance, worldMap, ... }
 * @param {string} kind - one of "enemy" | "tower" | "mission" | "waveSet" | "ability" | "currency"
 * @param {string} id
 * @returns {string[]} human-readable reference descriptions (deduped, capped at 12)
 */
export function findEntityReferences(files, kind, id) {
  if (!ENTITY_KINDS.includes(kind)) {
    throw new Error(`findEntityReferences: unknown kind "${kind}". Expected one of ${ENTITY_KINDS.join(", ")}.`);
  }
  const balance = files?.balance ?? {};
  const worldMap = files?.worldMap ?? {};
  const refs = [];

  if (kind === "enemy") {
    for (const [wsId, waves] of Object.entries(balance.waveSets ?? {})) {
      for (const wave of waves ?? []) {
        for (const group of wave.groups ?? []) {
          if (group.enemyId === id) refs.push(`wave "${wave.label ?? wave.id}" (set ${wsId})`);
        }
      }
    }
    for (const [enemyId, enemy] of Object.entries(balance.enemies ?? {})) {
      if (enemyId === id) continue;
      if (enemy.spawnOnDeath?.enemyId === id) refs.push(`enemy "${enemyId}" (spawn-on-death)`);
      for (const phase of enemy.phaseSpawns ?? []) {
        if (phase.enemyId === id) refs.push(`enemy "${enemyId}" (phase-spawn)`);
      }
    }
  } else if (kind === "tower") {
    for (const [missionId, mission] of Object.entries(balance.missions ?? {})) {
      if ((mission.buildTowerIds ?? []).includes(id)) refs.push(`mission "${mission.label ?? missionId}"`);
    }
    for (const [towerId, tower] of Object.entries(balance.towers ?? {})) {
      if (towerId === id) continue;
      const attack = tower.attack ?? {};
      if (tower.requiresAuraFrom === id) refs.push(`tower "${towerId}" (requires aura)`);
      if ((attack.unlocksTowerIds ?? []).includes(id)) refs.push(`tower "${towerId}" (unlocks)`);
      if ((attack.affectsTowerIds ?? []).includes(id)) refs.push(`tower "${towerId}" (buffs)`);
    }
  } else if (kind === "mission") {
    if (balance.defaultMissionId === id) refs.push("the default mission");
    for (const node of worldMap.missionNodes ?? []) {
      if (node.missionId === id) refs.push("a world-map node");
      if ((node.unlockRequiresMissionIds ?? []).includes(id)) refs.push(`unlock requirement of "${node.missionId}"`);
    }
  } else if (kind === "waveSet") {
    for (const [missionId, mission] of Object.entries(balance.missions ?? {})) {
      if (mission.waveSetId === id) refs.push(`mission "${mission.label ?? missionId}"`);
    }
  } else if (kind === "ability") {
    for (const [missionId, mission] of Object.entries(balance.missions ?? {})) {
      if ((mission.abilityIds ?? []).includes(id)) refs.push(`mission "${mission.label ?? missionId}"`);
    }
  } else if (kind === "currency") {
    const scanBag = (bag, label) => {
      if (bag && typeof bag === "object" && Object.prototype.hasOwnProperty.call(bag, id)) refs.push(label);
    };
    scanBag(balance.constants?.startingResources, "constants.startingResources");
    scanBag(balance.constants?.moveTowerCost, "constants.moveTowerCost");
    for (const [towerId, tower] of Object.entries(balance.towers ?? {})) {
      scanBag(tower.cost, `tower "${towerId}" cost`);
      if (Array.isArray(tower.attack?.upgradeCosts)) {
        tower.attack.upgradeCosts.forEach((cost, i) => scanBag(cost, `tower "${towerId}" upgradeCosts[${i}]`));
      }
    }
    for (const [enemyId, enemy] of Object.entries(balance.enemies ?? {})) {
      scanBag(enemy.reward, `enemy "${enemyId}" reward`);
    }
    for (const [missionId, mission] of Object.entries(balance.missions ?? {})) {
      scanBag(mission.startingResources, `mission "${mission.label ?? missionId}" startingResources`);
    }
  }

  return [...new Set(refs)].slice(0, 12);
}

export { ENTITY_KINDS };
