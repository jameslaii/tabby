import { describe, expect, it } from "vitest";
import { formatCents, toCents, apportion } from "../lib/money";
import { minorUnits, isCurrency, DEFAULT_CURRENCY } from "../lib/currencies";
import {
  addManualExpense,
  addSettlement,
  createGroup,
  emptyDb,
  getExpenses,
  getSettlements,
} from "../lib/db";

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
