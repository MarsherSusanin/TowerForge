import { hexDistance, hexLine, neighbors as hexNeighbors, sameCoord } from "./hex.js";
export const LEGACY_HEX_GRID = Object.freeze({ kind: "hex", layout: "odd-r" });
export const SQUARE_CARDINAL_GRID = Object.freeze({ kind: "square", adjacency: "cardinal" });
export function normalizeGridDefinition(grid) {
    if (grid?.kind === "square")
        return { kind: "square", adjacency: "cardinal" };
    return { kind: "hex", layout: "odd-r" };
}
export function createGridTopology(grid) {
    const normalized = normalizeGridDefinition(grid);
    return normalized.kind === "square" ? squareTopology(normalized) : hexTopology(normalized);
}
function hexTopology(grid) {
    return {
        grid,
        directionCount: 6,
        neighbors: hexNeighbors,
        distance: hexDistance,
        line: hexLine,
        directionBetween(a, b) {
            const index = hexNeighbors(a).findIndex((coord) => sameCoord(coord, b));
            return ["NW", "NE", "W", "E", "SW", "SE"][index];
        },
        tilesWithin(center, radius) {
            return coordinatesWithin(center, radius, hexDistance);
        },
        footprintSize(radius) {
            const safeRadius = Math.max(0, Math.floor(radius));
            return 1 + 3 * safeRadius * (safeRadius + 1);
        }
    };
}
function squareTopology(grid) {
    return {
        grid,
        directionCount: 4,
        neighbors(coord) {
            return [
                { q: coord.q, r: coord.r - 1 },
                { q: coord.q + 1, r: coord.r },
                { q: coord.q, r: coord.r + 1 },
                { q: coord.q - 1, r: coord.r }
            ];
        },
        distance(a, b) {
            return Math.abs(a.q - b.q) + Math.abs(a.r - b.r);
        },
        line: squareLine,
        directionBetween(a, b) {
            const dq = b.q - a.q;
            const dr = b.r - a.r;
            if (dq === 0 && dr === -1)
                return "N";
            if (dq === 1 && dr === 0)
                return "E";
            if (dq === 0 && dr === 1)
                return "S";
            if (dq === -1 && dr === 0)
                return "W";
            return undefined;
        },
        tilesWithin(center, radius) {
            return coordinatesWithin(center, radius, (a, b) => Math.abs(a.q - b.q) + Math.abs(a.r - b.r));
        },
        footprintSize(radius) {
            const safeRadius = Math.max(0, Math.floor(radius));
            return 1 + 2 * safeRadius * (safeRadius + 1);
        }
    };
}
function coordinatesWithin(center, radius, distance) {
    const safeRadius = Math.max(0, Math.floor(radius));
    const coords = [];
    for (let r = center.r - safeRadius; r <= center.r + safeRadius; r += 1) {
        for (let q = center.q - safeRadius; q <= center.q + safeRadius; q += 1) {
            const coord = { q, r };
            if (distance(center, coord) <= safeRadius)
                coords.push(coord);
        }
    }
    return coords;
}
/** Deterministic cardinal line. Every step is Manhattan-adjacent, including direct-flight tracks. */
function squareLine(a, b) {
    let q = a.q;
    let r = a.r;
    const dq = Math.abs(b.q - a.q);
    const dr = Math.abs(b.r - a.r);
    const qStep = a.q < b.q ? 1 : -1;
    const rStep = a.r < b.r ? 1 : -1;
    let qSteps = 0;
    let rSteps = 0;
    const result = [{ q, r }];
    while (q !== b.q || r !== b.r) {
        const nextQProgress = qSteps < dq ? (qSteps + 0.5) / Math.max(1, dq) : Number.POSITIVE_INFINITY;
        const nextRProgress = rSteps < dr ? (rSteps + 0.5) / Math.max(1, dr) : Number.POSITIVE_INFINITY;
        if (nextQProgress <= nextRProgress) {
            q += qStep;
            qSteps += 1;
        }
        else {
            r += rStep;
            rSteps += 1;
        }
        result.push({ q, r });
    }
    return result;
}
