import { coordKey, hexDistance } from "./hex.js";
import type { HexCoord, HexPathRoute, HexTile, Terrain } from "./types.js";

export interface HexMapTerrainOverride extends HexCoord {
  terrain: Terrain;
}

export interface HexMapDefinition {
  id: string;
  width: number;
  height: number;
  defaultTerrain: Terrain;
  pathCenterline: HexCoord[];
  pathRoutes?: HexPathRoute[];
  spawnCoord: HexCoord;
  coreCoord: HexCoord;
  terrainOverrides: HexMapTerrainOverride[];
}

export class HexMap {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly tiles: Map<string, HexTile>;
  readonly pathCenterline: HexCoord[];
  readonly pathRoutes: HexPathRoute[];
  readonly spawnCoord: HexCoord;
  readonly coreCoord: HexCoord;

  private readonly definition: HexMapDefinition;

  private constructor(definition: HexMapDefinition) {
    this.definition = cloneMapDefinition(definition);
    this.id = definition.id;
    this.width = definition.width;
    this.height = definition.height;
    this.pathRoutes = normalizePathRoutes(definition);
    this.pathCenterline = this.pathRoutes[0]?.pathCenterline.map((coord) => ({ ...coord })) ?? [];
    this.spawnCoord = { ...definition.spawnCoord };
    this.coreCoord = { ...definition.coreCoord };
    this.tiles = this.createTiles();
  }

  static fromDefinition(definition: HexMapDefinition | undefined): HexMap {
    if (!definition) {
      throw new Error("Cannot create HexMap from an undefined definition.");
    }
    return new HexMap(definition);
  }

  clone(): HexMap {
    return HexMap.fromDefinition(this.definition);
  }

  getTile(coord: HexCoord): HexTile | undefined {
    return this.tiles.get(coordKey(coord));
  }

  isInside(coord: HexCoord): boolean {
    return coord.q >= 0 && coord.q < this.width && coord.r >= 0 && coord.r < this.height;
  }

  tilesWithin(center: HexCoord, radius: number): HexTile[] {
    return [...this.tiles.values()].filter((tile) => hexDistance(center, tile) <= radius);
  }

  occupiedTowerAt(coord: HexCoord): string | undefined {
    return this.getTile(coord)?.occupiedBy;
  }

  pathRouteById(routeId: string | undefined): HexPathRoute | undefined {
    if (!routeId) {
      return this.pathRoutes[0];
    }
    return this.pathRoutes.find((route) => route.id === routeId) ?? this.pathRoutes[0];
  }

  allPathCoords(): HexCoord[] {
    const seen = new Set<string>();
    const coords: HexCoord[] = [];
    for (const route of this.pathRoutes) {
      for (const coord of route.pathCenterline) {
        const key = coordKey(coord);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        coords.push({ ...coord });
      }
    }
    return coords;
  }

  setOccupied(coords: HexCoord[], towerId: string): void {
    for (const coord of coords) {
      const tile = this.getTile(coord);
      if (tile) {
        tile.occupiedBy = towerId;
      }
    }
  }

  clearOccupied(towerId: string): void {
    for (const tile of this.tiles.values()) {
      if (tile.occupiedBy === towerId) {
        delete tile.occupiedBy;
      }
    }
  }

  private createTiles(): Map<string, HexTile> {
    const tiles = new Map<string, HexTile>();
    const overrides = new Map(this.definition.terrainOverrides.map((override) => [coordKey(override), override.terrain]));

    for (let r = 0; r < this.height; r += 1) {
      for (let q = 0; q < this.width; q += 1) {
        const coord = { q, r };
        let terrain: Terrain = overrides.get(coordKey(coord)) ?? this.definition.defaultTerrain;

        if (coordKey(coord) === coordKey(this.spawnCoord)) {
          terrain = "spawn";
        }

        if (coordKey(coord) === coordKey(this.coreCoord)) {
          terrain = "core";
        }

        tiles.set(coordKey(coord), { ...coord, terrain });
      }
    }

    return tiles;
  }
}

function cloneMapDefinition(definition: HexMapDefinition): HexMapDefinition {
  return {
    ...definition,
    pathCenterline: definition.pathCenterline.map((coord) => ({ ...coord })),
    pathRoutes: normalizePathRoutes(definition),
    spawnCoord: { ...definition.spawnCoord },
    coreCoord: { ...definition.coreCoord },
    terrainOverrides: definition.terrainOverrides.map((override) => ({ ...override }))
  };
}

function normalizePathRoutes(definition: HexMapDefinition): HexPathRoute[] {
  const routes = definition.pathRoutes?.length
    ? definition.pathRoutes
    : [{ id: "main", pathCenterline: definition.pathCenterline }];
  return routes.map((route) => ({
    id: route.id,
    pathCenterline: route.pathCenterline.map((coord) => ({ ...coord }))
  }));
}
