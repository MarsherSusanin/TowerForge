import { describe, expect, it } from "vitest";
import { evaluateTowerScriptExpression, readSafePath } from "./expression.js";

describe("TowerScript expressions", () => {
  it("reads only own, safe context paths", () => {
    expect(readSafePath({ event: { amount: 4 } }, "event.amount")).toBe(4);
    expect(readSafePath({ event: {} }, "event.missing")).toBeNull();
    expect(() => readSafePath({ event: {} }, "event.__proto__.value")).toThrow(/Unsafe context path/);
  });

  it("evaluates deterministic operators and normalizes overflow", () => {
    expect(evaluateTowerScriptExpression(
      { $op: "add", args: [2, { $get: "state.bonus" }] },
      { state: { bonus: 3 } },
      { remaining: 10 }
    )).toBe(5);
    expect(evaluateTowerScriptExpression(
      { $op: "mul", args: [1e308, 1e308] },
      {},
      { remaining: 10 }
    )).toBe(0);
  });

  it("stops expressions that exceed their evaluation budget", () => {
    expect(() => evaluateTowerScriptExpression([1, 2, 3], {}, { remaining: 2 })).toThrow(/budget exceeded/);
  });
});
