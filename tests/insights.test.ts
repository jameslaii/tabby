import { describe, expect, it } from "vitest";
import { buildInsights } from "../lib/insights";
import { classifyBatchLocally } from "../lib/classify";
import { CATEGORIES, classifyLocally, isCategory } from "../lib/categories";
import type { Category } from "../lib/categories";
import type { Expense } from "../lib/types";

function expense(
  description: string,
  totalCents: number,
  category: Category | null,
  splits: [string, number][],
): Expense {
  return {
    id: crypto.randomUUID(),
    groupId: "g1",
    description,
    category,
    categorySource: category ? "ai" : null,
    totalAmount: totalCents,
    currency: "USD",
    expenseDate: "2026-07-27",
    sourceType: "manual",
    receiptImageUrl: null,
    rawComment: null,
    rawTranscript: null,
    lineItems: [],
    payers: [{ memberId: splits[0][0], amountPaid: totalCents }],
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

describe("buildInsights", () => {
  const expenses = [
    expense("Tasca dinner", 12000, "Dining", [["a", 4000], ["b", 4000], ["c", 4000]]),
    expense("Airport taxi", 4500, "Transport", [["a", 1500], ["b", 1500], ["c", 1500]]),
    expense("Wine bar", 6000, "Nightlife", [["a", 3000], ["b", 3000]]),
    expense("Tram tickets", 900, "Transport", [["a", 300], ["b", 300], ["c", 300]]),
  ];

  it("totals group spend and the viewer's own share separately", () => {
    const insights = buildInsights(expenses, "a");
    expect(insights.groupTotal).toBe(23400);
    expect(insights.yourTotal).toBe(8800);
    expect(insights.expenseCount).toBe(4);
  });

  it("gives a member with no splits a zero personal share", () => {
    // "c" sat out the wine bar.
    expect(buildInsights(expenses, "c").yourTotal).toBe(5800);
    expect(buildInsights(expenses, "nobody").yourTotal).toBe(0);
  });

  it("rolls repeated categories into one row", () => {
    const transport = buildInsights(expenses, "a").byCategory.find(
      (s) => s.category === "Transport",
    );
    expect(transport).toMatchObject({ groupCents: 5400, count: 2, yourCents: 1800 });
  });

  it("category totals sum to the group total", () => {
    const insights = buildInsights(expenses, "a");
    const summed = insights.byCategory.reduce((s, c) => s + c.groupCents, 0);
    expect(summed).toBe(insights.groupTotal);
  });

  it("category shares sum to the viewer's own total", () => {
    const insights = buildInsights(expenses, "a");
    const summed = insights.byCategory.reduce((s, c) => s + c.yourCents, 0);
    expect(summed).toBe(insights.yourTotal);
  });

  it("ranks categories by group spend", () => {
    expect(buildInsights(expenses, "a").byCategory.map((s) => s.category)).toEqual([
      "Dining",
      "Nightlife",
      "Transport",
    ]);
  });

  it("buckets uncategorized spend under Other and counts it", () => {
    const insights = buildInsights(
      [...expenses, expense("Mystery", 1000, null, [["a", 1000]])],
      "a",
    );
    expect(insights.uncategorized).toBe(1);
    expect(
      insights.byCategory.find((s) => s.category === "Other")?.groupCents,
    ).toBe(1000);
    // Still reconciles — an unlabelled expense must not vanish from the total.
    const summed = insights.byCategory.reduce((s, c) => s + c.groupCents, 0);
    expect(summed).toBe(insights.groupTotal);
  });

  it("reports the largest single expense", () => {
    expect(buildInsights(expenses, "a").largest).toMatchObject({
      description: "Tasca dinner",
      cents: 12000,
    });
  });

  it("handles an empty group without dividing by zero", () => {
    expect(buildInsights([], "a")).toMatchObject({
      groupTotal: 0,
      yourTotal: 0,
      expenseCount: 0,
      byCategory: [],
      largest: null,
    });
  });
});

describe("classifyLocally", () => {
  it("recognises the obvious cases", () => {
    expect(classifyLocally("Uber to the airport")).toBe("Transport");
    expect(classifyLocally("Dinner at the tasca")).toBe("Dining");
    expect(classifyLocally("Hotel Estrela")).toBe("Accommodation");
    expect(classifyLocally("Museum tickets")).toBe("Attractions");
    expect(classifyLocally("Supermarket run")).toBe("Groceries");
    expect(classifyLocally("Cocktails at the rooftop bar")).toBe("Nightlife");
  });

  it("prefers the narrower rule when two could match", () => {
    // "wine bar" is Nightlife, not Dining, even though both vocabularies fit.
    expect(classifyLocally("Wine bar on Rua Nova")).toBe("Nightlife");
    // "pharmacy" is Health, not Shopping, despite the word "shop" nearby.
    expect(classifyLocally("Pharmacy shop")).toBe("Health");
  });

  it("matches plurals as well as stems", () => {
    // `\bcocktail\b` does not match "Cocktails" — there's no word boundary
    // between "l" and "s" — so the rules are built with an explicit plural.
    expect(classifyLocally("Cocktails at Pensão Amor")).toBe("Nightlife");
    expect(classifyLocally("Museum tickets")).toBe("Attractions");
    expect(classifyLocally("Bus fares")).toBe("Transport");
    expect(classifyLocally("Noodles for lunch")).toBe("Dining");
  });

  it("falls back to Other rather than guessing", () => {
    expect(classifyLocally("asdfgh")).toBe("Other");
    expect(classifyLocally("")).toBe("Other");
  });

  it("only ever returns a known category", () => {
    for (const text of ["Uber", "", "🎉", "Museum", "zzz"]) {
      expect(isCategory(classifyLocally(text))).toBe(true);
    }
  });
});

describe("classifyBatchLocally", () => {
  it("returns one category per id and uses line items as signal", () => {
    const result = classifyBatchLocally([
      { id: "1", description: "Receipt", lineItems: ["Grilled salmon", "Riesling"] },
      { id: "2", description: "Airport taxi" },
      { id: "3", description: "" },
    ]);

    expect(Object.keys(result).sort()).toEqual(["1", "2", "3"]);
    // The title alone says nothing; the items make it Dining.
    expect(result["1"]).toBe("Dining");
    expect(result["2"]).toBe("Transport");
    expect(result["3"]).toBe("Other");
  });

  it("returns nothing for no input", () => {
    expect(classifyBatchLocally([])).toEqual({});
  });
});

describe("category vocabulary", () => {
  it("is closed — isCategory rejects anything outside it", () => {
    for (const c of CATEGORIES) expect(isCategory(c)).toBe(true);
    for (const bad of ["Food", "dining", "", null, undefined, 7]) {
      expect(isCategory(bad)).toBe(false);
    }
  });
});
