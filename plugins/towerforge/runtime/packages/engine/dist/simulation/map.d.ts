import { type GridDirection, type GridTopology } from "./topology.js";
import type { GridCoord, GridDefinition, GridPathRoute, GridTile, Terrain } from "./types.js";
export interface GridMapTerrainOverride extends GridCoord {
    terrain: Terrain;
}
export interface GridMapDefinition {
    id: string;
    width: number;
    height: number;
    /** Omitted v1 maps retain the canonical odd-r hex topology. */
    grid?: GridDefinition;
    defaultTerrain: Terrain;
    pathCenterline: GridCoord[];
    pathRoutes?: GridPathRoute[];
    spawnCoord: GridCoord;
    coreCoord: GridCoord;
    terrainOverrides: GridMapTerrainOverride[];
}
export declare class GridMap {
    readonly id: string;
    readonly width: number;
    readonly height: number;
    readonly grid: GridDefinition;
    readonly topology: GridTopology;
    readonly tiles: Map<string, GridTile>;
    readonly pathCenterline: GridCoord[];
    readonly pathRoutes: GridPathRoute[];
    readonly spawnCoord: GridCoord;
    readonly coreCoord: GridCoord;
    private readonly definition;
    private readonly baseTerrainByCoord;
    private constructor();
    static fromDefinition(definition: GridMapDefinition | undefined): GridMap;
    clone(): GridMap;
    getTile(coord: GridCoord): GridTile | undefined;
    getBaseTerrain(coord: GridCoord): Terrain | undefined;
    setTerrain(coord: GridCoord, terrain: Terrain): boolean;
    restoreTerrain(coord: GridCoord): boolean;
    restoreAllTerrain(): void;
    isInside(coord: GridCoord): boolean;
    neighbors(coord: GridCoord): GridCoord[];
    distance(a: GridCoord, b: GridCoord): number;
    line(a: GridCoord, b: GridCoord): GridCoord[];
    directionBetween(a: GridCoord, b: GridCoord): GridDirection | undefined;
    footprintSize(radius: number): number;
    tilesWithin(center: GridCoord, radius: number): GridTile[];
    occupiedTowerAt(coord: GridCoord): string | undefined;
    pathRouteById(routeId: string | undefined): GridPathRoute | undefined;
    allPathCoords(): GridCoord[];
    isPathCoord(coord: GridCoord): boolean;
    setOccupied(coords: GridCoord[], towerId: string): void;
    clearOccupied(towerId: string): void;
    private createTiles;
}
/** @deprecated Use GridMapTerrainOverride. */
export type HexMapTerrainOverride = GridMapTerrainOverride;
/** @deprecated Use GridMapDefinition. */
export type HexMapDefinition = GridMapDefinition;
/** @deprecated Use GridMap. */
export { GridMap as HexMap };
