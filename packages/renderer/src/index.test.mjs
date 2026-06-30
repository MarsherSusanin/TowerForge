import { describe, expect, it } from "vitest";
import { createCanvasRenderer } from "./index.mjs";

describe("canvas renderer contract", () => {
  it("draws a render snapshot without owning simulation state", () => {
    const calls = [];
    const canvas = {
      width: 320,
      height: 240,
      getBoundingClientRect: () => ({ width: 320, height: 240, left: 0, top: 0 }),
      getContext: () => fakeContext(calls)
    };
    const renderer = createCanvasRenderer({
      canvas,
      content: {
        towers: { honey: { label: "Honey" } },
        enemies: { crawler: { color: 0x88aa66 } }
      }
    });

    renderer.resize();
    renderer.drawSnapshot({
      tiles: [{ q: 0, r: 0, terrain: "buildable" }, { q: 1, r: 0, terrain: "path" }],
      temporaryWaterTiles: [],
      towers: [{ coord: { q: 0, r: 0 }, typeId: "honey" }],
      enemies: [{ typeId: "crawler", hp: 3, maxHp: 5, pathProgress: 0 }],
      pathCenterline: [{ q: 1, r: 0 }, { q: 1, r: 1 }],
      pathRoutes: [],
      spawnCoord: { q: 1, r: 0 }
    });

    expect(calls).toContain("fillRect");
    expect(calls).toContain("arc");
    expect(calls).toContain("fillText");
  });
});

function fakeContext(calls) {
  return {
    beginPath: () => calls.push("beginPath"),
    moveTo: () => calls.push("moveTo"),
    lineTo: () => calls.push("lineTo"),
    closePath: () => calls.push("closePath"),
    fill: () => calls.push("fill"),
    stroke: () => calls.push("stroke"),
    arc: () => calls.push("arc"),
    clearRect: () => calls.push("clearRect"),
    fillRect: () => calls.push("fillRect"),
    fillText: () => calls.push("fillText"),
    drawImage: () => calls.push("drawImage"),
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    translate: () => calls.push("translate"),
    set globalAlpha(_) {},
    set fillStyle(_) {},
    set strokeStyle(_) {},
    set font(_) {},
    set textAlign(_) {},
    set textBaseline(_) {}
  };
}
