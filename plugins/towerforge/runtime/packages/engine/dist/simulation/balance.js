import { createGridTopology } from "./topology.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
export function runBalanceSweep(content, options = {}) {
    // Clamp at the source so every call site (CLI/MCP/Studio) is bounded: a non-positive or absurd
    // value can otherwise hang the loop (tickStep <= 0) or run effectively forever (huge simSeconds).
    const simSeconds = options.simSeconds && options.simSeconds > 0 ? Math.min(options.simSeconds, 3600) : 600;
    // Cap at 0.2 — TowerDefenseGame.tick() clamps any delta above 0.2 (a real-time spiral-of-death
    // guard). A larger sweep step made the engine advance only 0.2 while the loop counted the full
    // step as elapsed, so the sim silently covered ~20% less game-time than requested and skewed
    // clear-time / winnability verdicts. Keeping step <= 0.2 makes tick() and `elapsed` agree.
    const tickStep = options.tickStep && options.tickStep > 0 ? Math.max(0.05, Math.min(options.tickStep, 0.2)) : 0.2;
    const missionIds = options.missionIds?.length ? options.missionIds : Object.keys(content.missions);
    const missions = [];
    for (const missionId of missionIds) {
        const mission = content.missions[missionId];
        if (!mission)
            continue;
        const available = (mission.buildTowerIds?.length ? mission.buildTowerIds : Object.keys(content.towers)).filter((id) => content.towers[id]);
        const strategies = buildStrategies(available, options.maxStrategies);
        const results = strategies.map((strategy) => runStrategy(content, missionId, strategy, simSeconds, tickStep));
        missions.push(aggregateMission(missionId, mission.label, results));
    }
    const winnable = missions.filter((m) => m.winRate > 0).length;
    const flagged = missions.filter((m) => m.flags.some((f) => f.severity !== "info")).length;
    return {
        missions,
        summary: { missions: missions.length, winnable, flagged },
        generatedWith: { strategiesPerMission: missions[0]?.strategyCount ?? 0, simSeconds, tickStep }
    };
}
function buildStrategies(available, max) {
    const strategies = [];
    for (const id of available) {
        strategies.push({
            id: `solo_${id}`,
            label: `Only ${id}`,
            towerIds: [id],
            upgrade: true,
            placement: "near_path",
            rebuildInterval: 2
        });
    }
    strategies.push({
        id: "all_flat",
        label: "All towers, no upgrades",
        towerIds: available,
        upgrade: false,
        placement: "near_path",
        rebuildInterval: 2
    });
    strategies.push({
        id: "all_upgrade",
        label: "All towers, upgraded",
        towerIds: available,
        upgrade: true,
        placement: "near_path",
        rebuildInterval: 2
    });
    strategies.push({
        id: "all_far_path",
        label: "All towers, far from path",
        towerIds: available,
        upgrade: true,
        placement: "far_path",
        rebuildInterval: 4
    });
    strategies.push({
        id: "all_core_guard",
        label: "All towers near core",
        towerIds: available,
        upgrade: true,
        placement: "near_core",
        rebuildInterval: 3
    });
    return typeof max === "number" ? strategies.slice(0, Math.max(1, max)) : strategies;
}
function runStrategy(content, missionId, strategy, simSeconds, tickStep) {
    const game = new TowerDefenseGame({ missionId, content });
    const towerCounts = {};
    placeTowers(game, strategy, towerCounts);
    if (strategy.upgrade)
        upgradeAll(game);
    game.startNextWave();
    let elapsed = 0;
    let leaks = 0;
    let nextBuildAt = 0;
    while (elapsed < simSeconds && game.getSnapshot().outcome === "playing") {
        game.tick(tickStep);
        for (const event of game.lastEvents)
            if (event.type === "enemyLeaked")
                leaks += 1;
        if (elapsed >= nextBuildAt) {
            placeTowers(game, strategy, towerCounts);
            if (strategy.upgrade)
                upgradeAll(game);
            nextBuildAt = elapsed + strategy.rebuildInterval;
        }
        elapsed += tickStep;
    }
    const snap = game.getSnapshot();
    return {
        strategyId: strategy.id,
        label: strategy.label,
        strategy: { ...strategy, towerIds: [...strategy.towerIds] },
        outcome: snap.outcome,
        win: snap.outcome === "victory",
        coreHpRemaining: snap.maxCoreHp > 0 ? Math.max(0, snap.coreHp) / snap.maxCoreHp : 0,
        towersBuilt: snap.towers.length,
        leaks,
        elapsed: Math.round(elapsed * 10) / 10,
        towerCounts
    };
}
function placeTowers(game, strategy, counts) {
    let placedAny = true;
    let guard = 0;
    while (placedAny && guard < 80) {
        guard += 1;
        placedAny = false;
        const snap = game.getSnapshot();
        if (snap.outcome !== "playing")
            return;
        const buildable = snap.tiles
            .filter((tile) => tile.terrain === "buildable" && !tile.occupiedBy)
            .sort((a, b) => comparePlacement(a, b, snap, strategy.placement));
        for (const towerId of strategy.towerIds) {
            if (!game.canPlaceTowerAnywhere(towerId).ok)
                continue;
            for (const tile of buildable) {
                if (game.placeTower(towerId, { q: tile.q, r: tile.r }).ok) {
                    counts[towerId] = (counts[towerId] ?? 0) + 1;
                    placedAny = true;
                    break;
                }
            }
        }
    }
}
function comparePlacement(a, b, snap, placement) {
    const distance = createGridTopology(snap.grid).distance;
    if (placement === "far_path")
        return distanceToPath(b, snap.pathCenterline, distance) - distanceToPath(a, snap.pathCenterline, distance);
    if (placement === "near_core")
        return distance(a, snap.coreCoord) - distance(b, snap.coreCoord);
    return distanceToPath(a, snap.pathCenterline, distance) - distanceToPath(b, snap.pathCenterline, distance);
}
function upgradeAll(game) {
    for (const tower of game.towers) {
        let guard = 0;
        while (guard < 4 && game.upgradeTower(tower.id).ok)
            guard += 1;
    }
}
function distanceToPath(coord, pathCenterline, distance) {
    let best = Infinity;
    for (const point of pathCenterline) {
        const d = distance(coord, point);
        if (d < best)
            best = d;
    }
    return best === Infinity ? 0 : best;
}
function aggregateMission(missionId, label, results) {
    const wins = results.filter((r) => r.win);
    const winRate = results.length ? wins.length / results.length : 0;
    const avgCoreHpRemaining = mean(results.map((r) => r.coreHpRemaining));
    const avgClearTime = wins.length ? mean(wins.map((r) => r.elapsed)) : null;
    const towerUsage = {};
    for (const r of results) {
        for (const [towerId, n] of Object.entries(r.towerCounts)) {
            towerUsage[towerId] ??= { built: 0, inWins: 0 };
            towerUsage[towerId].built += n;
            if (r.win)
                towerUsage[towerId].inWins += n;
        }
    }
    const soloWinners = results
        .filter((r) => r.win && r.strategyId.startsWith("solo_"))
        .map((r) => r.strategyId.slice("solo_".length));
    const flags = diagnose(results, winRate, avgCoreHpRemaining, soloWinners, towerUsage);
    return { missionId, label, strategyCount: results.length, winRate, avgCoreHpRemaining, avgClearTime, soloWinners, towerUsage, results, flags };
}
/** Heuristic balance advisor: turns aggregate sim data into concrete, actionable suggestions. */
function diagnose(results, winRate, avgCoreHpRemaining, soloWinners, towerUsage) {
    const flags = [];
    if (winRate === 0) {
        flags.push({
            severity: "error",
            code: "unwinnable",
            message: "No tested strategy could win this mission.",
            suggestion: "Lower enemy HP/damage, raise starting resources, or add a stronger tower to buildTowerIds."
        });
    }
    else if (winRate === 1 && avgCoreHpRemaining > 0.9) {
        flags.push({
            severity: "warning",
            code: "trivial",
            message: "Every strategy wins keeping >90% core HP — likely far too easy.",
            suggestion: "Increase wave counts/HP, reduce starting resources, or raise enemy speed."
        });
    }
    // Only "dominant" if there were genuine alternatives to lose to — a mission with a single
    // buildable tower trivially has one solo winner and must not be flagged.
    const soloTotal = results.filter((r) => r.strategyId.startsWith("solo_")).length;
    if (soloWinners.length === 1 && soloTotal > 1) {
        flags.push({
            severity: "warning",
            code: "dominant_tower",
            entityId: soloWinners[0],
            message: `Tower "${soloWinners[0]}" can solo-clear the mission while no other tower can.`,
            suggestion: `Raise its cost/upgrade cost, lower its damage/fire-rate, or buff the alternatives.`
        });
    }
    for (const [towerId, usage] of Object.entries(towerUsage)) {
        if (usage.built > 0 && usage.inWins === 0 && winRate > 0) {
            flags.push({
                severity: "info",
                code: "weak_tower",
                entityId: towerId,
                message: `Tower "${towerId}" was built but never contributed to a win.`,
                suggestion: "Consider buffing its damage/range or lowering its cost."
            });
        }
    }
    return flags;
}
function mean(values) {
    if (!values.length)
        return 0;
    return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000;
}
