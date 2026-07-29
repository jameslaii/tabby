import type { Cents } from "./money";
import { CATEGORIES, type Category } from "./categories";
import type { Expense } from "./types";

export interface CategorySlice {
  category: Category;
  /** What the whole group spent in this category. */
  groupCents: Cents;
  /** The viewer's own share of that. */
  yourCents: Cents;
  count: number;
}

export interface Insights {
  groupTotal: Cents;
  yourTotal: Cents;
  expenseCount: number;
  /** Only categories with spend, descending by group spend. */
  byCategory: CategorySlice[];
  largest: { description: string; cents: Cents; category: Category } | null;
  /** Expenses still awaiting classification. */
  uncategorized: number;
}

/**
 * Aggregate expenses into the insights panel's numbers.
 *
 * Two measures are computed side by side: what the group spent (the sum of
 * expense totals) and what the viewer personally owes (the sum of their
 * splits). They are different questions — on a trip where one person fronts
 * the hotel, group spend and personal share look nothing alike — and the
 * panel lets you switch between them.
 *
 * Settlements are deliberately not included. A settlement moves money between
 * members to square up; it isn't consumption, and counting it would
 * double-count the expense it repays.
 */
export function buildInsights(
  expenses: Expense[],
  memberId: string | null,
): Insights {
  const byCategory = new Map<Category, CategorySlice>();

  let groupTotal: Cents = 0;
  let yourTotal: Cents = 0;
  let uncategorized = 0;
  let largest: Insights["largest"] = null;

  for (const expense of expenses) {
    const category = expense.category ?? "Other";
    if (expense.category === null) uncategorized += 1;

    const yourShare = expense.splits
      .filter((s) => s.memberId === memberId)
      .reduce((sum, s) => sum + s.amountOwed, 0);

    groupTotal += expense.totalAmount;
    yourTotal += yourShare;

    const slice = byCategory.get(category) ?? {
      category,
      groupCents: 0,
      yourCents: 0,
      count: 0,
    };
    slice.groupCents += expense.totalAmount;
    slice.yourCents += yourShare;
    slice.count += 1;
    byCategory.set(category, slice);

    if (!largest || expense.totalAmount > largest.cents) {
      largest = {
        description: expense.description,
        cents: expense.totalAmount,
        category,
      };
    }
  }

  const order = new Map(CATEGORIES.map((c, i) => [c, i]));
  const slices = [...byCategory.values()]
    .filter((s) => s.groupCents !== 0)
    // Descending by spend; ties fall back to the canonical category order so
    // the rows don't reshuffle between renders.
    .sort(
      (a, b) =>
        b.groupCents - a.groupCents ||
        (order.get(a.category) ?? 0) - (order.get(b.category) ?? 0),
    );

  return {
    groupTotal,
    yourTotal,
    expenseCount: expenses.length,
    byCategory: slices,
    largest,
    uncategorized,
  };
}
