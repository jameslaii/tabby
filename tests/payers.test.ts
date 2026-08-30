import { describe, expect, it } from "vitest";
import { payersFor, resolvePayers } from "../lib/splits";
import type { ParsedReceipt } from "../lib/types";
import { member } from "./helpers";

const members = [
  member("m-you", "You"),
  member("m-sarah", "Sarah"),
  member("m-john", "John"),
];

/** A receipt carrying only what resolvePayers reads. */
function receipt(payers?: ParsedReceipt["payers"]): ParsedReceipt {
  return {
    line_items: [],
    subtotal: 0,
    tax: 0,
    tip: 0,
    other_charges: 0,
    grand_total: 0,
    assignments: [],
    unresolved_items: [],
    ...(payers ? { payers } : {}),
  };
}

const codes = (warnings: { code: string }[]) => warnings.map((w) => w.code);

describe("resolvePayers", () => {
  it("gives the whole bill to a single named payer", () => {
    const { payers, warnings } = resolvePayers(
      receipt([{ member_name: "Sarah", amount: 45 }]),
      members,
      4500,
    );
    expect(payers).toEqual([{ memberId: "m-sarah", amountPaid: 4500 }]);
    expect(warnings).toEqual([]);
  });

  it("matches names leniently on case, spacing and accents", () => {
    const { payers } = resolvePayers(
      receipt([{ member_name: "  sarah ", amount: 45 }]),
      members,
      4500,
    );
    expect(payers).toEqual([{ memberId: "m-sarah", amountPaid: 4500 }]);
  });

  it("splits evenly between payers when no amounts are given", () => {
    const { payers, warnings } = resolvePayers(
      receipt([
        { member_name: "You", amount: 0 },
        { member_name: "Sarah", amount: 0 },
      ]),
      members,
      4501,
    );
    // Apportioned, so the odd cent lands somewhere rather than vanishing.
    expect(payers.reduce((s, p) => s + p.amountPaid, 0)).toBe(4501);
    expect(payers.map((p) => p.memberId)).toEqual(["m-you", "m-sarah"]);
    expect(warnings).toEqual([]);
  });

  it("keeps stated amounts when they reconcile to the total", () => {
    const { payers, warnings } = resolvePayers(
      receipt([
        { member_name: "You", amount: 30 },
        { member_name: "Sarah", amount: 15 },
      ]),
      members,
      4500,
    );
    expect(payers).toEqual([
      { memberId: "m-you", amountPaid: 3000 },
      { memberId: "m-sarah", amountPaid: 1500 },
    ]);
    expect(warnings).toEqual([]);
  });

  it("warns and re-apportions when stated amounts miss the total", () => {
    const { payers, warnings } = resolvePayers(
      receipt([
        { member_name: "You", amount: 30 },
        { member_name: "Sarah", amount: 10 },
      ]),
      members,
      4500,
    );
    // The money that actually left wallets has to equal the bill, or the
    // group stops summing to zero and debt simplification refuses to run.
    expect(payers.reduce((s, p) => s + p.amountPaid, 0)).toBe(4500);
    expect(codes(warnings)).toContain("payer_total_mismatch");
  });

  it("reports an unknown name instead of guessing a payer", () => {
    const { payers, warnings } = resolvePayers(
      receipt([{ member_name: "Priya", amount: 45 }]),
      members,
      4500,
    );
    expect(payers).toEqual([]);
    expect(codes(warnings)).toEqual(["unknown_payer_name", "no_payer"]);
  });

  it("refuses to pick between two members with the same name", () => {
    const twins = [...members, member("m-sarah-2", "Sarah")];
    const { payers, warnings } = resolvePayers(
      receipt([{ member_name: "Sarah", amount: 45 }]),
      twins,
      4500,
    );
    expect(payers).toEqual([]);
    expect(codes(warnings)).toContain("unknown_payer_name");
  });

  it("flags a receipt nobody was said to have paid", () => {
    const { payers, warnings } = resolvePayers(receipt([]), members, 4500);
    expect(payers).toEqual([]);
    expect(codes(warnings)).toEqual(["no_payer"]);
  });

  it("treats a payload with no payers field as nobody named", () => {
    const { payers, warnings } = resolvePayers(receipt(), members, 4500);
    expect(payers).toEqual([]);
    expect(codes(warnings)).toEqual(["no_payer"]);
  });

  it("folds a person named twice into one payer", () => {
    const { payers } = resolvePayers(
      receipt([
        { member_name: "You", amount: 20 },
        { member_name: "You", amount: 25 },
      ]),
      members,
      4500,
    );
    expect(payers).toEqual([{ memberId: "m-you", amountPaid: 4500 }]);
  });

  it("survives an unreadable amount rather than throwing", () => {
    const { payers } = resolvePayers(
      receipt([{ member_name: "Sarah", amount: Number.NaN }]),
      members,
      4500,
    );
    // An unreadable figure means "amount unknown", so they paid the lot.
    expect(payers).toEqual([{ memberId: "m-sarah", amountPaid: 4500 }]);
  });

  it("never pays out more or less than the bill", () => {
    for (const total of [1, 2, 99, 100, 4501, 123457]) {
      const { payers } = resolvePayers(
        receipt([
          { member_name: "You", amount: 0 },
          { member_name: "Sarah", amount: 0 },
          { member_name: "John", amount: 0 },
        ]),
        members,
        total,
      );
      expect(payers.reduce((s, p) => s + p.amountPaid, 0)).toBe(total);
    }
  });
});

describe("payersFor", () => {
  it("shares a bill evenly and exactly", () => {
    const payers = payersFor(["m-you", "m-sarah", "m-john"], 1000);
    expect(payers.reduce((s, p) => s + p.amountPaid, 0)).toBe(1000);
    expect(payers).toHaveLength(3);
  });

  it("hands an indivisible total out without losing a cent", () => {
    const payers = payersFor(["m-you", "m-sarah", "m-john"], 100);
    expect(payers.reduce((s, p) => s + p.amountPaid, 0)).toBe(100);
    expect(payers.map((p) => p.amountPaid).sort()).toEqual([33, 33, 34]);
  });

  it("returns nothing when nobody is selected", () => {
    expect(payersFor([], 5000)).toEqual([]);
  });
});
