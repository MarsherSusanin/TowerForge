import { coordKey } from "./hex.js";
import { createGridTopology, normalizeGridDefinition } from "./topology.js";
export class GridMap {
    id;
    width;
    height;
    grid;
    topology;
    tiles;
    pathCenterline;
    pathRoutes;
    spawnCoord;
    coreCoord;
    definition;
    baseTerrainByCoord = new Map();
    constructor(definition) {
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
    static fromDefinition(definition) {
        if (!definition)
            throw new Error("Cannot create GridMap from an undefined definition.");
        return new GridMap(definition);
    }
    clone() {
        return GridMap.fromDefinition(this.definition);
    }
    getTile(coord) {
        return this.tiles.get(coordKey(coord));
    }
    getBaseTerrain(coord) {
        return this.baseTerrainByCoord.get(coordKey(coord));
    }
    setTerrain(coord, terrain) {
        const tile = this.getTile(coord);
        if (!tile)
            return false;
        tile.terrain = terrain;
        return true;
    }
    restoreTerrain(coord) {
        const terrain = this.getBaseTerrain(coord);
        return terrain === undefined ? false : this.setTerrain(coord, terrain);
    }
    restoreAllTerrain() {
        for (const tile of this.tiles.values())
            tile.terrain = this.baseTerrainByCoord.get(coordKey(tile)) ?? tile.terrain;
    }
    isInside(coord) {
        return coord.q >= 0 && coord.q < this.width && coord.r >= 0 && coord.r < this.height;
    }
    neighbors(coord) {
        return this.topology.neighbors(coord);
    }
    distance(a, b) {
        return this.topology.distance(a, b);
    }
    line(a, b) {
        return this.topology.line(a, b);
    }
    directionBetween(a, b) {
        return this.topology.directionBetween(a, b);
    }
    footprintSize(radius) {
        return this.topology.footprintSize(radius);
    }
    tilesWithin(center, radius) {
        return this.topology.tilesWithin(center, radius).map((coord) => this.getTile(coord)).filter((tile) => Boolean(tile));
    }
    occupiedTowerAt(coord) {
        return this.getTile(coord)?.occupiedBy;
    }
    pathRouteById(routeId) {
        if (!routeId)
            return this.pathRoutes[0];
        return this.pathRoutes.find((route) => route.id === routeId) ?? this.pathRoutes[0];
    }
    allPathCoords() {
        const seen = new Set();
        const coords = [];
        for (const route of this.pathRoutes) {
            for (const coord of route.pathCenterline) {
                const key = coordKey(coord);
                if (seen.has(key))
                    continue;
                seen.add(key);
                coords.push({ ...coord });
            }
        }
        return coords;
    }
    isPathCoord(coord) {
        const key = coordKey(coord);
        return this.pathRoutes.some((route) => route.pathCenterline.some((point) => coordKey(point) === key));
    }
    setOccupied(coords, towerId) {
        for (const coord of coords) {
            const tile = this.getTile(coord);
            if (tile)
                tile.occupiedBy = towerId;
        }
    }
    clearOccupied(towerId) {
        for (const tile of this.tiles.values())
            if (tile.occupiedBy === towerId)
                delete tile.occupiedBy;
    }
    createTiles() {
        const tiles = new Map();
        const overrides = new Map(this.definition.terrainOverrides.map((override) => [coordKey(override), override.terrain]));
        for (let r = 0; r < this.height; r += 1) {
            for (let q = 0; q < this.width; q += 1) {
                const coord = { q, r };
                let terrain = overrides.get(coordKey(coord)) ?? this.definition.defaultTerrain;
                if (coordKey(coord) === coordKey(this.spawnCoord))
                    terrain = "spawn";
                if (coordKey(coord) === coordKey(this.coreCoord))
                    terrain = "core";
                this.baseTerrainByCoord.set(coordKey(coord), terrain);
                tiles.set(coordKey(coord), { ...coord, terrain });
            }
        }
        return tiles;
    }
}
function cloneMapDefinition(definition) {
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
function normalizePathRoutes(definition) {
    const routes = definition.pathRoutes?.length
        ? definition.pathRoutes
        : [{ id: "main", pathCenterline: definition.pathCenterline }];
    return routes.map((route) => ({ id: route.id, pathCenterline: route.pathCenterline.map((coord) => ({ ...coord })) }));
}
/** @deprecated Use GridMap. */
export { GridMap as HexMap };
