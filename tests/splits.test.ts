import { describe, expect, it } from "vitest";
import { computeFinalSplits } from "../lib/splits";
import type { GroupMember, ParsedReceipt } from "../lib/types";
import { member } from "./helpers";

const members: GroupMember[] = [
  member("m1", "Sarah"),
  member("m2", "John"),
  member("m3", "Alex"),
];

function receipt(overrides: Partial<ParsedReceipt> = {}): ParsedReceipt {
  return {
    line_items: [],
    subtotal: 0,
    tax: 0,
    tip: 0,
    other_charges: 0,
    grand_total: 0,
    assignments: [],
    unresolved_items: [],
    ...overrides,
  };
}

const owed = (r: ReturnType<typeof computeFinalSplits>) =>
  Object.fromEntries(r.splits.map((s) => [s.memberName, s.amountOwed]));
const codes = (r: ReturnType<typeof computeFinalSplits>) =>
  r.warnings.map((w) => w.code);

/**
 * Regressions for the six failures reproduced against the original draft of
 * computeFinalSplits (see docs/TEST_PLAN.md). Every one was silent: no throw,
 * no warning, just a wrong number.
 */
describe("computeFinalSplits — regressions", () => {
  it("A: splits a WHOLE_BILL assignment instead of billing one person", () => {
    const result = computeFinalSplits(
      receipt({
        subtotal: 90,
        tax: 8,
        tip: 12,
        grand_total: 110,
        assignments: [
          {
            line_item_temp_id: "WHOLE_BILL",
            member_names: ["Sarah", "John", "Alex"],
            split_type: "equal",
            shares: [],
          },
        ],
      }),
      members,
    );

    // Was: Sarah=11000, John=0, Alex=0
    expect(owed(result)).toEqual({ Sarah: 3667, John: 3667, Alex: 3666 });
    expect(result.totalCents).toBe(11000);
  });

  it("B: flags an unmatched name instead of re-billing the item to someone", () => {
    const result = computeFinalSplits(
      receipt({
        line_items: [
          { temp_id: "i1", description: "Salmon", quantity: 1, unit_price: 80, line_total: 80 },
          { temp_id: "i2", description: "Fries", quantity: 1, unit_price: 10, line_total: 10 },
        ],
        subtotal: 90,
        grand_total: 90,
        assignments: [
          { line_item_temp_id: "i1", member_names: ["Sara"], split_type: "equal", shares: [] },
          {
            line_item_temp_id: "i2",
            member_names: ["Sarah", "John", "Alex"],
            split_type: "equal",
            shares: [],
          },
        ],
      }),
      members,
    );

    // Was: Sarah=8334, John=333, Alex=333 — the $80 salmon landed on Sarah
    // purely because she was first in the array.
    expect(codes(result)).toContain("unknown_member_name");
    expect(codes(result)).toContain("unassigned_item");
    // The salmon falls back to everyone, so the $90 lands within a cent of
    // even — not $83 on one person and $3 on the others.
    expect(owed(result)).toEqual({ Sarah: 3001, John: 3000, Alex: 2999 });
    const amounts = result.splits.map((s) => s.amountOwed);
    expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(2);
    expect(result.totalCents).toBe(9000);
  });

  it("C: survives zero share weights without producing NaN", () => {
    const result = computeFinalSplits(
      receipt({
        line_items: [
          { temp_id: "i1", description: "Wine", quantity: 1, unit_price: 60, line_total: 60 },
        ],
        subtotal: 60,
        grand_total: 60,
        assignments: [
          {
            line_item_temp_id: "i1",
            member_names: ["Sarah", "John"],
            split_type: "shares",
            shares: [0, 0],
          },
        ],
      }),
      members,
    );

    // Was: Sarah=NaN, John=NaN
    expect(result.splits.every((s) => Number.isFinite(s.amountOwed))).toBe(true);
    expect(codes(result)).toContain("invalid_shares");
    expect(owed(result)).toEqual({ Sarah: 3000, John: 3000, Alex: 0 });
  });

  it("D: refuses to guess between two members with the same name", () => {
    const twoJohns: GroupMember[] = [
      member("m1", "John"),
      member("m2", "John"),
    ];
    const result = computeFinalSplits(
      receipt({
        line_items: [
          { temp_id: "i1", description: "Pizza", quantity: 1, unit_price: 30, line_total: 30 },
        ],
        subtotal: 30,
        grand_total: 30,
        assignments: [
          { line_item_temp_id: "i1", member_names: ["John"], split_type: "equal", shares: [] },
        ],
      }),
      twoJohns,
    );

    // Was: first John silently charged $0, second charged the whole $30.
    expect(codes(result)).toContain("ambiguous_member_name");
    expect(result.splits.map((s) => s.amountOwed)).toEqual([1500, 1500]);
  });

  it("E: still gets the classic $10-three-ways penny split right", () => {
    const result = computeFinalSplits(
      receipt({
        line_items: [
          { temp_id: "i1", description: "Nachos", quantity: 1, unit_price: 10, line_total: 10 },
        ],
        subtotal: 10,
        grand_total: 10,
        assignments: [
          {
            line_item_temp_id: "i1",
            member_names: ["Sarah", "John", "Alex"],
            split_type: "equal",
            shares: [],
          },
        ],
      }),
      members,
    );

    expect(Object.values(owed(result)).sort((x, y) => x - y)).toEqual([333, 333, 334]);
    expect(result.totalCents).toBe(1000);
    expect(result.warnings).toHaveLength(0);
  });

  it("F: flags a misread grand total rather than absorbing it", () => {
    const result = computeFinalSplits(
      receipt({
        line_items: [
          { temp_id: "i1", description: "Dinner", quantity: 1, unit_price: 90, line_total: 90 },
        ],
        subtotal: 90,
        tax: 10,
        grand_total: 1000, // OCR read $100.00 as $1000
        assignments: [
          {
            line_item_temp_id: "i1",
            member_names: ["Sarah", "John", "Alex"],
            split_type: "equal",
            shares: [],
          },
        ],
      }),
      members,
    );

    // Was: Sarah=93334 — $933.34 billed to one person, silently.
    expect(codes(result)).toContain("total_mismatch");
    expect(owed(result)).toEqual({ Sarah: 3334, John: 3333, Alex: 3333 });
    expect(result.totalCents).toBe(10000);
  });
});

describe("computeFinalSplits — behaviour", () => {
  it("weights an explicit shares split", () => {
    const result = computeFinalSplits(
      receipt({
        line_items: [
          { temp_id: "i1", description: "Drinks", quantity: 3, unit_price: 10, line_total: 30 },
        ],
        subtotal: 30,
        grand_total: 30,
        assignments: [
          {
            line_item_temp_id: "i1",
            member_names: ["Sarah", "John"],
            split_type: "shares",
            shares: [2, 1],
          },
        ],
      }),
      members,
    );
    expect(owed(result)).toEqual({ Sarah: 2000, John: 1000, Alex: 0 });
  });

  it("keeps share weights aligned when a name doesn't resolve", () => {
    const result = computeFinalSplits(
      receipt({
        line_items: [
          { temp_id: "i1", description: "Drinks", quantity: 3, unit_price: 10, line_total: 30 },
        ],
        subtotal: 30,
        grand_total: 30,
        assignments: [
          {
            line_item_temp_id: "i1",
            member_names: ["Ghost", "Sarah", "John"],
            split_type: "shares",
            shares: [99, 2, 1],
          },
        ],
      }),
      members,
    );
    // Sarah keeps her weight of 2 and John his 1 — the dropped name must not
    // shift the remaining weights onto the wrong people.
    expect(owed(result)).toEqual({ Sarah: 2000, John: 1000, Alex: 0 });
    expect(codes(result)).toContain("unknown_member_name");
  });

  it("matches names case- and accent-insensitively", () => {
    const jose: GroupMember[] = [member("m1", "José")];
    const result = computeFinalSplits(
      receipt({
        line_items: [
          { temp_id: "i1", description: "Tacos", quantity: 1, unit_price: 12, line_total: 12 },
        ],
        subtotal: 12,
        grand_total: 12,
        assignments: [
          { line_item_temp_id: "i1", member_names: ["  jose "], split_type: "equal", shares: [] },
        ],
      }),
      jose,
    );
    expect(result.splits[0].amountOwed).toBe(1200);
    expect(result.warnings).toHaveLength(0);
  });

  it("spreads tax and tip in proportion to what each person ate", () => {
    const result = computeFinalSplits(
      receipt({
        line_items: [
          { temp_id: "i1", description: "Steak", quantity: 1, unit_price: 60, line_total: 60 },
          { temp_id: "i2", description: "Soup", quantity: 1, unit_price: 20, line_total: 20 },
        ],
        subtotal: 80,
        tax: 8,
        tip: 12,
        grand_total: 100,
        assignments: [
          { line_item_temp_id: "i1", member_names: ["Sarah"], split_type: "equal", shares: [] },
          { line_item_temp_id: "i2", member_names: ["John"], split_type: "equal", shares: [] },
        ],
      }),
      members,
    );
    // Sarah ate 75% of the food, so she carries 75% of the $20 in extras.
    expect(owed(result)).toEqual({ Sarah: 7500, John: 2500, Alex: 0 });
  });

  it("passes the model's own unresolved_items through to the review screen", () => {
    const result = computeFinalSplits(
      receipt({
        subtotal: 10,
        grand_total: 10,
        assignments: [
          {
            line_item_temp_id: "WHOLE_BILL",
            member_names: ["Sarah", "John", "Alex"],
            split_type: "equal",
            shares: [],
          },
        ],
        unresolved_items: [{ line_item_temp_id: "i9", reason: "Couldn't read the handwriting" }],
      }),
      members,
    );
    expect(result.warnings).toContainEqual({
      code: "model_flagged",
      message: "Couldn't read the handwriting",
      lineItemTempId: "i9",
    });
  });

  it("handles a bill that is entirely fees", () => {
    const result = computeFinalSplits(
      receipt({ subtotal: 0, other_charges: 10, grand_total: 10 }),
      members,
    );
    expect(Object.values(owed(result)).sort((x, y) => x - y)).toEqual([333, 333, 334]);
    expect(result.totalCents).toBe(1000);
  });

  it("returns nothing for an empty group instead of dividing by zero", () => {
    const result = computeFinalSplits(receipt({ subtotal: 50, grand_total: 50 }), []);
    expect(result.splits).toEqual([]);
    expect(result.totalCents).toBe(0);
  });
});

describe("computeFinalSplits — invariants", () => {
  // A deterministic pseudo-random generator, so a failure is reproducible.
  function makeRng(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }

  function randomReceipt(rng: () => number, names: string[]): ParsedReceipt {
    const itemCount = 1 + Math.floor(rng() * 6);
    const line_items = Array.from({ length: itemCount }, (_, i) => {
      const total = Math.round(rng() * 9000) / 100;
      return {
        temp_id: `i${i}`,
        description: `Item ${i}`,
        quantity: 1,
        unit_price: total,
        line_total: total,
      };
    });
    const assignments = line_items.map((item) => {
      const picked = names.filter(() => rng() > 0.45);
      const chosen = picked.length > 0 ? picked : [names[0]];
      const useShares = rng() > 0.7;
      return {
        line_item_temp_id: item.temp_id,
        member_names: chosen,
        split_type: (useShares ? "shares" : "equal") as "shares" | "equal",
        shares: chosen.map(() => 1 + Math.floor(rng() * 3)),
      };
    });
    const subtotal =
      Math.round(line_items.reduce((s, i) => s + i.line_total, 0) * 100) / 100;
    const tax = Math.round(subtotal * 8) / 100;
    const tip = Math.round(subtotal * 18) / 100;
    return {
      line_items,
      subtotal,
      tax,
      tip,
      other_charges: 0,
      grand_total: Math.round((subtotal + tax + tip) * 100) / 100,
      assignments,
      unresolved_items: [],
    };
  }

  it("always sums to exactly the reconciled total, with no drift", () => {
    const rng = makeRng(20260727);
    const names = members.map((m) => m.displayName);
    for (let n = 0; n < 500; n++) {
      const parsed = randomReceipt(rng, names);
      const result = computeFinalSplits(parsed, members);
      const sum = result.splits.reduce((s, x) => s + x.amountOwed, 0);

      expect(sum).toBe(result.totalCents);
      expect(result.splits.every((s) => Number.isInteger(s.amountOwed))).toBe(true);
      // The reconciled total must match the receipt to the cent — no
      // unbounded remainder quietly parked on one member.
      expect(result.totalCents).toBe(Math.round(parsed.grand_total * 100));
    }
  });

  it("bills the same people the same amounts regardless of member ordering", () => {
    const rng = makeRng(99);
    const names = members.map((m) => m.displayName);
    for (let n = 0; n < 200; n++) {
      const parsed = randomReceipt(rng, names);
      const forward = computeFinalSplits(parsed, members);
      const reversed = computeFinalSplits(parsed, [...members].reverse());

      const asMap = (r: typeof forward) =>
        Object.fromEntries(r.splits.map((s) => [s.memberId, s.amountOwed]));
      expect(asMap(reversed)).toEqual(asMap(forward));
    }
  });
});
