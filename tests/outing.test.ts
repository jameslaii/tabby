import { describe, expect, it } from "vitest";
import { computeBalances, simplifyDebts } from "../lib/balances";
import { computeFinalSplits, resolvePayers } from "../lib/splits";
import type { Expense, ParsedReceipt } from "../lib/types";
import { member } from "./helpers";

/**
 * One outing, three bills, three different stories about who paid.
 *
 * The receipts below are the real shape Claude returned for:
 *
 *   "I paid for the Grab there and Sarah paid for the Grab back. At dinner
 *    Sarah had the bifana, I had the pastel de nata, and we shared the
 *    galaos. John split the rides with us but didn't eat. Alex wasn't there
 *    at all. Sarah paid for dinner too."
 *
 * What's pinned here is the arithmetic downstream of that answer: every bill
 * has to reconcile on both sides — what people owe and what people paid — and
 * the group has to end up summing to zero. It won't if a payer goes missing,
 * and `simplifyDebts` throws rather than emitting nonsense when it doesn't,
 * so a regression here is loud.
 */

const you = member("m-you", "You");
const sarah = member("m-sarah", "Sarah");
const john = member("m-john", "John");
const alex = member("m-alex", "Alex");
const members = [you, sarah, john, alex];

const ride = (fare: number, payer: string): ParsedReceipt => ({
  line_items: [],
  subtotal: fare,
  tax: 0,
  tip: 0,
  other_charges: 0,
  grand_total: fare,
  assignments: [
    {
      line_item_temp_id: "WHOLE_BILL",
      member_names: ["You", "Sarah", "John"],
      split_type: "equal",
      shares: [],
    },
  ],
  payers: [{ member_name: payer, amount: fare }],
  unresolved_items: [],
});

const dinner: ParsedReceipt = {
  line_items: [
    { temp_id: "d1", description: "Bifana", quantity: 1, unit_price: 8.5, line_total: 8.5 },
    { temp_id: "d2", description: "Pastel de Nata", quantity: 1, unit_price: 3.5, line_total: 3.5 },
    { temp_id: "d3", description: "Galao", quantity: 2, unit_price: 3.5, line_total: 7.0 },
  ],
  subtotal: 19.0,
  tax: 1.9,
  tip: 2.0,
  other_charges: 0,
  grand_total: 22.9,
  assignments: [
    { line_item_temp_id: "d1", member_names: ["Sarah"], split_type: "equal", shares: [] },
    { line_item_temp_id: "d2", member_names: ["You"], split_type: "equal", shares: [] },
    { line_item_temp_id: "d3", member_names: ["You", "Sarah"], split_type: "equal", shares: [] },
  ],
  payers: [{ member_name: "Sarah", amount: 22.9 }],
  unresolved_items: [],
};

const outing = [
  { label: "Grab there", parsed: ride(18.5, "You") },
  { label: "Grab back", parsed: ride(21.0, "Sarah") },
  { label: "Dinner", parsed: dinner },
];

/** Everything `saveReceiptsAction` derives, without the Next.js plumbing. */
function settle() {
  return outing.map(({ label, parsed }) => {
    const result = computeFinalSplits(parsed, members);
    const { payers, warnings } = resolvePayers(parsed, members, result.totalCents);
    return { label, result, payers, payerWarnings: warnings };
  });
}

function asExpenses(): Expense[] {
  return settle().map(({ label, result, payers }) => ({
    id: label,
    groupId: "g",
    description: label,
    category: null,
    categorySource: null,
    totalAmount: result.totalCents,
    currency: "USD",
    expenseDate: "2026-08-30",
    sourceType: "receipt_ai" as const,
    receiptImageUrl: null,
    rawComment: null,
    rawTranscript: null,
    lineItems: [],
    payers,
    splits: result.splits.map((s) => ({
      memberId: s.memberId,
      lineItemId: null,
      splitType: "exact" as const,
      shareValue: null,
      amountOwed: s.amountOwed,
    })),
    createdAt: "2026-08-30T00:00:00.000Z",
  }));
}

describe("splitting an outing across several receipts", () => {
  it("reconciles both sides of every bill", () => {
    for (const { label, result, payers } of settle()) {
      const owed = result.splits.reduce((s, x) => s + x.amountOwed, 0);
      const paid = payers.reduce((s, p) => s + p.amountPaid, 0);
      expect(owed, `${label} splits`).toBe(result.totalCents);
      expect(paid, `${label} payers`).toBe(result.totalCents);
    }
  });

  it("bills each ride to the person who actually paid it", () => {
    const [there, back, meal] = settle();
    expect(there.payers).toEqual([{ memberId: "m-you", amountPaid: 1850 }]);
    expect(back.payers).toEqual([{ memberId: "m-sarah", amountPaid: 2100 }]);
    expect(meal.payers).toEqual([{ memberId: "m-sarah", amountPaid: 2290 }]);
    expect(settle().flatMap((r) => r.payerWarnings)).toEqual([]);
  });

  it("charges nothing to someone who wasn't there", () => {
    const balances = computeBalances(members, asExpenses(), []);
    expect(balances.find((b) => b.memberId === "m-alex")?.net).toBe(0);
  });

  it("leaves the person who fronted two bills in credit", () => {
    const balances = computeBalances(members, asExpenses(), []);
    const net = (id: string) => balances.find((b) => b.memberId === id)?.net ?? 0;

    // Sarah covered the ride back and dinner, and ate at one of the three.
    expect(net("m-sarah")).toBeGreaterThan(0);
    // John shared both rides and paid for neither.
    expect(net("m-john")).toBeLessThan(0);
  });

  it("keeps the group summing to zero, so debts can be simplified", () => {
    const balances = computeBalances(members, asExpenses(), []);
    expect(balances.reduce((s, b) => s + b.net, 0)).toBe(0);

    // Throws if the group doesn't reconcile — the real regression alarm.
    const transfers = simplifyDebts(balances);
    expect(transfers.length).toBeLessThanOrEqual(members.length - 1);
    for (const t of transfers) expect(t.amount).toBeGreaterThan(0);
  });

  it("spreads dinner's tax and tip over only the people who ate", () => {
    const meal = computeFinalSplits(dinner, members);
    const owed = (id: string) =>
      meal.splits.find((s) => s.memberId === id)?.amountOwed ?? 0;

    expect(owed("m-john")).toBe(0);
    expect(owed("m-alex")).toBe(0);
    // Sarah's bifana costs more than You's pastel, so she carries more of the
    // service charge: extras follow what each person actually ate.
    expect(owed("m-sarah")).toBeGreaterThan(owed("m-you"));
    expect(owed("m-sarah") + owed("m-you")).toBe(2290);
  });

  it("totals the outing at the sum of its bills", () => {
    const total = settle().reduce((s, r) => s + r.result.totalCents, 0);
    expect(total).toBe(1850 + 2100 + 2290);
  });
});
