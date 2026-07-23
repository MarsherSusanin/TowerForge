import { type GameContentRegistry } from "../content/registry.js";
import type { GameSnapshot } from "./types.js";
/**
 * Simulation-driven balance analysis.
 *
 * The engine is fully deterministic and has no RNG, so outcome variety comes from varying the
 * *player strategy* (which towers, upgrades) rather than random seeds. We run a spread of
 * representative strategies headlessly per mission and aggregate win-rate, surviving core HP, and
 * tower usage into an actionable balance report — the substrate an AI co-designer (or a human)
 * drives in an author → simulate → diagnose → patch loop.
 */
export interface BalanceStrategy {
    id: string;
    label: string;
    towerIds: string[];
    upgrade: boolean;
    placement: "near_path" | "far_path" | "near_core";
    rebuildInterval: number;
}
export interface StrategyResult {
    strategyId: string;
    label: string;
    strategy: BalanceStrategy;
    outcome: GameSnapshot["outcome"];
    win: boolean;
    coreHpRemaining: number;
    towersBuilt: number;
    leaks: number;
    elapsed: number;
    towerCounts: Record<string, number>;
}
export interface BalanceFlag {
    severity: "error" | "warning" | "info";
    code: string;
    entityId?: string;
    message: string;
    suggestion?: string;
}
export interface MissionBalance {
    missionId: string;
    label: string;
    strategyCount: number;
    winRate: number;
    avgCoreHpRemaining: number;
    avgClearTime: number | null;
    soloWinners: string[];
    towerUsage: Record<string, {
        built: number;
        inWins: number;
    }>;
    results: StrategyResult[];
    flags: BalanceFlag[];
}
export interface BalanceReport {
    missions: MissionBalance[];
    summary: {
        missions: number;
        winnable: number;
        flagged: number;
    };
    generatedWith: {
        strategiesPerMission: number;
        simSeconds: number;
        tickStep: number;
    };
}
export interface BalanceSweepOptions {
    missionIds?: string[];
    simSeconds?: number;
    tickStep?: number;
    maxStrategies?: number;
}
export declare function runBalanceSweep(content: GameContentRegistry, options?: BalanceSweepOptions): BalanceReport;
