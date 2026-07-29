import { describe, expect, it } from "vitest";
import { apportion, formatCents, toCents } from "../lib/money";

describe("toCents", () => {
  it("converts dollars to integer cents", () => {
    expect(toCents(10)).toBe(1000);
    expect(toCents(10.99)).toBe(1099);
    expect(toCents(0)).toBe(0);
  });

  it("parses the strings Supabase returns for numeric columns", () => {
    // The JS client hands back numeric(12,2) as a string, so "10.00" + "5.00"
    // is "10.005.00" if this boundary isn't respected.
    expect(toCents("10.00")).toBe(1000);
    expect(toCents("0.05")).toBe(5);
    expect(toCents("-12.34")).toBe(-1234);
  });

  it("rounds away from zero symmetrically", () => {
    expect(toCents(0.005)).toBe(1);
    expect(toCents(-0.005)).toBe(-1);
  });

  it("survives binary floating point representation", () => {
    expect(toCents(0.1) + toCents(0.2)).toBe(toCents(0.3));
    // Parsed as a decimal string, a half-cent rounds up as written.
    expect(toCents("1.005")).toBe(101);
    expect(toCents("-1.005")).toBe(-101);
    // As a double it cannot: the nearest representable value to 1.005 is
    // 1.00499999999999989, so this rounds down. Real behaviour, pinned here
    // so the string path stays the one that matters.
    expect(toCents(1.005)).toBe(100);
  });

  it("rejects values it cannot represent", () => {
    expect(() => toCents(NaN)).toThrow();
    expect(() => toCents(Infinity)).toThrow();
    expect(() => toCents("about ten dollars")).toThrow();
    expect(() => toCents("")).toThrow();
  });
});

describe("apportion", () => {
  it("distributes an indivisible amount without losing a cent", () => {
    const parts = apportion(1000, [1, 1, 1], ["a", "b", "c"]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts.sort((x, y) => x - y)).toEqual([333, 333, 334]);
  });

  it("respects weights", () => {
    expect(apportion(3000, [2, 1], ["a", "b"])).toEqual([2000, 1000]);
  });

  it("gives the odd cent to the same person regardless of input order", () => {
    const forward = apportion(1000, [1, 1, 1], ["a", "b", "c"]);
    const backward = apportion(1000, [1, 1, 1], ["c", "b", "a"]);
    // "a" wins the tie-break both times: index 0 forward, index 2 backward.
    expect(forward[0]).toBe(334);
    expect(backward[2]).toBe(334);
  });

  it("never awards a leftover cent to a zero weight", () => {
    const parts = apportion(1000, [1, 1, 0], ["a", "b", "c"]);
    expect(parts[2]).toBe(0);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it("apportions refunds symmetrically", () => {
    const parts = apportion(-1000, [1, 1, 1], ["a", "b", "c"]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-1000);
    expect(parts.sort((x, y) => x - y)).toEqual([-334, -333, -333]);
  });

  it("handles a single participant", () => {
    expect(apportion(1234, [1], ["a"])).toEqual([1234]);
  });

  it("rejects unusable weightings rather than returning NaN", () => {
    expect(() => apportion(1000, [0, 0], ["a", "b"])).toThrow(/greater than zero/);
    expect(() => apportion(1000, [-1, 2], ["a", "b"])).toThrow(/non-negative/);
    expect(() => apportion(1000, [1, 1], ["a"])).toThrow(/same length/);
  });

  it("returns nothing for no participants", () => {
    expect(apportion(1000, [], [])).toEqual([]);
  });
});

describe("formatCents", () => {
  it("renders cents as currency", () => {
    expect(formatCents(3334)).toBe("$33.34");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(-500)).toBe("-$5.00");
  });
});
