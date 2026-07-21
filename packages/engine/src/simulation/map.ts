import { coordKey } from "./hex.js";
import { createGridTopology, normalizeGridDefinition, type GridDirection, type GridTopology } from "./topology.js";
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

export class GridMap {
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

  private readonly definition: GridMapDefinition;
  private readonly baseTerrainByCoord = new Map<string, Terrain>();

  private constructor(definition: GridMapDefinition) {
    this.definition = cloneMapDefinition(definition);
    this.id = definition.id;
    this.width = definition.width;
    this.height = definition.height;
    this.grid = normalizeGridDefinition(definition.grid);
    this.topology = createGridTopology(this.grid);
    this.pathRoutes = normalizePathRoutes(definition);
    this.pathCenterline = this.pathRoutes[0]?.pathCenterline.map((coord) => ({ ...coord })) ?? [];
    this.spawnCoord = { ...definition.spawnCoord };
    this.coreCoord = { ...definition.coreCoord };
    this.tiles = this.createTiles();
  }

  static fromDefinition(definition: GridMapDefinition | undefined): GridMap {
    if (!definition) throw new Error("Cannot create GridMap from an undefined definition.");
    return new GridMap(definition);
  }

  clone(): GridMap {
    return GridMap.fromDefinition(this.definition);
  }

  getTile(coord: GridCoord): GridTile | undefined {
    return this.tiles.get(coordKey(coord));
  }

  getBaseTerrain(coord: GridCoord): Terrain | undefined {
    return this.baseTerrainByCoord.get(coordKey(coord));
  }

  setTerrain(coord: GridCoord, terrain: Terrain): boolean {
    const tile = this.getTile(coord);
    if (!tile) return false;
    tile.terrain = terrain;
    return true;
  }

  restoreTerrain(coord: GridCoord): boolean {
    const terrain = this.getBaseTerrain(coord);
    return terrain === undefined ? false : this.setTerrain(coord, terrain);
  }

  restoreAllTerrain(): void {
    for (const tile of this.tiles.values()) tile.terrain = this.baseTerrainByCoord.get(coordKey(tile)) ?? tile.terrain;
  }

  isInside(coord: GridCoord): boolean {
    return coord.q >= 0 && coord.q < this.width && coord.r >= 0 && coord.r < this.height;
  }

  neighbors(coord: GridCoord): GridCoord[] {
    return this.topology.neighbors(coord);
  }

  distance(a: GridCoord, b: GridCoord): number {
    return this.topology.distance(a, b);
  }

  line(a: GridCoord, b: GridCoord): GridCoord[] {
    return this.topology.line(a, b);
  }

  directionBetween(a: GridCoord, b: GridCoord): GridDirection | undefined {
    return this.topology.directionBetween(a, b);
  }

  footprintSize(radius: number): number {
    return this.topology.footprintSize(radius);
  }

  tilesWithin(center: GridCoord, radius: number): GridTile[] {
    return this.topology.tilesWithin(center, radius).map((coord) => this.getTile(coord)).filter((tile): tile is GridTile => Boolean(tile));
  }

  occupiedTowerAt(coord: GridCoord): string | undefined {
    return this.getTile(coord)?.occupiedBy;
  }

  pathRouteById(routeId: string | undefined): GridPathRoute | undefined {
    if (!routeId) return this.pathRoutes[0];
    return this.pathRoutes.find((route) => route.id === routeId) ?? this.pathRoutes[0];
  }

  allPathCoords(): GridCoord[] {
    const seen = new Set<string>();
    const coords: GridCoord[] = [];
    for (const route of this.pathRoutes) {
      for (const coord of route.pathCenterline) {
        const key = coordKey(coord);
        if (seen.has(key)) continue;
        seen.add(key);
        coords.push({ ...coord });
      }
    }
    return coords;
  }

  isPathCoord(coord: GridCoord): boolean {
    const key = coordKey(coord);
    return this.pathRoutes.some((route) => route.pathCenterline.some((point) => coordKey(point) === key));
  }

  setOccupied(coords: GridCoord[], towerId: string): void {
    for (const coord of coords) {
      const tile = this.getTile(coord);
      if (tile) tile.occupiedBy = towerId;
    }
  }

  clearOccupied(towerId: string): void {
    for (const tile of this.tiles.values()) if (tile.occupiedBy === towerId) delete tile.occupiedBy;
  }

  private createTiles(): Map<string, GridTile> {
    const tiles = new Map<string, GridTile>();
    const overrides = new Map(this.definition.terrainOverrides.map((override) => [coordKey(override), override.terrain]));
    for (let r = 0; r < this.height; r += 1) {
      for (let q = 0; q < this.width; q += 1) {
        const coord = { q, r };
        let terrain: Terrain = overrides.get(coordKey(coord)) ?? this.definition.defaultTerrain;
        if (coordKey(coord) === coordKey(this.spawnCoord)) terrain = "spawn";
        if (coordKey(coord) === coordKey(this.coreCoord)) terrain = "core";
        this.baseTerrainByCoord.set(coordKey(coord), terrain);
        tiles.set(coordKey(coord), { ...coord, terrain });
      }
    }
    return tiles;
  }
}

function cloneMapDefinition(definition: GridMapDefinition): GridMapDefinition {
  return {
    ...definition,
    grid: normalizeGridDefinition(definition.grid),
    pathCenterline: definition.pathCenterline.map((coord) => ({ ...coord })),
    pathRoutes: normalizePathRoutes(definition),
    spawnCoord: { ...definition.spawnCoord },
    coreCoord: { ...definition.coreCoord },
    terrainOverrides: definition.terrainOverrides.map((override) => ({ ...override }))
  };
}

function normalizePathRoutes(definition: GridMapDefinition): GridPathRoute[] {
  const routes = definition.pathRoutes?.length
    ? definition.pathRoutes
    : [{ id: "main", pathCenterline: definition.pathCenterline }];
  return routes.map((route) => ({ id: route.id, pathCenterline: route.pathCenterline.map((coord) => ({ ...coord })) }));
}

/** @deprecated Use GridMapTerrainOverride. */
export type HexMapTerrainOverride = GridMapTerrainOverride;
/** @deprecated Use GridMapDefinition. */
export type HexMapDefinition = GridMapDefinition;
/** @deprecated Use GridMap. */
export { GridMap as HexMap };
