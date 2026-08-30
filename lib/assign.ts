import { anthropicClient } from "./anthropic";
import type { ParsedReceipt } from "./types";

/**
 * Re-decide who had what and who paid, across every receipt in one outing.
 *
 * Server-side only — uses the Anthropic API key.
 *
 * This exists separately from `parseReceipt` because reading a photo and
 * interpreting an instruction are different jobs with different costs. The
 * photo only has to be read once; the instruction changes every time the host
 * types another sentence. Re-sending the images for each edit would mean a
 * vision call per keystroke-batch and a multi-megabyte upload each time.
 *
 * It also takes *all* the receipts together, which is the only way an
 * instruction that spans them can work: "I paid the Grab there, Sarah paid the
 * way back" is meaningless to a call that can only see one of the two rides.
 */

export interface AssignReceipt {
  /** Client-side id, echoed back so answers can be matched to receipts. */
  id: string;
  /** What the host called it — "Grab there", "Dinner". Helps the model aim. */
  label: string;
  parsed: ParsedReceipt;
}

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    receipts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          receipt_id: { type: "string" },
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
          payers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                member_name: { type: "string" },
                amount: { type: "number" },
              },
              required: ["member_name", "amount"],
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
        required: ["receipt_id", "assignments", "payers", "unresolved_items"],
        additionalProperties: false,
      },
    },
  },
  required: ["receipts"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are splitting one or more receipts from a single outing between a group of friends.

Group members (use these exact names in member_names and payers): {{MEMBER_NAMES}}

The receipts have already been read from their photos — you are given the line items and totals. Your job is to interpret the host's plain-English description and decide, for every receipt, who shares which item and who paid.

Return one entry per receipt, echoing back its receipt_id exactly.

Assignments:
- Emit at most one assignment per line item. Never emit two entries with the same line_item_temp_id.
- If the host says a person had a specific item, assign it to just them (split_type "equal", one name).
- If an item was explicitly shared by a subset ("we split the starter"), list just those names, split_type "equal".
- If the host gives no information about an item, assign it to ALL members with split_type "equal". This is the safe default, not a guess to avoid.
- Only use split_type "shares" if the host gives an explicit weighting ("I had two drinks to her one").
- Use the exact id "WHOLE_BILL" as line_item_temp_id for an assignment covering a whole receipt — for an unitemized bill like a taxi fare, or when the host says "split the rest evenly".
- Do not compute dollar amounts. Only say who shares what; the app does every cent of the arithmetic.

Payers — who actually settled each bill:
- One payer named for a receipt: return that one name with that receipt's grand total as the amount.
- Several people paid one bill: list each. Use the host's figures if given, otherwise give every payer an amount of 0 and the app divides that bill evenly between them.
- The host says nothing about who paid a given receipt: return an empty payers array for it. Never guess a payer — an invented one silently moves real money.

Matching instructions to receipts:
- The host's description usually covers several receipts at once, and often names them by where they came from: "I paid the Grab there, Sarah paid the way back, we split dinner."
- Use each receipt's label and its line items to work out which sentence belongs to it. A ride-hailing fare and a restaurant bill are rarely described by the same sentence.
- An instruction that plainly applies to the whole outing ("split everything evenly", "Alex wasn't there") applies to every receipt.
- If you genuinely cannot tell which receipt a statement refers to, apply the safe default and add an unresolved_items entry saying so.`;

export function isConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Returns a partial receipt patch per receipt id. Receipts the model didn't
 * answer for are absent, and the caller keeps what it already had.
 */
export async function assignAcrossReceipts(
  receipts: AssignReceipt[],
  instructions: string,
  memberNames: string[],
): Promise<
  Record<
    string,
    Pick<ParsedReceipt, "assignments" | "payers" | "unresolved_items">
  >
> {
  if (receipts.length === 0 || !instructions.trim() || !isConfigured()) return {};

  const anthropic = anthropicClient();
  const payload = receipts.map((receipt) => ({
    receipt_id: receipt.id,
    label: receipt.label,
    line_items: receipt.parsed.line_items.map((item) => ({
      temp_id: item.temp_id,
      description: item.description,
      line_total: item.line_total,
    })),
    subtotal: receipt.parsed.subtotal,
    tax: receipt.parsed.tax,
    tip: receipt.parsed.tip,
    grand_total: receipt.parsed.grand_total,
  }));

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 16000,
    system: SYSTEM_PROMPT.replace("{{MEMBER_NAMES}}", memberNames.join(", ")),
    messages: [
      {
        role: "user",
        content: `Receipts:\n\n${JSON.stringify(payload, null, 2)}\n\nHost's instructions: "${instructions}"`,
      },
    ],
    output_config: {
      format: { type: "json_schema", schema: RESULT_SCHEMA },
    },
  });

  // Structured Outputs guarantee the JSON shape, not that generation finished.
  // A truncated response is well-formed up to the cut and JSON.parse throws on
  // it, so check why generation stopped before parsing.
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "There was too much to work through in one pass. Try splitting fewer receipts at a time.",
    );
  }
  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined that request. Try rewording it.");
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No structured output returned from Claude.");
  }

  let parsed: {
    receipts?: {
      receipt_id: string;
      assignments: ParsedReceipt["assignments"];
      payers: NonNullable<ParsedReceipt["payers"]>;
      unresolved_items: ParsedReceipt["unresolved_items"];
    }[];
  };
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw new Error("Claude's response wasn't valid JSON.");
  }

  // Ids the model invented are dropped: a patch keyed to a receipt that isn't
  // on screen would silently go nowhere, and one keyed to the wrong receipt
  // would reassign the wrong bill.
  const known = new Set(receipts.map((r) => r.id));
  const out: Record<
    string,
    Pick<ParsedReceipt, "assignments" | "payers" | "unresolved_items">
  > = {};

  for (const entry of parsed.receipts ?? []) {
    if (!known.has(entry.receipt_id)) continue;
    out[entry.receipt_id] = {
      assignments: entry.assignments ?? [],
      payers: entry.payers ?? [],
      unresolved_items: entry.unresolved_items ?? [],
    };
  }
  return out;
}
