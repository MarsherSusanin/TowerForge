import { type GameContentRegistry } from "../content/registry.js";
import { MushroomDefenseGame } from "./MushroomDefenseGame.js";
import type { ActionResult, GameSnapshot, HexCoord, MissionAbilityId, TowerTargetMode } from "./types.js";

export type SimulationAction =
  | { type: "tick"; units: number }
  | { type: "startWave" }
  | { type: "placeTower"; towerTypeId: string; coord: HexCoord }
  | { type: "moveTower"; towerId: string; coord: HexCoord }
  | { type: "upgradeTower"; towerId: string }
  | { type: "setTargetMode"; towerId: string; mode: TowerTargetMode }
  | { type: "useAbility"; abilityId: MissionAbilityId; center: HexCoord };

export interface SimulationActionResult {
  action: SimulationAction;
  result: ActionResult;
  snapshot: GameSnapshot;
}

export interface HeadlessMissionRunOptions {
  content: GameContentRegistry;
  missionId: string;
  actions?: SimulationAction[];
  tickStep?: number;
}

export interface HeadlessMissionRunResult {
  game: MushroomDefenseGame;
  snapshot: GameSnapshot;
  actionResults: SimulationActionResult[];
}

export function applySimulationAction(game: MushroomDefenseGame, action: SimulationAction): ActionResult {
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
  if (action.type === "upgradeTower") {
    return game.upgradeTower(action.towerId);
  }
  if (action.type === "setTargetMode") {
    return game.setTowerTargetMode(action.towerId, action.mode);
  }
  if (action.type === "useAbility") {
    if (action.abilityId === "path_water") {
      return game.usePathWaterAbility(action.center);
    }
    return { ok: false, reason: `Unknown ability ${action.abilityId}.`, reasonKey: "reason.abilityUnavailable" };
  }
  return { ok: false, reason: "Unknown simulation action." };
}

export function tickHeadless(game: MushroomDefenseGame, units: number, step = 0.1): void {
  const safeStep = Math.max(0.01, step);
  for (let elapsed = 0; elapsed < units; elapsed += safeStep) {
    game.tick(Math.min(safeStep, units - elapsed));
  }
}

export function runHeadlessMission(options: HeadlessMissionRunOptions): HeadlessMissionRunResult {
  const game = new MushroomDefenseGame({ missionId: options.missionId, content: options.content });
  const actionResults: SimulationActionResult[] = [];

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
