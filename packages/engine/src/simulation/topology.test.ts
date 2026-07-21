import { describe, expect, it } from "vitest";
import { createGridTopology, LEGACY_HEX_GRID, SQUARE_CARDINAL_GRID } from "./topology.js";

describe("grid topology registry", () => {
  it("keeps the legacy odd-r hex contract", () => {
    const topology = createGridTopology(LEGACY_HEX_GRID);
    expect(topology.directionCount).toBe(6);
    expect(topology.neighbors({ q: 2, r: 2 })).toHaveLength(6);
    expect(topology.distance({ q: 0, r: 0 }, { q: 2, r: 2 })).toBe(3);
    expect(topology.footprintSize(2)).toBe(19);
    expect(topology.tilesWithin({ q: 2, r: 2 }, 2)).toHaveLength(19);
  });

  it("uses cardinal neighbors, Manhattan distance, and Manhattan footprints for square maps", () => {
    const topology = createGridTopology(SQUARE_CARDINAL_GRID);
    expect(topology.neighbors({ q: 2, r: 3 })).toEqual([
      { q: 2, r: 2 }, { q: 3, r: 3 }, { q: 2, r: 4 }, { q: 1, r: 3 }
    ]);
    expect(topology.distance({ q: 0, r: 0 }, { q: 3, r: 2 })).toBe(5);
    expect(topology.directionBetween({ q: 0, r: 0 }, { q: 1, r: 1 })).toBeUndefined();
    expect(topology.footprintSize(2)).toBe(13);
    expect(topology.tilesWithin({ q: 2, r: 2 }, 2)).toHaveLength(13);
  });

  it("builds square lines entirely from cardinal steps", () => {
    const topology = createGridTopology(SQUARE_CARDINAL_GRID);
    const line = topology.line({ q: 0, r: 0 }, { q: 3, r: 2 });
    expect(line).toHaveLength(6);
    expect(line[0]).toEqual({ q: 0, r: 0 });
    expect(line.at(-1)).toEqual({ q: 3, r: 2 });
    for (let index = 1; index < line.length; index += 1) {
      expect(topology.distance(line[index - 1]!, line[index]!)).toBe(1);
    }
  });
});
