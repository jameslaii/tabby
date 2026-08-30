import { apportion, toCents, type Cents } from "./money";
import {
  WHOLE_BILL,
  type ExpensePayer,
  type FinalSplit,
  type GroupMember,
  type ParsedReceipt,
  type SplitResult,
  type SplitWarning,
} from "./types";

/**
 * Turn Claude's item-to-person mapping into exact per-person amounts.
 *
 * The division of labour is the point: the model decides *who gets which
 * item*, this function does every cent of arithmetic. You never want an LLM
 * rounding your friends' money. What's changed from the original draft is the
 * failure behaviour.
 *
 * The draft ended with a "penny drift" correction that added
 * `grand_total - sum(splits)` to whoever owed the most. That guaranteed the
 * splits summed to the total, but the delta was unbounded, so any upstream
 * fault — an unmatched name, an unhandled WHOLE_BILL assignment, an OCR
 * misread of the total — silently became a large charge against one arbitrary
 * person. A receipt whose total was misread as $1000 instead of $100 billed
 * $933.34 to whoever happened to be first in the members array.
 *
 * Here, apportionment is exact by construction (see `apportion`), so there is
 * no drift to absorb. Anything that doesn't reconcile becomes a `SplitWarning`
 * for the review screen instead of a silent adjustment.
 */
export function computeFinalSplits(
  parsed: ParsedReceipt,
  members: GroupMember[],
  currency = "USD",
): SplitResult {
  const warnings: SplitWarning[] = [];
  const warn = (
    code: SplitWarning["code"],
    message: string,
    lineItemTempId?: string,
  ) => warnings.push({ code, message, lineItemTempId });

  if (members.length === 0) {
    return { splits: [], warnings, totalCents: 0 };
  }

  // Anything the model already flagged rides along to the same review UI.
  for (const item of parsed.unresolved_items) {
    warn("model_flagged", item.reason, item.line_item_temp_id);
  }

  // --- Name resolution ---------------------------------------------------
  // The model is given display names and echoes them back, so names are the
  // only join key available. Match leniently on case and whitespace, but
  // never guess: a name that matches two members is ambiguous, not a coin
  // flip. (`group_members.display_name` has no uniqueness constraint, so two
  // people named "John" is a legal, and very ordinary, group.)
  const byName = buildNameIndex(members);

  const subtotalByMember = new Map<string, Cents>(members.map((m) => [m.id, 0]));
  const credit = (memberId: string, amount: Cents) =>
    subtotalByMember.set(memberId, (subtotalByMember.get(memberId) ?? 0) + amount);

  const resolve = (names: string[], tempId: string): (GroupMember | null)[] =>
    names.map((name) => {
      const matches = byName.get(normalizeName(name));
      if (!matches || matches.length === 0) {
        warn(
          "unknown_member_name",
          `"${name}" doesn't match anyone in this group.`,
          tempId,
        );
        return null;
      }
      if (matches.length > 1) {
        warn(
          "ambiguous_member_name",
          `"${name}" matches ${matches.length} members — assign this one by hand.`,
          tempId,
        );
        return null;
      }
      return matches[0];
    });

  // --- Index assignments by line item ------------------------------------
  const assignmentFor = new Map<string, ParsedReceipt["assignments"][number]>();
  for (const a of parsed.assignments) {
    if (assignmentFor.has(a.line_item_temp_id)) {
      warn(
        "duplicate_assignment",
        `Two assignments were returned for the same item; using the first.`,
        a.line_item_temp_id,
      );
      continue;
    }
    assignmentFor.set(a.line_item_temp_id, a);
  }

  // --- Per-item apportionment --------------------------------------------
  let itemsTotal: Cents = 0;

  for (const item of parsed.line_items) {
    const lineTotal = toCents(item.line_total, currency);
    itemsTotal += lineTotal;

    const assignment = assignmentFor.get(item.temp_id);
    let participants: GroupMember[] = [];
    let weights: number[] = [];

    if (assignment && assignment.member_names.length > 0) {
      const resolved = resolve(assignment.member_names, item.temp_id);

      // Filter names and share weights together so weights stay aligned to
      // the people they were written for.
      const usesShares = assignment.split_type === "shares";
      const sharesAligned =
        usesShares && assignment.shares.length === assignment.member_names.length;

      if (usesShares && !sharesAligned) {
        warn(
          "invalid_shares",
          `Share weights don't line up with the names on "${item.description}"; split evenly instead.`,
          item.temp_id,
        );
      }

      resolved.forEach((member, i) => {
        if (!member) return;
        participants.push(member);
        weights.push(sharesAligned ? assignment.shares[i] : 1);
      });

      if (usesShares && sharesAligned && !isUsableWeighting(weights)) {
        warn(
          "invalid_shares",
          `Share weights on "${item.description}" aren't usable; split evenly instead.`,
          item.temp_id,
        );
        weights = participants.map(() => 1);
      }
    }

    // No assignment, or nobody on it resolved. Fall back to the handover's
    // safe default — everyone — and say so, rather than dropping the item
    // and letting its cost resurface somewhere else.
    if (participants.length === 0) {
      warn(
        "unassigned_item",
        `"${item.description}" wasn't assigned to anyone; split across everyone.`,
        item.temp_id,
      );
      participants = members;
      weights = members.map(() => 1);
    }

    const parts = apportion(
      lineTotal,
      weights,
      participants.map((m) => m.id),
    );
    participants.forEach((m, i) => credit(m.id, parts[i]));
  }

  // --- WHOLE_BILL and the unitemized remainder ---------------------------
  // The draft never handled `WHOLE_BILL` at all: it looked assignments up by
  // line item, so a whole-bill entry matched nothing and the entire bill fell
  // through to the drift correction. It covers whatever part of the subtotal
  // the line items didn't — which for an unitemized bill is all of it.
  const subtotalCents = toCents(parsed.subtotal, currency);
  const remainder = subtotalCents - itemsTotal;

  if (remainder > 0) {
    const wholeBill = assignmentFor.get(WHOLE_BILL);
    let participants: GroupMember[] = [];
    let weights: number[] = [];

    if (wholeBill && wholeBill.member_names.length > 0) {
      const resolved = resolve(wholeBill.member_names, WHOLE_BILL);
      const sharesAligned =
        wholeBill.split_type === "shares" &&
        wholeBill.shares.length === wholeBill.member_names.length;
      resolved.forEach((member, i) => {
        if (!member) return;
        participants.push(member);
        weights.push(sharesAligned ? wholeBill.shares[i] : 1);
      });
      if (participants.length > 0 && !isUsableWeighting(weights)) {
        weights = participants.map(() => 1);
      }
    }

    if (participants.length === 0) {
      if (parsed.line_items.length > 0) {
        warn(
          "subtotal_mismatch",
          `The line items are ${fmt(remainder)} short of the subtotal; the difference was split across everyone.`,
        );
      }
      participants = members;
      weights = members.map(() => 1);
    }

    const parts = apportion(
      remainder,
      weights,
      participants.map((m) => m.id),
    );
    participants.forEach((m, i) => credit(m.id, parts[i]));
  } else if (remainder < 0) {
    warn(
      "subtotal_mismatch",
      `The line items add up to ${fmt(-remainder)} more than the stated subtotal.`,
    );
  }

  // --- Tax, tip and fees, proportional to each person's subtotal ----------
  const baseTotal = sum([...subtotalByMember.values()]);
  const extras =
    toCents(parsed.tax, currency) +
    toCents(parsed.tip, currency) +
    toCents(parsed.other_charges, currency);

  const ids = members.map((m) => m.id);
  let extraParts: Cents[];
  if (extras === 0) {
    extraParts = members.map(() => 0);
  } else if (baseTotal === 0) {
    // A bill that's entirely fees — nobody has a subtotal to weight against.
    extraParts = apportion(extras, members.map(() => 1), ids);
  } else {
    extraParts = apportion(
      extras,
      members.map((m) => subtotalByMember.get(m.id) ?? 0),
      ids,
    );
  }

  const splits: FinalSplit[] = members.map((m, i) => ({
    memberId: m.id,
    memberName: m.displayName,
    amountOwed: (subtotalByMember.get(m.id) ?? 0) + extraParts[i],
  }));

  // --- Reconcile against the receipt's own total -------------------------
  // Note what is *not* happening here: the difference is not being quietly
  // added to anyone. Apportionment already sums exactly, so a gap means the
  // receipt data disagrees with itself and a human needs to look.
  const totalCents = sum(splits.map((s) => s.amountOwed));
  const grandTotal = toCents(parsed.grand_total, currency);
  if (totalCents !== grandTotal) {
    warn(
      "total_mismatch",
      `Receipt total reads ${fmt(grandTotal)}, but the items, tax and tip add up to ${fmt(totalCents)}. Check the receipt before saving.`,
    );
  }

  return { splits, warnings, totalCents };
}

/**
 * Work out who actually paid this bill, from the names the model read out of
 * the host's description.
 *
 * Separate from `computeFinalSplits` on purpose: that function answers "who
 * owes what", this one answers "who fronted the money". Balances need both,
 * and getting the second one wrong is what makes a group stop summing to zero
 * — so every failure here is a warning for the review screen and an empty
 * result, never a guess about whose card came out.
 */
export function resolvePayers(
  parsed: ParsedReceipt,
  members: GroupMember[],
  totalCents: Cents,
  currency = "USD",
): { payers: ExpensePayer[]; warnings: SplitWarning[] } {
  const warnings: SplitWarning[] = [];
  const byName = buildNameIndex(members);
  const resolved: { member: GroupMember; amountCents: Cents }[] = [];

  for (const entry of parsed.payers ?? []) {
    const name = String(entry?.member_name ?? "");
    const matches = byName.get(normalizeName(name));

    if (!matches || matches.length === 0) {
      warnings.push({
        code: "unknown_payer_name",
        message: `"${name}" was named as paying but isn't in this group — pick who paid by hand.`,
      });
      continue;
    }
    if (matches.length > 1) {
      warnings.push({
        code: "unknown_payer_name",
        message: `"${name}" matches ${matches.length} members — pick who paid by hand.`,
      });
      continue;
    }

    let amountCents = 0;
    try {
      amountCents = Math.max(0, toCents(entry.amount ?? 0, currency));
    } catch {
      amountCents = 0; // An unreadable figure means "amount unknown", not "zero paid".
    }

    // The same person named twice is one payer who put in the sum of both.
    const already = resolved.find((r) => r.member.id === matches[0].id);
    if (already) already.amountCents += amountCents;
    else resolved.push({ member: matches[0], amountCents });
  }

  if (resolved.length === 0) {
    warnings.push({
      code: "no_payer",
      message: "Nobody was named as having paid — choose who paid before saving.",
    });
    return { payers: [], warnings };
  }

  const ids = resolved.map((r) => r.member.id);
  const stated = resolved.reduce((sum, r) => sum + r.amountCents, 0);

  // Named payers but no figures: they went halves (or thirds) on the bill.
  if (stated === 0) {
    const parts = apportion(totalCents, resolved.map(() => 1), ids);
    return { payers: toPayers(ids, parts), warnings };
  }

  if (stated !== totalCents) {
    warnings.push({
      code: "payer_total_mismatch",
      message: `The amounts paid add up to ${fmt(stated)}, but the bill is ${fmt(totalCents)}. Split it in proportion — check before saving.`,
    });
    const parts = apportion(
      totalCents,
      resolved.map((r) => r.amountCents),
      ids,
    );
    return { payers: toPayers(ids, parts), warnings };
  }

  return {
    payers: resolved.map((r) => ({ memberId: r.member.id, amountPaid: r.amountCents })),
    warnings,
  };
}

/** Share one bill equally between the chosen payers. Used when the host edits by hand. */
export function payersFor(memberIds: string[], totalCents: Cents): ExpensePayer[] {
  if (memberIds.length === 0) return [];
  const parts = apportion(totalCents, memberIds.map(() => 1), memberIds);
  return toPayers(memberIds, parts);
}

function toPayers(ids: string[], parts: Cents[]): ExpensePayer[] {
  return ids.map((memberId, i) => ({ memberId, amountPaid: parts[i] }));
}

function buildNameIndex(members: GroupMember[]): Map<string, GroupMember[]> {
  const byName = new Map<string, GroupMember[]>();
  for (const m of members) {
    const key = normalizeName(m.displayName);
    byName.set(key, [...(byName.get(key) ?? []), m]);
  }
  return byName;
}

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents so "Jos\u00e9" matches "Jose"
    .replace(/\s+/g, " ");
}

function isUsableWeighting(weights: number[]): boolean {
  return (
    weights.every((w) => Number.isFinite(w) && w >= 0) &&
    weights.reduce((a, b) => a + b, 0) > 0
  );
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function fmt(cents: Cents): string {
  return `$${(Math.abs(cents) / 100).toFixed(2)}`;
}
