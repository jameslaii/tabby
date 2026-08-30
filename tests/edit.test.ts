import { describe, expect, it } from "vitest";
import {
  addItemizedExpenses,
  addManualExpense,
  createGroup,
  deleteExpense,
  emptyDb,
  getExpense,
  getExpenses,
  splitWillReset,
  updateExpense,
  type Db,
} from "../lib/db";
import { computeBalances } from "../lib/balances";
import type { Expense } from "../lib/types";

/**
 * Correcting an expense after the fact.
 *
 * The rule under test throughout: a split is only rebuilt when it has to be.
 * Renaming an expense or fixing who paid must leave an itemized receipt's
 * split alone, because nothing could reconstruct it; changing the total or the
 * people has to rebuild it, because the old numbers can no longer be true.
 */

function setup() {
  const { db, group } = createGroup(emptyDb(), {
    name: "Trip",
    emoji: "✈️",
    memberNames: ["Sarah", "John"],
  });
  const id = (name: string) =>
    group.members.find((m) => m.displayName === name)!.id;
  return { db, group, id };
}

/** A manual $30 expense split three ways, paid by You. */
function withManual() {
  const { db, group, id } = setup();
  const added = addManualExpense(db, {
    groupId: group.id,
    description: "Groceries",
    category: null,
    amount: "30.00",
    payerId: id("You"),
    participantIds: [id("You"), id("Sarah"), id("John")],
  });
  return {
    db: added.db,
    group,
    id,
    expense: getExpenses(added.db, group.id)[0],
  };
}

/** A scanned $30 receipt whose split is deliberately uneven. */
function withReceipt() {
  const { db, group, id } = setup();
  const added = addItemizedExpenses(db, group.id, [
    {
      description: "Dinner",
      totalCents: 3000,
      lineItems: [
        {
          id: "li-1",
          description: "Steak",
          quantity: 1,
          unitPrice: 2000,
          lineTotal: 2000,
        },
        {
          id: "li-2",
          description: "Salad",
          quantity: 1,
          unitPrice: 1000,
          lineTotal: 1000,
        },
      ],
      splits: [
        { memberId: id("Sarah"), lineItemId: null, splitType: "exact", shareValue: null, amountOwed: 2000 },
        { memberId: id("John"), lineItemId: null, splitType: "exact", shareValue: null, amountOwed: 1000 },
      ],
      payers: [{ memberId: id("You"), amountPaid: 3000 }],
      rawComment: "Sarah had the steak",
    },
  ]);
  return {
    db: added.db,
    group,
    id,
    expense: getExpenses(added.db, group.id)[0],
  };
}

const edit = (expense: Expense, over: Record<string, unknown> = {}) => ({
  description: expense.description,
  category: expense.category,
  amount: (expense.totalAmount / 100).toFixed(2),
  payerIds: expense.payers.map((p) => p.memberId),
  participantIds: expense.splits.map((s) => s.memberId),
  ...over,
});

const netOf = (db: Db, groupId: string, members: { id: string }[]) =>
  computeBalances(
    members as never,
    getExpenses(db, groupId),
    [],
  ).reduce((sum, b) => sum + b.net, 0);

describe("editing without disturbing the split", () => {
  it("renames an itemized expense and leaves its numbers alone", () => {
    const { db, expense, group } = withReceipt();
    const result = updateExpense(db, expense.id, {
      ...edit(expense),
      description: "Dinner at Locavore",
    });

    const after = getExpense(result.db, expense.id)!;
    expect(result.error).toBeUndefined();
    expect(after.description).toBe("Dinner at Locavore");
    expect(after.splits).toEqual(expense.splits);
    expect(after.lineItems).toHaveLength(2);
    expect(netOf(result.db, group.id, group.members)).toBe(0);
  });

  it("fixes who paid without touching who owes", () => {
    const { db, expense, id } = withReceipt();
    const result = updateExpense(db, expense.id, {
      ...edit(expense),
      payerIds: [id("Sarah")],
    });

    const after = getExpense(result.db, expense.id)!;
    expect(after.payers).toEqual([{ memberId: id("Sarah"), amountPaid: 3000 }]);
    // The uneven itemized split survives — nothing could rebuild it.
    expect(after.splits).toEqual(expense.splits);
    expect(after.lineItems).toHaveLength(2);
  });

  it("records a category the person picked as theirs", () => {
    const { db, expense } = withManual();
    const result = updateExpense(db, expense.id, {
      ...edit(expense),
      category: "Groceries",
    });

    const after = getExpense(result.db, expense.id)!;
    expect(after.category).toBe("Groceries");
    expect(after.categorySource).toBe("manual");
  });

  it("splits the bill between several payers", () => {
    const { db, expense, id } = withManual();
    const result = updateExpense(db, expense.id, {
      ...edit(expense),
      payerIds: [id("You"), id("Sarah")],
    });

    const after = getExpense(result.db, expense.id)!;
    expect(after.payers.reduce((s, p) => s + p.amountPaid, 0)).toBe(3000);
    expect(after.payers).toHaveLength(2);
  });
});

describe("editing that has to rebuild the split", () => {
  it("re-splits evenly and drops line items when the total changes", () => {
    const { db, expense, group } = withReceipt();
    const result = updateExpense(db, expense.id, {
      ...edit(expense),
      amount: "36.00",
    });

    const after = getExpense(result.db, expense.id)!;
    expect(after.totalAmount).toBe(3600);
    expect(after.splits.reduce((s, x) => s + x.amountOwed, 0)).toBe(3600);
    // The old items summed to the old total and would now contradict it.
    expect(after.lineItems).toEqual([]);
    expect(netOf(result.db, group.id, group.members)).toBe(0);
  });

  it("re-splits when someone joins or leaves", () => {
    const { db, expense, id, group } = withReceipt();
    const result = updateExpense(db, expense.id, {
      ...edit(expense),
      participantIds: [id("You"), id("Sarah"), id("John")],
    });

    const after = getExpense(result.db, expense.id)!;
    expect(after.splits).toHaveLength(3);
    expect(after.splits.every((s) => s.amountOwed === 1000)).toBe(true);
    expect(after.lineItems).toEqual([]);
    expect(netOf(result.db, group.id, group.members)).toBe(0);
  });

  it("moves the payers' amounts to the new total", () => {
    const { db, expense, id } = withManual();
    const result = updateExpense(db, expense.id, {
      ...edit(expense),
      amount: "45.00",
      payerIds: [id("You"), id("Sarah")],
    });

    const after = getExpense(result.db, expense.id)!;
    expect(after.payers.reduce((s, p) => s + p.amountPaid, 0)).toBe(4500);
  });

  it("keeps an indivisible total exact", () => {
    const { db, expense } = withManual();
    const result = updateExpense(db, expense.id, { ...edit(expense), amount: "10.00" });

    const after = getExpense(result.db, expense.id)!;
    expect(after.splits.map((s) => s.amountOwed).sort()).toEqual([333, 333, 334]);
  });
});

describe("splitWillReset", () => {
  it("warns only when an itemized split is actually at risk", () => {
    const { expense, id } = withReceipt();
    const people = expense.splits.map((s) => s.memberId);

    expect(splitWillReset(expense, 3000, people)).toBe(false);
    expect(splitWillReset(expense, 3600, people)).toBe(true);
    expect(splitWillReset(expense, 3000, [...people, id("You")])).toBe(true);
  });

  it("says nothing about an expense that was never itemized", () => {
    const { expense } = withManual();
    expect(splitWillReset(expense, 9900, [expense.splits[0].memberId])).toBe(false);
  });
});

describe("rejecting bad edits", () => {
  it("refuses amounts that aren't money", () => {
    const { db, expense } = withManual();
    expect(updateExpense(db, expense.id, { ...edit(expense), amount: "abc" }).error).toMatch(/number/i);
    expect(updateExpense(db, expense.id, { ...edit(expense), amount: "0" }).error).toMatch(/positive/i);
  });

  it("refuses a payer or participant outside the group", () => {
    const { db, expense } = withManual();
    expect(updateExpense(db, expense.id, { ...edit(expense), payerIds: ["nope"] }).error).toMatch(/isn't in this group/i);
    expect(updateExpense(db, expense.id, { ...edit(expense), participantIds: ["nope"] }).error).toMatch(/isn't in this group/i);
  });

  it("refuses an empty description, payer list or split", () => {
    const { db, expense } = withManual();
    expect(updateExpense(db, expense.id, { ...edit(expense), description: "  " }).error).toBeTruthy();
    expect(updateExpense(db, expense.id, { ...edit(expense), payerIds: [] }).error).toBeTruthy();
    expect(updateExpense(db, expense.id, { ...edit(expense), participantIds: [] }).error).toBeTruthy();
  });

  it("leaves the database untouched when it refuses", () => {
    const { db, expense } = withManual();
    const result = updateExpense(db, expense.id, { ...edit(expense), amount: "-5" });
    expect(result.db).toBe(db);
    expect(getExpense(result.db, expense.id)!.totalAmount).toBe(3000);
  });

  it("handles an expense that has already been deleted", () => {
    const { db, expense } = withManual();
    const gone = deleteExpense(db, expense.id);
    expect(updateExpense(gone, expense.id, edit(expense)).error).toMatch(/no longer exists/i);
  });
});

describe("deleting", () => {
  it("takes the expense off everyone's balance", () => {
    const { db, expense, group } = withManual();
    const after = deleteExpense(db, expense.id);

    expect(getExpenses(after, group.id)).toHaveLength(0);
    expect(computeBalances(group.members, [], []).every((b) => b.net === 0)).toBe(true);
    expect(netOf(after, group.id, group.members)).toBe(0);
  });

  it("leaves a trace in the activity log", () => {
    const { db, expense, group } = withManual();
    const after = deleteExpense(db, expense.id);
    expect(
      after.activity.some(
        (a) => a.groupId === group.id && a.action === "expense_deleted",
      ),
    ).toBe(true);
  });

  it("shrugs at an id that isn't there", () => {
    const { db } = withManual();
    expect(deleteExpense(db, "nope")).toBe(db);
  });
});
