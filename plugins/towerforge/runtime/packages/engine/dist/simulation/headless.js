import { TowerDefenseGame } from "./TowerDefenseGame.js";
export function applySimulationAction(game, action) {
    if (action.type === "tick") {
        game.tick(action.units);
        return { ok: true };
    }
    if (action.type === "startWave") {
        return game.startNextWave();
    }
    if (action.type === "placeTower") {
        return game.placeTower(action.towerTypeId, action.coord);
    }
    if (action.type === "moveTower") {
        return game.moveTower(action.towerId, action.coord);
    }
    if (action.type === "sellTower") {
        return game.sellTower(action.towerId);
    }
    if (action.type === "upgradeTower") {
        return game.upgradeTower(action.towerId);
    }
    if (action.type === "setTargetMode") {
        return game.setTowerTargetMode(action.towerId, action.mode);
    }
    if (action.type === "useAbility") {
        return game.useAbility(action.abilityId, action.center);
    }
    if (action.type === "emitSignal") {
        return game.emitScriptSignal(action.signal, action.payload);
    }
    return { ok: false, reason: "Unknown simulation action." };
}
export function tickHeadless(game, units, step = 0.1) {
    const safeStep = Math.max(0.01, step);
    for (let elapsed = 0; elapsed < units; elapsed += safeStep) {
        game.tick(Math.min(safeStep, units - elapsed));
    }
}
export function runHeadlessMission(options) {
    const game = new TowerDefenseGame({ missionId: options.missionId, content: options.content });
    const actionResults = [];
    for (const action of options.actions ?? []) {
        if (action.type === "tick") {
            tickHeadless(game, action.units, options.tickStep);
            actionResults.push({ action, result: { ok: true }, snapshot: game.getSnapshot() });
            continue;
        }
        const result = applySimulationAction(game, action);
        actionResults.push({ action, result, snapshot: game.getSnapshot() });
    }
    return { game, snapshot: game.getSnapshot(), actionResults };
}
