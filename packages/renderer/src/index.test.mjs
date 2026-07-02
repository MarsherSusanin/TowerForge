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
        towers: { arrow: { label: "Arrow" } },
        enemies: { crawler: { color: 0x88aa66 } }
      }
    });

    renderer.resize();
    renderer.drawSnapshot({
      tiles: [{ q: 0, r: 0, terrain: "buildable" }, { q: 1, r: 0, terrain: "path" }],
      temporaryWaterTiles: [],
      towers: [{ coord: { q: 0, r: 0 }, typeId: "arrow" }],
      enemies: [{ typeId: "crawler", hp: 3, maxHp: 5, pathProgress: 0 }],
      pathCenterline: [{ q: 1, r: 0 }, { q: 1, r: 1 }],
      pathRoutes: [],
      spawnCoord: { q: 1, r: 0 }
    });

    expect(calls).toContain("fillRect");
    expect(calls).toContain("arc");
    expect(calls).toContain("fillText");
  });

  it("draws an atlas-frame sprite as a sub-rectangle of the atlas image", () => {
    const prevImage = globalThis.Image;
    class FakeImage {
      constructor() { this.complete = true; this.naturalWidth = 64; this.naturalHeight = 64; }
      set src(v) { this._src = v; }
      get src() { return this._src; }
    }
    globalThis.Image = FakeImage;
    try {
      const drawImageCalls = [];
      const canvas = {
        width: 320,
        height: 240,
        getBoundingClientRect: () => ({ width: 320, height: 240, left: 0, top: 0 }),
        getContext: () => ({ ...fakeContext([]), drawImage: (...args) => drawImageCalls.push(args) })
      };
      const renderer = createCanvasRenderer({
        assetBase: "/project-file/",
        canvas,
        content: {
          towers: { arrow: { label: "Arrow" } },
          enemies: {},
          visuals: {
            atlases: { sheet: { src: "assets/sheet.png" } },
            sprites: { hero: { atlas: "sheet", frame: { x: 16, y: 32, w: 8, h: 8 } } },
            bindings: { towers: { arrow: "hero" } }
          }
        }
      });

      renderer.resize();
      renderer.drawSnapshot({
        tiles: [{ q: 0, r: 0, terrain: "buildable" }],
        temporaryWaterTiles: [],
        towers: [{ coord: { q: 0, r: 0 }, typeId: "arrow" }],
        enemies: [],
        pathCenterline: [],
        pathRoutes: [],
        spawnCoord: { q: 0, r: 0 }
      });

      const frameDraw = drawImageCalls.find((a) => a.length === 9);
      expect(frameDraw).toBeTruthy();
      expect(frameDraw.slice(1, 5)).toEqual([16, 32, 8, 8]);
    } finally {
      globalThis.Image = prevImage;
    }
  });

  it("never feeds a negative or non-finite frame offset into drawImage", () => {
    const prevImage = globalThis.Image;
    class FakeImage {
      constructor() { this.complete = true; this.naturalWidth = 64; this.naturalHeight = 64; }
      set src(v) { this._src = v; }
      get src() { return this._src; }
    }
    globalThis.Image = FakeImage;
    try {
      const drawImageCalls = [];
      const canvas = {
        width: 320,
        height: 240,
        getBoundingClientRect: () => ({ width: 320, height: 240, left: 0, top: 0 }),
        getContext: () => ({ ...fakeContext([]), drawImage: (...args) => drawImageCalls.push(args) })
      };
      const renderer = createCanvasRenderer({
        assetBase: "/project-file/",
        canvas,
        content: {
          towers: { arrow: { label: "Arrow" } },
          enemies: {},
          visuals: {
            atlases: { sheet: { src: "assets/sheet.png" } },
            sprites: { bad: { atlas: "sheet", frame: { x: -8, y: 0, w: 16, h: 16 } } },
            bindings: { towers: { arrow: "bad" } }
          }
        }
      });

      renderer.resize();
      renderer.drawSnapshot({
        tiles: [{ q: 0, r: 0, terrain: "buildable" }],
        temporaryWaterTiles: [],
        towers: [{ coord: { q: 0, r: 0 }, typeId: "arrow" }],
        enemies: [],
        pathCenterline: [],
        pathRoutes: [],
        spawnCoord: { q: 0, r: 0 }
      });

      // A negative frame offset resolves to null → shape fallback, so no 9-arg sub-rect draw happens.
      expect(drawImageCalls.some((a) => a.length === 9)).toBe(false);
    } finally {
      globalThis.Image = prevImage;
    }
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
