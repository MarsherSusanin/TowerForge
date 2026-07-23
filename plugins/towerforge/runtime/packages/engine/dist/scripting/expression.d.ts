import type { TowerScriptExpression, TowerScriptJson } from "./types.js";
export interface TowerScriptEvaluationBudget {
    remaining: number;
}
export declare function evaluateTowerScriptExpression(expression: TowerScriptExpression, context: Record<string, unknown>, budget: TowerScriptEvaluationBudget): TowerScriptJson;
export declare function readSafePath(root: Record<string, unknown>, path: string): unknown;
