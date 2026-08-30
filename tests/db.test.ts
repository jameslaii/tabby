import { describe, expect, it } from "vitest";
import {
  DB_VERSION,
  addItemizedExpenses,
  addManualExpense,
  addMember,
  addSettlement,
  createGroup,
  currentMemberId,
  emptyDb,
  getExpenses,
  getGroup,
  getUncategorized,
  removeMember,
  reviveDb,
  setCategories,
  type Db,
} from "../lib/db";

/** A group of You + Sarah + John, and the db holding it. */
function withGroup() {
  const { db, group } = createGroup(emptyDb(), {
    name: "Lisbon",
    emoji: "🇵🇹",
    memberNames: ["Sarah", "John"],
  });
  const id = (name: string) =>
    group.members.find((m) => m.displayName === name)!.id;
  return { db, group, id };
}

describe("createGroup", () => {
  it("puts you in the group alongside everyone named", () => {
    const { group } = withGroup();
    expect(group.members.map((m) => m.displayName)).toEqual([
      "You",
      "Sarah",
      "John",
    ]);
    expect(group.members[0].isGhost).toBe(false);
    expect(group.members[1].isGhost).toBe(true);
  });

  it("drops blank names and duplicates", () => {
    const { group } = createGroup(emptyDb(), {
      name: "Trip",
      emoji: "✈️",
      // Two members with the same name can't be told apart when a receipt
      // says "Sam had the salmon", so only one survives.
      memberNames: ["Sam", "  ", "sam", "You", "Ana"],
    });
    expect(group.members.map((m) => m.displayName)).toEqual(["You", "Sam", "Ana"]);
  });

  it("falls back to a name rather than creating an untitled group", () => {
    const { group } = createGroup(emptyDb(), {
      name: "   ",
      emoji: "",
      memberNames: [],
    });
    expect(group.name).toBe("New group");
    expect(group.emoji).toBeTruthy();
  });

  it("logs the group's creation", () => {
    const { db, group } = withGroup();
    expect(db.activity.some((a) => a.groupId === group.id)).toBe(true);
  });

  it("resolves 'me' per group rather than globally", () => {
    const first = createGroup(emptyDb(), {
      name: "A",
      emoji: "🅰️",
      memberNames: [],
    });
    const second = createGroup(first.db, {
      name: "B",
      emoji: "🅱️",
      memberNames: [],
    });

    // The same person holds a different member row in each group, so one id
    // can't stand in for both.
    const meInA = currentMemberId(second.db, first.group.id);
    const meInB = currentMemberId(second.db, second.group.id);
    expect(meInA).not.toBeNull();
    expect(meInB).not.toBeNull();
    expect(meInA).not.toBe(meInB);
  });
});

describe("members", () => {
  it("refuses a name the group already has", () => {
    const { db, group } = withGroup();
    const result = addMember(db, group.id, "sarah");
    expect(result.error).toMatch(/already has someone/i);
    expect(getGroup(result.db, group.id)!.members).toHaveLength(3);
  });

  it("refuses a blank name", () => {
    const { db, group } = withGroup();
    expect(addMember(db, group.id, "   ").error).toBeTruthy();
  });

  it("removes someone who isn't on anything yet", () => {
    const { db, group, id } = withGroup();
    const result = removeMember(db, group.id, id("John"));
    expect(result.error).toBeUndefined();
    expect(getGroup(result.db, group.id)!.members).toHaveLength(2);
  });

  it("keeps someone who already owes or is owed", () => {
    const { db, group, id } = withGroup();
    const withExpense = addManualExpense(db, {
      groupId: group.id,
      description: "Taxi",
      category: null,
      amount: "30.00",
      payerId: id("You"),
      participantIds: [id("You"), id("Sarah"), id("John")],
    });

    // Their share is baked into what the others owe; dropping the row would
    // leave money owed to nobody.
    const result = removeMember(withExpense.db, group.id, id("John"));
    expect(result.error).toMatch(/already on an expense/i);
    expect(getGroup(result.db, group.id)!.members).toHaveLength(3);
  });

  it("won't let you remove yourself", () => {
    const { db, group, id } = withGroup();
    expect(removeMember(db, group.id, id("You")).error).toBeTruthy();
  });
});

describe("addManualExpense", () => {
  const base = () => {
    const { db, group, id } = withGroup();
    return {
      db,
      group,
      id,
      input: {
        groupId: group.id,
        description: "Groceries",
        category: null,
        amount: "30.00",
        payerId: id("You"),
        participantIds: [id("You"), id("Sarah"), id("John")],
      },
    };
  };

  it("splits equally and exactly", () => {
    const { db, group, input } = base();
    const result = addManualExpense(db, input);
    const [expense] = getExpenses(result.db, group.id);
    expect(expense.splits.reduce((s, x) => s + x.amountOwed, 0)).toBe(3000);
    expect(expense.payers).toEqual([
      { memberId: input.payerId, amountPaid: 3000 },
    ]);
  });

  it("hands out an indivisible amount without losing a cent", () => {
    const { db, group, input } = base();
    const result = addManualExpense(db, { ...input, amount: "10.00" });
    const [expense] = getExpenses(result.db, group.id);
    expect(expense.splits.map((s) => s.amountOwed).sort()).toEqual([333, 333, 334]);
  });

  it("rejects amounts that aren't money", () => {
    const { db, input } = base();
    expect(addManualExpense(db, { ...input, amount: "abc" }).error).toMatch(/number/i);
    expect(addManualExpense(db, { ...input, amount: "0" }).error).toMatch(/positive/i);
    expect(addManualExpense(db, { ...input, amount: "-5" }).error).toMatch(/positive/i);
  });

  it("rejects a payer or participant outside the group", () => {
    const { db, input } = base();
    expect(addManualExpense(db, { ...input, payerId: "nope" }).error).toMatch(/who paid/i);
    expect(
      addManualExpense(db, { ...input, participantIds: ["nope"] }).error,
    ).toMatch(/isn't in this group/i);
  });

  it("needs a description and someone to split with", () => {
    const { db, input } = base();
    expect(addManualExpense(db, { ...input, description: " " }).error).toBeTruthy();
    expect(addManualExpense(db, { ...input, participantIds: [] }).error).toBeTruthy();
  });

  it("de-duplicates participants so nobody is billed twice", () => {
    const { db, group, id, input } = base();
    const result = addManualExpense(db, {
      ...input,
      participantIds: [id("You"), id("You"), id("Sarah")],
    });
    const [expense] = getExpenses(result.db, group.id);
    expect(expense.splits).toHaveLength(2);
    expect(expense.splits.reduce((s, x) => s + x.amountOwed, 0)).toBe(3000);
  });
});

describe("addItemizedExpenses", () => {
  const receipt = (overrides: Partial<Parameters<typeof addItemizedExpenses>[2][number]> = {}) => ({
    description: "Dinner",
    totalCents: 3000,
    lineItems: [],
    splits: [],
    payers: [],
    rawComment: null,
    ...overrides,
  });

  it("saves an outing's receipts together", () => {
    const { db, group, id } = withGroup();
    const one = receipt({
      description: "Grab there",
      totalCents: 1000,
      splits: [{ memberId: id("You"), lineItemId: null, splitType: "exact" as const, shareValue: null, amountOwed: 1000 }],
      payers: [{ memberId: id("You"), amountPaid: 1000 }],
    });
    const two = receipt({
      description: "Grab back",
      totalCents: 2000,
      splits: [{ memberId: id("Sarah"), lineItemId: null, splitType: "exact" as const, shareValue: null, amountOwed: 2000 }],
      payers: [{ memberId: id("Sarah"), amountPaid: 2000 }],
    });

    const result = addItemizedExpenses(db, group.id, [one, two]);
    expect(result.error).toBeUndefined();
    expect(getExpenses(result.db, group.id)).toHaveLength(2);
  });

  it("writes nothing at all when one receipt is bad", () => {
    const { db, group, id } = withGroup();
    const good = receipt({
      totalCents: 1000,
      splits: [{ memberId: id("You"), lineItemId: null, splitType: "exact" as const, shareValue: null, amountOwed: 1000 }],
      payers: [{ memberId: id("You"), amountPaid: 1000 }],
    });
    const bad = receipt({ description: "Broken", payers: [] });

    // A half-saved outing leaves balances that are real but incomplete, and
    // nothing on the group page says which half made it.
    const result = addItemizedExpenses(db, group.id, [good, bad]);
    expect(result.error).toMatch(/who paid/i);
    expect(getExpenses(result.db, group.id)).toHaveLength(0);
  });

  it("refuses payments that don't match the bill", () => {
    const { db, group, id } = withGroup();
    const result = addItemizedExpenses(db, group.id, [
      receipt({
        totalCents: 1000,
        splits: [{ memberId: id("You"), lineItemId: null, splitType: "exact" as const, shareValue: null, amountOwed: 1000 }],
        payers: [{ memberId: id("You"), amountPaid: 900 }],
      }),
    ]);
    expect(result.error).toMatch(/doesn't match its total/i);
  });

  it("refuses a payer who isn't in the group", () => {
    const { db, group, id } = withGroup();
    const result = addItemizedExpenses(db, group.id, [
      receipt({
        totalCents: 1000,
        splits: [{ memberId: id("You"), lineItemId: null, splitType: "exact" as const, shareValue: null, amountOwed: 1000 }],
        payers: [{ memberId: "stranger", amountPaid: 1000 }],
      }),
    ]);
    expect(result.error).toMatch(/isn't in this group/i);
  });

  it("refuses splits that don't add up to the total", () => {
    const { db, group, id } = withGroup();
    const result = addItemizedExpenses(db, group.id, [
      receipt({
        totalCents: 1000,
        splits: [{ memberId: id("You"), lineItemId: null, splitType: "exact" as const, shareValue: null, amountOwed: 400 }],
        payers: [{ memberId: id("You"), amountPaid: 1000 }],
      }),
    ]);
    expect(result.error).toMatch(/doesn't add up/i);
  });
});

describe("settlements", () => {
  it("records a payment between two members", () => {
    const { db, group, id } = withGroup();
    const result = addSettlement(db, {
      groupId: group.id,
      fromMember: id("Sarah"),
      toMember: id("You"),
      amount: "12.50",
      note: null,
    });
    expect(result.error).toBeUndefined();
    expect(result.db.settlements[0].amount).toBe(1250);
  });

  it("refuses a stranger, a self-payment, or a bad amount", () => {
    const { db, group, id } = withGroup();
    const settle = (over: Record<string, string>) =>
      addSettlement(db, {
        groupId: group.id,
        fromMember: id("Sarah"),
        toMember: id("You"),
        amount: "10.00",
        note: null,
        ...over,
      }).error;

    expect(settle({ toMember: "stranger" })).toMatch(/in this group/i);
    expect(settle({ toMember: id("Sarah") })).toMatch(/themselves/i);
    expect(settle({ amount: "0" })).toMatch(/positive/i);
    expect(settle({ amount: "nope" })).toMatch(/number/i);
  });
});

describe("categories", () => {
  it("never overwrites one a person chose", () => {
    const { db, group, id } = withGroup();
    const added = addManualExpense(db, {
      groupId: group.id,
      description: "Corner shop",
      category: "Groceries",
      amount: "8.00",
      payerId: id("You"),
      participantIds: [id("You")],
    });
    const expense = getExpenses(added.db, group.id)[0];

    const next = setCategories(added.db, group.id, { [expense.id]: "Dining" });
    expect(getExpenses(next, group.id)[0].category).toBe("Groceries");
  });

  it("lists only expenses still waiting for one", () => {
    const { db, group, id } = withGroup();
    const added = addManualExpense(db, {
      groupId: group.id,
      description: "Taxi",
      category: null,
      amount: "8.00",
      payerId: id("You"),
      participantIds: [id("You")],
    });
    expect(getUncategorized(added.db, group.id)).toHaveLength(1);

    const expense = getExpenses(added.db, group.id)[0];
    const next = setCategories(added.db, group.id, { [expense.id]: "Transport" });
    expect(getUncategorized(next, group.id)).toHaveLength(0);
  });
});

describe("reviveDb", () => {
  it("restores a database it wrote", () => {
    const { db } = withGroup();
    expect(reviveDb(JSON.parse(JSON.stringify(db))).groups).toHaveLength(1);
  });

  it("starts fresh rather than guessing at anything unrecognised", () => {
    // A half-understood expense is a wrong balance, which is worse than an
    // empty app.
    expect(reviveDb(null).groups).toEqual([]);
    expect(reviveDb("nonsense").groups).toEqual([]);
    expect(reviveDb({ version: DB_VERSION + 1, groups: [{}] }).groups).toEqual([]);
    expect(reviveDb({ version: DB_VERSION, groups: "no" } as unknown as Db).groups).toEqual([]);
  });
});
