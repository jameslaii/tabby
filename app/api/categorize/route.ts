import { NextResponse } from "next/server";
import { classifyBatch, isConfigured, type ClassifyInput } from "../../../lib/classify";
import { buildInsights } from "../../../lib/insights";
import {
  currentMemberId,
  getExpenses,
  getGroup,
  getUncategorized,
  setCategories,
} from "../../../lib/store";

/**
 * Classify every uncategorized expense in a group, in one batched call, and
 * return the refreshed insights.
 *
 * Safe to call repeatedly: expenses that already carry a category are skipped,
 * so opening the panel again costs nothing.
 */
export async function POST(request: Request) {
  const { groupId } = (await request.json()) ?? {};
  const group = getGroup(String(groupId));
  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  const pending = getUncategorized(group.id);
  const items: ClassifyInput[] = pending.map((expense) => ({
    id: expense.id,
    description: expense.description,
    lineItems: expense.lineItems.map((li) => li.description),
  }));

  try {
    const updates = await classifyBatch(items);
    const applied = setCategories(group.id, updates);

    return NextResponse.json({
      applied,
      usedAi: isConfigured(),
      insights: buildInsights(getExpenses(group.id), currentMemberId()),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Couldn't categorize those.",
      },
      { status: 502 },
    );
  }
}
