import type { HexCoord } from "./types.js";
interface CubeCoord {
    x: number;
    y: number;
    z: number;
}
export declare function coordKey(coord: HexCoord): string;
export declare function sameCoord(a: HexCoord, b: HexCoord): boolean;
export declare function offsetToCube(coord: HexCoord): CubeCoord;
export declare function cubeToOffset(cube: CubeCoord): HexCoord;
export declare function hexDistance(a: HexCoord, b: HexCoord): number;
export declare function neighbors(coord: HexCoord): HexCoord[];
export declare function hexLine(a: HexCoord, b: HexCoord): HexCoord[];
export {};
