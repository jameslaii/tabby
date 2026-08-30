import { NextResponse } from "next/server";
import { classifyBatch, isConfigured, type ClassifyInput } from "../../../lib/classify";
import { buildInsights } from "../../../lib/insights";
import { readJson, withinRateLimit } from "../../../lib/http";
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
  if (!withinRateLimit(request, "categorize", 20)) {
    return NextResponse.json(
      { error: "Too many requests — give it a minute." },
      { status: 429 },
    );
  }

  const body = await readJson(request);
  if (body === null) {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const group = getGroup(String(body.groupId));
  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  // Cap one batch at a size a single model call handles comfortably; anything
  // beyond it stays pending and the next open of the panel picks it up.
  const pending = getUncategorized(group.id).slice(0, 100);
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
      insights: buildInsights(getExpenses(group.id), currentMemberId(group.id)),
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
