import type { TerrainTypeDefinition } from "./types.js";
export declare const DEFAULT_TERRAIN_TYPES: Record<string, TerrainTypeDefinition>;
export declare function normalizeTerrainTypes(authored: Record<string, Partial<TerrainTypeDefinition>> | undefined, waterGroundSpeedFactor?: number): Record<string, TerrainTypeDefinition>;
