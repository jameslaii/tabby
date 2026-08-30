"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toCents } from "../lib/money";
import { computeFinalSplits } from "../lib/splits";
import { isCategory } from "../lib/categories";
import { MAX_RECEIPTS_PER_SPLIT } from "../lib/types";
import type { LineItem, ParsedReceipt } from "../lib/types";
import {
  addItemizedExpense,
  addManualExpense,
  addMember,
  addSettlement,
  createGroup,
  getGroup,
} from "../lib/store";

export type ActionResult = { error?: string };

// Server actions are public endpoints: anything a form *could* send arrives
// here regardless of what the UI allows, so free-text fields get a ceiling.
// The caps are far above honest use — they exist so a scripted caller can't
// grow the in-memory store by megabytes per request.
const MAX_NAME_CHARS = 60;
const MAX_DESCRIPTION_CHARS = 200;
const MAX_COMMENT_CHARS = 2000;
const MAX_LINE_ITEMS = 200;

export async function createGroupAction(formData: FormData) {
  const group = createGroup(
    String(formData.get("name") ?? "").slice(0, MAX_NAME_CHARS),
    String(formData.get("emoji") ?? "🐈").slice(0, 8),
  );
  revalidatePath("/");
  redirect(`/groups/${group.id}`);
}

export async function addExpenseAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const groupId = String(formData.get("groupId"));
  // De-duplicated: a repeated checkbox value would bill that member twice.
  const participantIds = [...new Set(formData.getAll("participants").map(String))];

  if (participantIds.length === 0) {
    return { error: "Pick at least one person to split between." };
  }

  const rawCategory = String(formData.get("category") ?? "");
  const description = String(formData.get("description") ?? "")
    .trim()
    .slice(0, MAX_DESCRIPTION_CHARS);
  if (!description) return { error: "Give the expense a description." };

  // Each input is checked on its own so the message names the field that's
  // actually wrong. A single catch around the write reported every failure —
  // an unknown payer, a missing group — as "that amount isn't a number".
  const amount = String(formData.get("amount") ?? "");
  let totalCents: number;
  try {
    totalCents = toCents(amount);
  } catch {
    return { error: "That amount doesn't look like a number." };
  }
  if (totalCents <= 0) {
    return { error: "An expense has to be for a positive amount." };
  }

  const group = getGroup(groupId);
  if (!group) return { error: "Group not found." };

  const payerId = String(formData.get("payerId"));
  if (!group.members.some((m) => m.id === payerId)) {
    return { error: "Pick who paid." };
  }
  if (!participantIds.every((p) => group.members.some((m) => m.id === p))) {
    return { error: "Someone in that split isn't in this group." };
  }

  addManualExpense({
    groupId,
    description,
    category: isCategory(rawCategory) ? rawCategory : null,
    amount,
    payerId,
    participantIds,
  });

  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}`);
}

export async function settleUpAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const groupId = String(formData.get("groupId"));
  const group = getGroup(groupId);
  if (!group) return { error: "Group not found." };

  // A settlement naming a member outside this group would credit money to
  // nobody: balances drop unknown ids, the group stops summing to zero, and
  // debt simplification refuses to run — bricking the group page.
  const fromMember = String(formData.get("fromMember"));
  const toMember = String(formData.get("toMember"));
  const isMember = (id: string) => group.members.some((m) => m.id === id);
  if (!isMember(fromMember) || !isMember(toMember)) {
    return { error: "Both people have to be in this group." };
  }

  try {
    addSettlement({
      groupId,
      fromMember,
      toMember,
      amountCents: toCents(String(formData.get("amount") ?? "")),
      note: String(formData.get("note") ?? "").slice(0, MAX_DESCRIPTION_CHARS) || null,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't record that." };
  }

  revalidatePath(`/groups/${groupId}`);
  return {};
}

export interface ReceiptToSave {
  description: string;
  parsed: ParsedReceipt;
  /** Who fronted the money. Must sum to the receipt's reconciled total. */
  payers: { memberId: string; amountPaid: number }[];
}

/**
 * Persist a reviewed set of receipts — one outing, one or more bills.
 *
 * The client previews splits as the host edits, but the amounts saved here are
 * recomputed server-side from the assignments. Money the browser calculated is
 * never trusted — the preview and the record come from the same function, so
 * they agree, but only one of them is authoritative.
 *
 * Each receipt becomes its own expense. That keeps the ride there, the ride
 * back and the dinner between them as three separate things you can read on
 * the group page and, later, correct one at a time — and it lets each carry
 * its own payer, which is the whole point of splitting an outing rather than
 * a single bill.
 */
export async function saveReceiptsAction(input: {
  groupId: string;
  receipts: ReceiptToSave[];
  rawComment: string;
}): Promise<ActionResult> {
  const group = getGroup(input.groupId);
  if (!group) return { error: "Group not found." };

  if (!Array.isArray(input.receipts) || input.receipts.length === 0) {
    return { error: "There's nothing to save." };
  }
  if (input.receipts.length > MAX_RECEIPTS_PER_SPLIT) {
    return { error: `That's more than ${MAX_RECEIPTS_PER_SPLIT} receipts at once.` };
  }

  const comment =
    String(input.rawComment ?? "").slice(0, MAX_COMMENT_CHARS) || null;

  // Validate every receipt before writing any of them. A half-saved outing is
  // worse than a rejected one: the balances would be real but incomplete, and
  // there's no way to tell from the group page which half made it.
  const prepared: {
    description: string;
    lineItems: LineItem[];
    splits: ReturnType<typeof computeFinalSplits>["splits"];
    totalCents: number;
    payers: { memberId: string; amountPaid: number }[];
  }[] = [];

  for (const receipt of input.receipts) {
    const label =
      String(receipt?.description ?? "").trim().slice(0, MAX_DESCRIPTION_CHARS) ||
      "Receipt";

    if (!Array.isArray(receipt?.parsed?.line_items)) {
      return { error: `"${label}" is malformed — scan it again.` };
    }
    if (receipt.parsed.line_items.length > MAX_LINE_ITEMS) {
      return { error: `"${label}" has too many line items — split that bill in two.` };
    }

    // `parsed` is a client payload. The UI only ever round-trips what the
    // parse route returned, but nothing forces a caller to: a NaN price must
    // come back as an error, not throw mid-action as a 500.
    let result: ReturnType<typeof computeFinalSplits>;
    let lineItems: LineItem[];
    try {
      result = computeFinalSplits(receipt.parsed, group.members);
      lineItems = receipt.parsed.line_items.map((item) => ({
        id: crypto.randomUUID(),
        description: String(item.description ?? "").slice(0, MAX_DESCRIPTION_CHARS),
        quantity: item.quantity,
        unitPrice: toCents(item.unit_price),
        lineTotal: toCents(item.line_total),
      }));
    } catch {
      return { error: `The amounts on "${label}" aren't real numbers — scan it again.` };
    }

    if (result.totalCents <= 0) {
      return { error: `"${label}" doesn't add up to anything to split.` };
    }

    // Payers are checked as hard as splits are. An unknown payer records money
    // paid by nobody — the payment is dropped from balances while the debts
    // count, the group stops summing to zero, and debt simplification refuses
    // to run, which bricks the group page.
    const payers = Array.isArray(receipt.payers) ? receipt.payers : [];
    if (payers.length === 0) {
      return { error: `Choose who paid for "${label}".` };
    }

    const seen = new Set<string>();
    let paidTotal = 0;
    for (const payer of payers) {
      const memberId = String(payer?.memberId ?? "");
      if (!group.members.some((m) => m.id === memberId)) {
        return { error: `Whoever paid for "${label}" isn't in this group.` };
      }
      if (seen.has(memberId)) {
        return { error: `The same person is listed twice as paying for "${label}".` };
      }
      seen.add(memberId);

      const amount = Number(payer?.amountPaid);
      if (!Number.isSafeInteger(amount) || amount < 0) {
        return { error: `The amount paid for "${label}" isn't a whole number of cents.` };
      }
      paidTotal += amount;
    }

    if (paidTotal !== result.totalCents) {
      return {
        error: `What was paid for "${label}" doesn't match its total — reopen it and check who paid.`,
      };
    }

    prepared.push({
      description: label,
      lineItems,
      splits: result.splits,
      totalCents: result.totalCents,
      payers: payers.map((p) => ({
        memberId: String(p.memberId),
        amountPaid: Number(p.amountPaid),
      })),
    });
  }

  for (const receipt of prepared) {
    addItemizedExpense({
      groupId: input.groupId,
      description: receipt.description,
      // The activity line reads "<name> added <thing>", so it names whoever
      // put in the most — the rest are on the expense itself.
      payerId: [...receipt.payers].sort((a, b) => b.amountPaid - a.amountPaid)[0]
        .memberId,
      payers: receipt.payers,
      totalCents: receipt.totalCents,
      lineItems: receipt.lineItems,
      splits: receipt.splits.map((s) => ({
        memberId: s.memberId,
        lineItemId: null,
        splitType: "exact" as const,
        shareValue: null,
        amountOwed: s.amountOwed,
      })),
      rawComment: comment,
    });
  }

  revalidatePath(`/groups/${input.groupId}`);
  return {};
}

export async function addMemberAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const groupId = String(formData.get("groupId"));
  try {
    addMember(groupId, String(formData.get("displayName") ?? "").slice(0, MAX_NAME_CHARS));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't add them." };
  }

  revalidatePath(`/groups/${groupId}`);
  return {};
}
