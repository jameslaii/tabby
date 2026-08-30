import { describe, expect, it } from "vitest";
import { formatCents, toCents, apportion, convertMinor } from "../lib/money";
import { minorUnits, isCurrency, DEFAULT_CURRENCY } from "../lib/currencies";
import {
  addManualExpense,
  addSettlement,
  createGroup,
  emptyDb,
  getExpense,
  getExpenses,
  getSettlements,
  updateExpense,
} from "../lib/db";
import { computeBalances } from "../lib/balances";

/**
 * Money in a currency that isn't the dollar.
 *
 * The hazard being pinned here: not every currency is divided into hundredths.
 * The yen, the won and the dong have no minor unit at all, so treating a typed
 * "1000" as a hundred-fold quantity of some non-existent sub-yen is wrong by
 * exactly 100x — in an app whose entire job is being right about money.
 */

describe("currencies without cents", () => {
  it("knows which currencies have a minor unit", () => {
    expect(minorUnits("USD")).toBe(2);
    expect(minorUnits("EUR")).toBe(2);
    expect(minorUnits("SGD")).toBe(2);
    expect(minorUnits("JPY")).toBe(0);
    expect(minorUnits("KRW")).toBe(0);
    expect(minorUnits("VND")).toBe(0);
  });

  it("falls back to two places for a code it doesn't recognise", () => {
    expect(minorUnits("ZZZ")).toBe(2);
  });

  it("parses a whole-unit currency without inflating it", () => {
    expect(toCents("1000", "JPY")).toBe(1000);
    expect(toCents("1000", "USD")).toBe(100000);
    expect(toCents(1000, "VND")).toBe(1000);
  });

  it("rounds a stray decimal onto the whole unit", () => {
    // There is no half-yen to round to, so it rounds to the yen.
    expect(toCents("1000.5", "JPY")).toBe(1001);
    expect(toCents("1000.4", "JPY")).toBe(1000);
  });

  it("formats without inventing decimals", () => {
    const yen = formatCents(1000, "JPY");
    expect(yen).toContain("1,000");
    expect(yen).not.toContain("10.00");
    expect(formatCents(1000, "USD")).toBe("$10.00");
  });

  it("still splits a whole-unit total exactly", () => {
    // 1000 yen three ways is 333/333/334 yen, not 3.33.
    const parts = apportion(toCents("1000", "JPY"), [1, 1, 1], ["a", "b", "c"]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect([...parts].sort()).toEqual([333, 333, 334]);
  });
});

describe("a group carries its currency", () => {
  const setup = (currency?: string) =>
    createGroup(emptyDb(), {
      name: "Tokyo",
      emoji: "✈️",
      memberNames: ["Sarah"],
      currency,
    });

  it("stamps the chosen currency on the group", () => {
    expect(setup("JPY").group.defaultCurrency).toBe("JPY");
  });

  it("falls back to the default when none is given or it isn't real", () => {
    expect(setup().group.defaultCurrency).toBe(DEFAULT_CURRENCY);
    expect(setup("NOPE").group.defaultCurrency).toBe(DEFAULT_CURRENCY);
    expect(isCurrency("NOPE")).toBe(false);
    expect(isCurrency("JPY")).toBe(true);
  });

  it("denominates expenses in the group's currency, not the dollar", () => {
    const { db, group } = setup("JPY");
    const you = group.members.find((m) => m.displayName === "You")!;
    const sarah = group.members.find((m) => m.displayName === "Sarah")!;

    const added = addManualExpense(db, {
      groupId: group.id,
      description: "Ramen",
      category: null,
      amount: "3000",
      payerId: you.id,
      participantIds: [you.id, sarah.id],
    });

    const expense = getExpenses(added.db, group.id)[0];
    expect(expense.currency).toBe("JPY");
    // 3000 yen, not 300,000 hundredths of one.
    expect(expense.totalAmount).toBe(3000);
    expect(expense.splits.map((s) => s.amountOwed)).toEqual([1500, 1500]);
  });

  it("denominates settlements the same way", () => {
    const { db, group } = setup("JPY");
    const [you, sarah] = group.members;

    const settled = addSettlement(db, {
      groupId: group.id,
      fromMember: you.id,
      toMember: sarah.id,
      amount: "1500",
      note: null,
    });

    const settlement = getSettlements(settled.db, group.id)[0];
    expect(settlement.currency).toBe("JPY");
    expect(settlement.amount).toBe(1500);
  });

  it("leaves a dollar group behaving exactly as before", () => {
    const { db, group } = setup("USD");
    const [you, sarah] = group.members;

    const added = addManualExpense(db, {
      groupId: group.id,
      description: "Groceries",
      category: null,
      amount: "30.00",
      payerId: you.id,
      participantIds: [you.id, sarah.id],
    });

    const expense = getExpenses(added.db, group.id)[0];
    expect(expense.totalAmount).toBe(3000);
    expect(expense.splits.map((s) => s.amountOwed)).toEqual([1500, 1500]);
  });
});

describe("a bill in another currency", () => {
  const tokyo = () =>
    createGroup(emptyDb(), {
      name: "Tokyo",
      emoji: "✈️",
      memberNames: ["Sarah"],
      currency: "JPY",
    });

  it("converts across currencies with different decimal places", () => {
    // 40.00 EUR -> 4000 EUR-cents -> 40 EUR -> 1,080,000 dong, which has no
    // minor unit to multiply by.
    expect(convertMinor(4000, "EUR", "VND", 27000)).toBe(1_080_000);
    // And back the other way: 1,080,000 dong at 1/27000 is 40 EUR = 4000 cents.
    expect(convertMinor(1_080_000, "VND", "EUR", 1 / 27000)).toBe(4000);
    // Same currency is a no-op regardless of the rate.
    expect(convertMinor(4000, "EUR", "EUR", 999)).toBe(4000);
  });

  it("refuses a rate that isn't a positive number", () => {
    expect(() => convertMinor(100, "USD", "JPY", 0)).toThrow(/positive/i);
    expect(() => convertMinor(100, "USD", "JPY", -3)).toThrow(/positive/i);
    expect(() => convertMinor(100, "USD", "JPY", NaN)).toThrow(/positive/i);
  });

  it("stores the group's currency as the total, and the bill as it was", () => {
    const { db, group } = tokyo();
    const [you, sarah] = group.members;

    const added = addManualExpense(db, {
      groupId: group.id,
      description: "Duty free",
      category: null,
      amount: "40.00",
      currency: "EUR",
      exchangeRate: 170, // 170 yen to the euro
      payerId: you.id,
      participantIds: [you.id, sarah.id],
    });
    expect(added.error).toBeUndefined();

    const expense = getExpenses(added.db, group.id)[0];
    expect(expense.currency).toBe("JPY");
    expect(expense.totalAmount).toBe(6800); // 40 * 170 yen
    expect(expense.originalAmount).toBe(4000); // 40.00 in euro cents
    expect(expense.originalCurrency).toBe("EUR");
    expect(expense.exchangeRate).toBe(170);
    // Splits are in the group's currency and still sum exactly.
    expect(expense.splits.map((s) => s.amountOwed)).toEqual([3400, 3400]);
  });

  it("refuses a foreign bill with no rate rather than guessing one", () => {
    const { db, group } = tokyo();
    const [you, sarah] = group.members;
    const result = addManualExpense(db, {
      groupId: group.id,
      description: "Duty free",
      category: null,
      amount: "40.00",
      currency: "EUR",
      payerId: you.id,
      participantIds: [you.id, sarah.id],
    });
    expect(result.error).toMatch(/exchange rate/i);
    expect(result.db).toBe(db);
  });

  const withForeign = () => {
    const { db, group } = tokyo();
    const [you, sarah] = group.members;
    const added = addManualExpense(db, {
      groupId: group.id,
      description: "Duty free",
      category: null,
      amount: "40.00",
      currency: "EUR",
      exchangeRate: 170,
      payerId: you.id,
      participantIds: [you.id, sarah.id],
    });
    return { db: added.db, group, expense: getExpenses(added.db, group.id)[0] };
  };

  it("keeps the frozen rate when an edit doesn't mention currency", () => {
    const { db, expense } = withForeign();
    const result = updateExpense(db, expense.id, {
      description: "Duty free, Charles de Gaulle",
      category: expense.category,
      amount: "50.00",
      payerIds: expense.payers.map((p) => p.memberId),
      participantIds: expense.splits.map((s) => s.memberId),
    });

    const after = getExpense(result.db, expense.id)!;
    // Re-rated at today's price, a group that had squared up would come apart.
    expect(after.exchangeRate).toBe(170);
    expect(after.originalCurrency).toBe("EUR");
    expect(after.originalAmount).toBe(5000);
    expect(after.totalAmount).toBe(8500);
  });

  it("stops claiming a conversion once it's re-entered in the group currency", () => {
    const { db, expense } = withForeign();
    const result = updateExpense(db, expense.id, {
      description: expense.description,
      category: expense.category,
      amount: "6800",
      currency: "JPY",
      payerIds: expense.payers.map((p) => p.memberId),
      participantIds: expense.splits.map((s) => s.memberId),
    });

    const after = getExpense(result.db, expense.id)!;
    expect(after.totalAmount).toBe(6800);
    expect(after.originalCurrency).toBeUndefined();
    expect(after.originalAmount).toBeUndefined();
    expect(after.exchangeRate).toBeUndefined();
  });

  it("leaves balances summing to zero after a converted expense", () => {
    const { db, group } = withForeign();
    const balances = computeBalances(group.members, getExpenses(db, group.id), []);
    expect(balances.reduce((sum, b) => sum + b.net, 0)).toBe(0);
  });
});
