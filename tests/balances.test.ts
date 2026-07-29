import { describe, expect, it } from "vitest";
import { computeBalances, simplifyDebts, type Balance } from "../lib/balances";
import type { Expense, GroupMember, Settlement } from "../lib/types";
import { member } from "./helpers";

const members: GroupMember[] = [
  member("a", "Ana"),
  member("b", "Ben"),
  member("c", "Cleo"),
];

function expense(
  payers: [string, number][],
  splits: [string, number][],
): Expense {
  return {
    id: crypto.randomUUID(),
    groupId: "g1",
    description: "Test",
    category: null,
    categorySource: null,
    totalAmount: splits.reduce((s, [, amount]) => s + amount, 0),
    currency: "USD",
    expenseDate: "2026-07-27",
    sourceType: "manual",
    receiptImageUrl: null,
    rawComment: null,
    rawTranscript: null,
    lineItems: [],
    payers: payers.map(([memberId, amountPaid]) => ({ memberId, amountPaid })),
    splits: splits.map(([memberId, amountOwed]) => ({
      memberId,
      lineItemId: null,
      splitType: "equal" as const,
      shareValue: null,
      amountOwed,
    })),
    createdAt: new Date().toISOString(),
  };
}

function settlement(from: string, to: string, amount: number): Settlement {
  return {
    id: crypto.randomUUID(),
    groupId: "g1",
    fromMember: from,
    toMember: to,
    amount,
    currency: "USD",
    note: null,
    settledAt: new Date().toISOString(),
  };
}

const net = (balances: Balance[]) =>
  Object.fromEntries(balances.map((b) => [b.memberId, b.net]));

describe("computeBalances", () => {
  it("credits the payer and debits everyone's share", () => {
    const balances = computeBalances(
      members,
      [expense([["a", 3000]], [["a", 1000], ["b", 1000], ["c", 1000]])],
      [],
    );
    expect(net(balances)).toEqual({ a: 2000, b: -1000, c: -1000 });
  });

  it("handles an expense paid across two cards", () => {
    const balances = computeBalances(
      members,
      [expense([["a", 2000], ["b", 1000]], [["a", 1000], ["b", 1000], ["c", 1000]])],
      [],
    );
    expect(net(balances)).toEqual({ a: 1000, b: 0, c: -1000 });
  });

  it("moves a settlement from sender to recipient", () => {
    const balances = computeBalances(
      members,
      [expense([["a", 3000]], [["a", 1000], ["b", 1000], ["c", 1000]])],
      [settlement("b", "a", 1000)],
    );
    expect(net(balances)).toEqual({ a: 1000, b: 0, c: -1000 });
  });

  it("always sums to zero across the group", () => {
    const balances = computeBalances(
      members,
      [
        expense([["a", 5000]], [["a", 1667], ["b", 1667], ["c", 1666]]),
        expense([["c", 999]], [["a", 333], ["b", 333], ["c", 333]]),
      ],
      [settlement("b", "c", 500)],
    );
    expect(balances.reduce((s, b) => s + b.net, 0)).toBe(0);
  });

  it("ignores rows referencing a member of another group", () => {
    // The schema's foreign keys point at group_members(id) globally, so
    // nothing stops a settlement from naming someone in a different group.
    const balances = computeBalances(
      members,
      [expense([["a", 1000]], [["a", 500], ["stranger", 500]])],
      [],
    );
    expect(net(balances)).toEqual({ a: 500, b: 0, c: 0 });
  });
});

describe("simplifyDebts", () => {
  const balances = (entries: [string, number][]): Balance[] =>
    entries.map(([memberId, netAmount]) => ({
      memberId,
      displayName: memberId,
      net: netAmount,
    }));

  /** Replaying the transfers must zero every balance. */
  function assertSettles(input: Balance[]) {
    const transfers = simplifyDebts(input);
    const after = new Map(input.map((b) => [b.memberId, b.net]));
    for (const t of transfers) {
      after.set(t.fromMemberId, (after.get(t.fromMemberId) ?? 0) + t.amount);
      after.set(t.toMemberId, (after.get(t.toMemberId) ?? 0) - t.amount);
    }
    for (const [, value] of after) expect(value).toBe(0);
    return transfers;
  }

  it("returns nothing when everyone is square", () => {
    expect(simplifyDebts(balances([["a", 0], ["b", 0]]))).toEqual([]);
  });

  it("settles the simple two-person case", () => {
    const transfers = assertSettles(balances([["a", 2000], ["b", -2000]]));
    expect(transfers).toEqual([{ fromMemberId: "b", toMemberId: "a", amount: 2000 }]);
  });

  it("collapses a cycle to nothing", () => {
    // A owes B, B owes C, C owes A — all for the same amount.
    expect(assertSettles(balances([["a", 0], ["b", 0], ["c", 0]]))).toEqual([]);
  });

  it("uses at most n-1 transfers", () => {
    const input = balances([
      ["a", 5000], ["b", 3000], ["c", -2000], ["d", -1500], ["e", -4500],
    ]);
    const transfers = assertSettles(input);
    expect(transfers.length).toBeLessThanOrEqual(input.length - 1);
  });

  it("handles one debtor owing many creditors", () => {
    const transfers = assertSettles(
      balances([["a", 1000], ["b", 1000], ["c", 1000], ["d", -3000]]),
    );
    expect(transfers).toHaveLength(3);
    expect(transfers.every((t) => t.fromMemberId === "d")).toBe(true);
  });

  it("never emits a self-payment or a non-positive amount", () => {
    const transfers = assertSettles(
      balances([["a", 700], ["b", -250], ["c", -450]]),
    );
    for (const t of transfers) {
      expect(t.fromMemberId).not.toBe(t.toMemberId);
      expect(t.amount).toBeGreaterThan(0);
    }
  });

  it("refuses to run on balances that don't sum to zero", () => {
    expect(() => simplifyDebts(balances([["a", 1000], ["b", -900]]))).toThrow(
      /sum to zero/,
    );
  });

  it("settles random groups without losing or inventing a cent", () => {
    let seed = 4242;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let n = 0; n < 300; n++) {
      const size = 2 + Math.floor(rng() * 7);
      const raw = Array.from({ length: size }, (_, i) => ({
        memberId: `m${i}`,
        displayName: `m${i}`,
        net: Math.round((rng() - 0.5) * 20000),
      }));
      // Force the group to balance, the way real expense data does.
      const drift = raw.reduce((s, b) => s + b.net, 0);
      raw[0].net -= drift;

      const transfers = assertSettles(raw);
      expect(transfers.length).toBeLessThanOrEqual(size - 1);
    }
  });
});
