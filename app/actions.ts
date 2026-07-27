"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toCents } from "../lib/money";
import { computeFinalSplits } from "../lib/splits";
import { isCategory } from "../lib/categories";
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

export async function createGroupAction(formData: FormData) {
  const group = createGroup(
    String(formData.get("name") ?? ""),
    String(formData.get("emoji") ?? "🐈"),
  );
  revalidatePath("/");
  redirect(`/groups/${group.id}`);
}

export async function addExpenseAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const groupId = String(formData.get("groupId"));
  const participantIds = formData.getAll("participants").map(String);

  if (participantIds.length === 0) {
    return { error: "Pick at least one person to split between." };
  }

  const rawCategory = String(formData.get("category") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { error: "Give the expense a description." };

  try {
    addManualExpense({
      groupId,
      description,
      category: isCategory(rawCategory) ? rawCategory : null,
      amount: String(formData.get("amount") ?? ""),
      payerId: String(formData.get("payerId")),
      participantIds,
    });
  } catch {
    return { error: "That amount doesn't look like a number." };
  }

  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}`);
}

export async function settleUpAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const groupId = String(formData.get("groupId"));
  try {
    addSettlement({
      groupId,
      fromMember: String(formData.get("fromMember")),
      toMember: String(formData.get("toMember")),
      amountCents: toCents(String(formData.get("amount") ?? "")),
      note: String(formData.get("note") ?? "") || null,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't record that." };
  }

  revalidatePath(`/groups/${groupId}`);
  return {};
}

/**
 * Persist a reviewed receipt.
 *
 * The client previews splits as the host edits, but the amounts saved here are
 * recomputed server-side from the assignments. Money the browser calculated is
 * never trusted — the preview and the record come from the same function, so
 * they agree, but only one of them is authoritative.
 */
export async function saveReceiptAction(input: {
  groupId: string;
  description: string;
  payerId: string;
  parsed: ParsedReceipt;
  rawComment: string;
}): Promise<ActionResult> {
  const group = getGroup(input.groupId);
  if (!group) return { error: "Group not found." };

  const result = computeFinalSplits(input.parsed, group.members);
  if (result.totalCents <= 0) {
    return { error: "This receipt doesn't add up to anything to split." };
  }

  const lineItems: LineItem[] = input.parsed.line_items.map((item) => ({
    id: crypto.randomUUID(),
    description: item.description,
    quantity: item.quantity,
    unitPrice: toCents(item.unit_price),
    lineTotal: toCents(item.line_total),
  }));

  addItemizedExpense({
    groupId: input.groupId,
    description: input.description.trim() || "Receipt",
    payerId: input.payerId,
    totalCents: result.totalCents,
    lineItems,
    splits: result.splits.map((s) => ({
      memberId: s.memberId,
      lineItemId: null,
      splitType: "exact" as const,
      shareValue: null,
      amountOwed: s.amountOwed,
    })),
    rawComment: input.rawComment || null,
  });

  revalidatePath(`/groups/${input.groupId}`);
  return {};
}

export async function addMemberAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const groupId = String(formData.get("groupId"));
  try {
    addMember(groupId, String(formData.get("displayName") ?? ""));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't add them." };
  }

  revalidatePath(`/groups/${groupId}`);
  return {};
}
