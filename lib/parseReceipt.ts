import { anthropicClient } from "./anthropic";
import type { GroupMember, ParsedReceipt } from "./types";

/**
 * Server-side only — this uses the Anthropic API key and must never run in
 * the browser.
 *
 * Claude reads the receipt image and the host's plain-English description and
 * returns which items belong to which people. It does not compute money:
 * `computeFinalSplits()` does that (see lib/splits.ts).
 */

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    line_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          temp_id: { type: "string" },
          description: { type: "string" },
          quantity: { type: "number" },
          unit_price: { type: "number" },
          line_total: { type: "number" },
        },
        required: ["temp_id", "description", "quantity", "unit_price", "line_total"],
        additionalProperties: false,
      },
    },
    subtotal: { type: "number" },
    tax: { type: "number" },
    tip: { type: "number" },
    other_charges: { type: "number" },
    grand_total: { type: "number" },
    assignments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line_item_temp_id: { type: "string" },
          member_names: { type: "array", items: { type: "string" } },
          split_type: { type: "string", enum: ["equal", "shares"] },
          shares: { type: "array", items: { type: "number" } },
        },
        required: ["line_item_temp_id", "member_names", "split_type", "shares"],
        additionalProperties: false,
      },
    },
    unresolved_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line_item_temp_id: { type: "string" },
          reason: { type: "string" },
        },
        required: ["line_item_temp_id", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "line_items",
    "subtotal",
    "tax",
    "tip",
    "other_charges",
    "grand_total",
    "assignments",
    "unresolved_items",
  ],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You read a restaurant/store receipt image and a host's plain-English
description of who had what, then map every line item to group members.

Group members (use these exact names in member_names): {{MEMBER_NAMES}}

Rules:
- Extract every line item from the receipt with its price, plus subtotal, tax, tip, and total.
- For each line item, create one "assignments" entry naming who it belongs to.
  - If the host says a person had a specific item, assign it to just them (split_type "equal", one name).
  - If an item was explicitly shared by some subset ("we split the appetizer"), list just those names, split_type "equal".
  - If the host gives no info about an item, assign it to ALL members with split_type "equal" — this is the safe default, not a guess to avoid.
  - Only use split_type "shares" if the host gives an explicit weighting (e.g. "I had two drinks to her one").
- Use the exact id "WHOLE_BILL" as line_item_temp_id for an assignment covering the whole bill — for an unitemized receipt, or when the host says something like "split the rest evenly".
- Emit at most one assignment per line item. Never emit two entries with the same line_item_temp_id.
- If a name in the host's comment doesn't clearly match any group member, or an item's owner is genuinely ambiguous even with the default-to-everyone fallback, still assign it (using the default-to-everyone fallback) AND add it to unresolved_items with a short reason, so a human can double check it.
- Do not compute per-person dollar amounts yourself — only report which members share which item. Downstream code handles the math.
- Tax, tip, and other charges are NOT individual line items — report them in the top-level fields, not in line_items.`;

export type ReceiptMediaType = "image/jpeg" | "image/png" | "image/webp";

export interface ParseParams {
  receiptImageBase64: string;
  receiptMediaType: ReceiptMediaType;
  /** Typed comment and transcribed voice memo, concatenated. */
  hostInstructions: string;
  members: GroupMember[];
}

export function isConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function parseReceiptAndSplit(
  params: ParseParams,
): Promise<ParsedReceipt> {
  const anthropic = anthropicClient();
  const memberNames = params.members.map((m) => m.displayName).join(", ");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    // The draft used 4096, which a long itemized receipt can exceed. max_tokens
    // caps thinking and response text together, so it needs real headroom —
    // hitting the cap truncates the JSON mid-object.
    max_tokens: 16000,
    system: SYSTEM_PROMPT.replace("{{MEMBER_NAMES}}", memberNames),
    messages: [
      {
        role: "user",
        content: [
          // Image before text performs better for Claude's vision.
          {
            type: "image",
            source: {
              type: "base64",
              media_type: params.receiptMediaType,
              data: params.receiptImageBase64,
            },
          },
          {
            type: "text",
            text: `Host's instructions: "${params.hostInstructions}"`,
          },
        ],
      },
    ],
    output_config: {
      format: { type: "json_schema", schema: RECEIPT_SCHEMA },
    },
  });

  // Structured Outputs guarantee the JSON *shape*, not that generation
  // finished. A truncated response is still well-formed JSON up to the cut,
  // and JSON.parse throws on it — so check why generation stopped first.
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "The receipt was too long to read in one pass. Try a tighter crop or split the bill into two expenses.",
    );
  }
  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to read this image. Try a different photo.");
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No structured output returned from Claude.");
  }

  try {
    return JSON.parse(textBlock.text) as ParsedReceipt;
  } catch {
    throw new Error("Claude's response wasn't valid JSON.");
  }
}

/**
 * A fixed receipt used when ANTHROPIC_API_KEY isn't set, so the upload →
 * review → save flow is demonstrable without credentials. It deliberately
 * includes an unresolved item so the review screen's warning state shows up.
 */
export function demoReceipt(members: GroupMember[]): ParsedReceipt {
  const names = members.map((m) => m.displayName);
  const [first = "Everyone", second = first] = names;

  return {
    line_items: [
      { temp_id: "i1", description: "Grilled Salmon", quantity: 1, unit_price: 28.0, line_total: 28.0 },
      { temp_id: "i2", description: "Glass of Riesling", quantity: 2, unit_price: 11.0, line_total: 22.0 },
      { temp_id: "i3", description: "Burrata & Sourdough", quantity: 1, unit_price: 16.0, line_total: 16.0 },
      { temp_id: "i4", description: "Steak Frites", quantity: 1, unit_price: 34.0, line_total: 34.0 },
      { temp_id: "i5", description: "Sparkling Water", quantity: 1, unit_price: 6.0, line_total: 6.0 },
    ],
    subtotal: 106.0,
    tax: 9.01,
    tip: 20.0,
    other_charges: 0,
    grand_total: 135.01,
    assignments: [
      { line_item_temp_id: "i1", member_names: [first], split_type: "equal", shares: [] },
      { line_item_temp_id: "i2", member_names: [first], split_type: "equal", shares: [] },
      { line_item_temp_id: "i3", member_names: names.slice(0, 2), split_type: "equal", shares: [] },
      { line_item_temp_id: "i4", member_names: [second], split_type: "equal", shares: [] },
      { line_item_temp_id: "i5", member_names: names, split_type: "equal", shares: [] },
    ],
    unresolved_items: [
      { line_item_temp_id: "i5", reason: "Nobody claimed the sparkling water — split across everyone." },
    ],
  };
}
