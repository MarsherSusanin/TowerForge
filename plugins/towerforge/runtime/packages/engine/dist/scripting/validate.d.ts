import type { TowerScriptDefinition } from "./types.js";
export interface TowerScriptReferenceSets {
    missionIds?: Set<string>;
    mapIds?: Set<string>;
    waveSetIds?: Set<string>;
    towerIds?: Set<string>;
    enemyIds?: Set<string>;
    abilityIds?: Set<string>;
    currencyIds?: Set<string>;
    terrainIds?: Set<string>;
}
export interface TowerScriptValidationIssue {
    scriptId: string;
    fieldPath: string;
    message: string;
}
export declare function validateTowerScriptDefinitions(scripts: Record<string, TowerScriptDefinition>, refs?: TowerScriptReferenceSets): TowerScriptValidationIssue[];
