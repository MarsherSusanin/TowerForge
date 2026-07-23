import type { GridCoord, GridDefinition } from "./types.js";
export type GridDirection = "N" | "E" | "S" | "W" | "NE" | "SE" | "SW" | "NW";
export interface GridTopology {
    readonly grid: GridDefinition;
    readonly directionCount: 4 | 6;
    neighbors(coord: GridCoord): GridCoord[];
    distance(a: GridCoord, b: GridCoord): number;
    line(a: GridCoord, b: GridCoord): GridCoord[];
    directionBetween(a: GridCoord, b: GridCoord): GridDirection | undefined;
    tilesWithin(center: GridCoord, radius: number): GridCoord[];
    footprintSize(radius: number): number;
}
export declare const LEGACY_HEX_GRID: GridDefinition;
export declare const SQUARE_CARDINAL_GRID: GridDefinition;
export declare function normalizeGridDefinition(grid: GridDefinition | undefined): GridDefinition;
export declare function createGridTopology(grid: GridDefinition | undefined): GridTopology;
