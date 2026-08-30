import { describe, expect, it } from "vitest";
import { computeFinalSplits } from "../lib/splits";
import type { ParsedReceipt } from "../lib/types";
import { member } from "./helpers";

/**
 * A round of drinks that didn't go round evenly.
 *
 * Three pints on one line, two for one person and one for another, is the
 * ordinary shape of a bar tab — and the case an equal split can't express.
 * The weights come either from the host's description or from the counters on
 * the review screen; both land here as `split_type: "shares"`.
 */

const you = member("m-you", "You");
const sarah = member("m-sarah", "Sarah");
const john = member("m-john", "John");
const members = [you, sarah, john];

function round(shares: number[], names: string[]): ParsedReceipt {
  return {
    line_items: [
      {
        temp_id: "g1",
        description: "Guinness",
        quantity: 3,
        unit_price: 7,
        line_total: 21,
      },
    ],
    subtotal: 21,
    tax: 0,
    tip: 0,
    other_charges: 0,
    grand_total: 21,
    assignments: [
      {
        line_item_temp_id: "g1",
        member_names: names,
        split_type: "shares",
        shares,
      },
    ],
    payers: [{ member_name: "You", amount: 21 }],
    unresolved_items: [],
  };
}

const owed = (result: ReturnType<typeof computeFinalSplits>, id: string) =>
  result.splits.find((s) => s.memberId === id)?.amountOwed ?? 0;

describe("splitting several of the same item unevenly", () => {
  it("bills two pints to one person and one to another", () => {
    const result = computeFinalSplits(round([2, 1], ["Sarah", "John"]), members);
    expect(owed(result, "m-sarah")).toBe(1400);
    expect(owed(result, "m-john")).toBe(700);
    expect(owed(result, "m-you")).toBe(0);
    expect(result.totalCents).toBe(2100);
    expect(result.warnings).toEqual([]);
  });

  it("still sums to the line total when the split is awkward", () => {
    // £21 three ways at 2:1:1 is 10.50 / 5.25 / 5.25 — exact. At 1:1:1 of a
    // penny-odd total it isn't, and apportionment has to absorb that.
    const receipt = round([1, 1, 1], ["You", "Sarah", "John"]);
    receipt.line_items[0].line_total = 20.99;
    receipt.subtotal = 20.99;
    receipt.grand_total = 20.99;

    const result = computeFinalSplits(receipt, members);
    expect(result.totalCents).toBe(2099);
    expect(result.splits.reduce((s, x) => s + x.amountOwed, 0)).toBe(2099);
  });

  it("spreads tax and tip by what each person actually drank", () => {
    const receipt = round([2, 1], ["Sarah", "John"]);
    receipt.tax = 2.1;
    receipt.grand_total = 23.1;

    const result = computeFinalSplits(receipt, members);
    // Sarah had twice as much, so she carries twice the service charge.
    expect(owed(result, "m-sarah")).toBe(1540);
    expect(owed(result, "m-john")).toBe(770);
    expect(result.totalCents).toBe(2310);
  });

  it("falls back to an even split when the weights are unusable", () => {
    const receipt = round([0, 0], ["Sarah", "John"]);
    const result = computeFinalSplits(receipt, members);

    // Zero weights all round can't apportion anything, so it splits evenly
    // and says so rather than billing nobody.
    expect(owed(result, "m-sarah")).toBe(1050);
    expect(owed(result, "m-john")).toBe(1050);
    expect(result.warnings.map((w) => w.code)).toContain("invalid_shares");
  });

  it("ignores weights that don't line up with the names", () => {
    const receipt = round([2], ["Sarah", "John"]);
    const result = computeFinalSplits(receipt, members);

    expect(owed(result, "m-sarah")).toBe(1050);
    expect(owed(result, "m-john")).toBe(1050);
    expect(result.warnings.map((w) => w.code)).toContain("invalid_shares");
  });

  it("handles one person taking the whole round", () => {
    const result = computeFinalSplits(round([3], ["Sarah"]), members);
    expect(owed(result, "m-sarah")).toBe(2100);
    expect(owed(result, "m-john")).toBe(0);
  });
});

describe("an unitemized bill", () => {
  const fare = (names: string[]): ParsedReceipt => ({
    line_items: [],
    subtotal: 18.5,
    tax: 0,
    tip: 0,
    other_charges: 0,
    grand_total: 18.5,
    assignments: [
      {
        line_item_temp_id: "WHOLE_BILL",
        member_names: names,
        split_type: "equal",
        shares: [],
      },
    ],
    payers: [{ member_name: "You", amount: 18.5 }],
    unresolved_items: [],
  });

  it("splits a typed-in fare evenly across whoever was in it", () => {
    const result = computeFinalSplits(fare(["You", "Sarah", "John"]), members);
    expect(result.totalCents).toBe(1850);
    expect(result.splits.reduce((s, x) => s + x.amountOwed, 0)).toBe(1850);
    // 1850 / 3 doesn't divide, so the odd cents are handed out, not dropped.
    expect(result.splits.map((s) => s.amountOwed).sort()).toEqual([616, 617, 617]);
  });

  it("charges nobody who wasn't in the cab", () => {
    const result = computeFinalSplits(fare(["You", "Sarah"]), members);
    expect(owed(result, "m-john")).toBe(0);
    expect(owed(result, "m-you") + owed(result, "m-sarah")).toBe(1850);
  });
});
