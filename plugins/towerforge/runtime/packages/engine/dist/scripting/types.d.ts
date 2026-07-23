import type { StatusEffectSpec } from "../simulation/types.js";
export type TowerScriptJson = null | boolean | number | string | TowerScriptJson[] | {
    [key: string]: TowerScriptJson;
};
export type TowerScriptScope = "global" | "mission" | "map" | "wave" | "tower" | "enemy" | "ability" | "terrain";
export interface TowerScriptBinding {
    scope: TowerScriptScope;
    /** Omit ids to bind every object in this scope. global never accepts ids. */
    ids?: string[];
}
export type TowerScriptEventName = "gameStarted" | "tick" | "towerPlaced" | "towerSold" | "towerMoved" | "towerUpgraded" | "towerDestroyed" | "towerTargetModeChanged" | "towerFired" | "towerResourcesGranted" | "enemyHit" | "enemyKilled" | "enemyLeaked" | "enemySpawnedOnDeath" | "enemyPhaseSpawned" | "waveStarted" | "waveCleared" | "resourcesGranted" | "abilityUsed" | "enemyEnteredTile" | "terrainChanged" | "objectiveCompleted" | "objectiveFailed" | "starEarned" | "victory" | "defeat" | "signal";
export type TowerScriptOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "and" | "or" | "not" | "add" | "sub" | "mul" | "div" | "min" | "max" | "coalesce";
export type TowerScriptExpression = TowerScriptJson | {
    $get: string;
} | {
    $op: TowerScriptOperator;
    args: TowerScriptExpression[];
};
export type TowerScriptEntityTarget = "self" | "eventEnemy" | "eventTower" | "allEnemies" | "allTowers";
export type TowerScriptTileTarget = "eventTile" | {
    q: TowerScriptExpression;
    r: TowerScriptExpression;
};
export type TowerScriptAction = {
    action: "grantResource";
    resourceId: string;
    amount: TowerScriptExpression;
} | {
    action: "damageCore";
    amount: TowerScriptExpression;
} | {
    action: "healCore";
    amount: TowerScriptExpression;
} | {
    action: "damageEnemy";
    target: TowerScriptEntityTarget;
    amount: TowerScriptExpression;
} | {
    action: "healEnemy";
    target: TowerScriptEntityTarget;
    amount: TowerScriptExpression;
} | {
    action: "applyStatus";
    target: TowerScriptEntityTarget;
    status: StatusEffectSpec;
} | {
    action: "setTowerCooldown";
    target: TowerScriptEntityTarget;
    value: TowerScriptExpression;
} | {
    action: "addTowerStacks";
    target: TowerScriptEntityTarget;
    amount: TowerScriptExpression;
} | {
    action: "spawnEnemy";
    enemyTypeId: string;
    count?: TowerScriptExpression;
    routeId?: string;
    pathProgress?: TowerScriptExpression;
} | {
    action: "setTileTerrain";
    target: TowerScriptTileTarget;
    terrainId: string;
    duration?: TowerScriptExpression;
} | {
    action: "restoreTileTerrain";
    target: TowerScriptTileTarget;
} | {
    action: "setState";
    key: string;
    value: TowerScriptExpression;
} | {
    action: "incrementState";
    key: string;
    amount?: TowerScriptExpression;
} | {
    action: "emitSignal";
    signal: string;
    payload?: TowerScriptExpression;
};
export interface TowerScriptHandler {
    id?: string;
    /** A truthy expression enables this handler for the current event/context. */
    when?: TowerScriptExpression;
    /** Only valid for tick. Execution remains deterministic and uses mission time. */
    every?: number;
    actions: TowerScriptAction[];
}
export interface TowerScriptDefinition {
    schemaVersion: 1 | 2;
    id: string;
    label?: string;
    description?: string;
    enabled?: boolean;
    bindings: TowerScriptBinding[];
    initialState?: Record<string, TowerScriptJson>;
    handlers: Partial<Record<TowerScriptEventName, TowerScriptHandler[]>>;
}
export interface TowerScriptDiagnostic {
    scriptId: string;
    handlerId?: string;
    event: TowerScriptEventName;
    code: "budget_exceeded" | "invalid_expression" | "invalid_action" | "runtime_error";
    message: string;
}
export interface TowerScriptStateSnapshot {
    /** script id -> bound object key -> state object */
    values: Record<string, Record<string, Record<string, TowerScriptJson>>>;
    diagnostics: TowerScriptDiagnostic[];
}
