import { NextResponse } from "next/server";
import { classifyBatch, isConfigured, type ClassifyInput } from "../../../lib/classify";
import { readJson, withinRateLimit } from "../../../lib/http";

/** One classify call covers a whole group's worth of pending expenses. */
const MAX_ITEMS = 100;

/**
 * Label a batch of expenses.
 *
 * Stateless: the caller sends the expenses that still need a category and
 * applies the answer to its own copy. Batched rather than per-expense-on-save
 * because "add taxi, $12" has to feel instant, and a model call in front of it
 * wouldn't.
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

  if (!Array.isArray(body.items)) {
    return NextResponse.json(
      { error: "Expected a list of expenses to categorize." },
      { status: 400 },
    );
  }

  const items: ClassifyInput[] = [];
  for (const raw of (body.items as unknown[]).slice(0, MAX_ITEMS)) {
    const entry = raw as { id?: unknown; description?: unknown; lineItems?: unknown };
    if (typeof entry.id !== "string") continue;
    items.push({
      id: entry.id,
      description: String(entry.description ?? "").slice(0, 200),
      lineItems: Array.isArray(entry.lineItems)
        ? entry.lineItems.slice(0, 60).map((li) => String(li ?? "").slice(0, 200))
        : undefined,
    });
  }

  if (items.length === 0) {
    return NextResponse.json({ categories: {}, usedAi: false });
  }

  try {
    const categories = await classifyBatch(items);
    return NextResponse.json({ categories, usedAi: isConfigured() });
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
