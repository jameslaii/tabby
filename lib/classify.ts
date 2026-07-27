import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, classifyLocally, isCategory, type Category } from "./categories";

/**
 * Server-side only — uses the Anthropic API key.
 *
 * Classification is **batched**: one request covers every uncategorized
 * expense in a group. Doing it per-expense-on-save would put a network round
 * trip in front of "add taxi, $12", which is the one interaction that has to
 * feel instant. Instead expenses save immediately with a keyword guess, and
 * the insights panel upgrades them in a single call.
 */

export interface ClassifyInput {
  id: string;
  description: string;
  /** Receipt line items, when there are any — far better signal than the title. */
  lineItems?: string[];
}

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    classifications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          category: { type: "string", enum: [...CATEGORIES] },
        },
        required: ["id", "category"],
        additionalProperties: false,
      },
    },
  },
  required: ["classifications"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You categorize shared group expenses so people can see what they spend most on.

For each expense you are given an id, a short description, and sometimes the receipt's line items.
Return exactly one category per id, using only the allowed values.

Guidance:
- Line items are stronger evidence than the description. A receipt titled "Receipt" whose items are steak, wine and dessert is Dining.
- Dining is eating out. Groceries is food bought to prepare or take away from a market or supermarket.
- Nightlife is bars, clubs and drinking venues; a restaurant that also serves wine is still Dining.
- Attractions covers museums, tours, tickets and sightseeing.
- Transport covers getting around and between places, including fuel, parking and fares.
- Accommodation is where the group sleeps.
- Use Other only when nothing else genuinely fits — not as a way to avoid deciding.
- Return a classification for every id you are given, and invent no ids.`;

export function isConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Keyword-only classification. Always available, no network. */
export function classifyBatchLocally(
  items: ClassifyInput[],
): Record<string, Category> {
  const out: Record<string, Category> = {};
  for (const item of items) {
    out[item.id] = classifyLocally(
      [item.description, ...(item.lineItems ?? [])].join(" "),
    );
  }
  return out;
}

export async function classifyBatch(
  items: ClassifyInput[],
): Promise<Record<string, Category>> {
  if (items.length === 0) return {};
  if (!isConfigured()) return classifyBatchLocally(items);

  const anthropic = new Anthropic();
  const payload = items.map((item) => ({
    id: item.id,
    description: item.description,
    ...(item.lineItems?.length ? { items: item.lineItems } : {}),
  }));

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Categorize these expenses:\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
    output_config: {
      format: { type: "json_schema", schema: RESULT_SCHEMA },
    },
  });

  // A truncated response is still well-formed JSON up to the cut, and
  // JSON.parse throws on it — check why generation stopped first.
  if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") {
    return classifyBatchLocally(items);
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return classifyBatchLocally(items);

  let parsed: { classifications?: { id: string; category: string }[] };
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    return classifyBatchLocally(items);
  }

  // Start from the local guess so an id the model skipped still gets a value,
  // then let valid model answers override. Ids the model invented are dropped.
  const known = new Set(items.map((i) => i.id));
  const out = classifyBatchLocally(items);
  for (const entry of parsed.classifications ?? []) {
    if (known.has(entry.id) && isCategory(entry.category)) {
      out[entry.id] = entry.category;
    }
  }
  return out;
}
