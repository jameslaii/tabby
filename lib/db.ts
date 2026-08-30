import { apportion, toCents, type Cents } from "./money";
import { DEFAULT_CURRENCY, isCurrency } from "./currencies";
import type { Category } from "./categories";
import type {
  ActivityEntry,
  Expense,
  ExpensePayer,
  ExpenseSplit,
  Group,
  GroupMember,
  LineItem,
  Settlement,
} from "./types";

/**
 * The whole data layer, as pure state transitions.
 *
 * Every function here takes a `Db` and returns a new one — nothing mutates,
 * nothing is held in module scope. That last part is the point. The previous
 * version kept state in a module-level variable on the server, which works
 * exactly until it's deployed: on a serverless host each request can land on a
 * different instance, so a group created by one request was invisible to the
 * next and its page 404'd. A deploy or a cold start wiped everything.
 *
 * State now lives in the browser (see components/StoreProvider.tsx), which for
 * an app with no accounts is also where it belongs: one person's groups stop
 * being visible to everyone else who opens the site.
 *
 * The shape still maps 1:1 onto supabase/schema.sql — groups, group_members,
 * expenses, expense_payers, expense_line_items, expense_splits, settlements,
 * activity_log — so moving to Postgres later is a matter of replacing these
 * bodies, not reshaping the app. Balances stay computed at read time from
 * expenses + settlements, never stored, exactly as the schema intends.
 */

export interface Db {
  version: number;
  groups: Group[];
  expenses: Expense[];
  settlements: Settlement[];
  activity: ActivityEntry[];
  /** The person using this browser. One account until auth exists. */
  currentUserId: string;
}

/** Bumped when the stored shape changes in a way older data can't satisfy. */
export const DB_VERSION = 1;

export const YOU_USER_ID = "usr-you";

const id = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

export function emptyDb(): Db {
  return {
    version: DB_VERSION,
    groups: [],
    expenses: [],
    settlements: [],
    activity: [],
    currentUserId: YOU_USER_ID,
  };
}

/**
 * Accept whatever came out of storage, or start fresh.
 *
 * Anything unrecognised is discarded rather than patched up: a half-understood
 * expense is a wrong balance, and a wrong balance is worse than an empty app.
 */
export function reviveDb(raw: unknown): Db {
  if (!raw || typeof raw !== "object") return emptyDb();
  const candidate = raw as Partial<Db>;
  if (candidate.version !== DB_VERSION) return emptyDb();
  if (
    !Array.isArray(candidate.groups) ||
    !Array.isArray(candidate.expenses) ||
    !Array.isArray(candidate.settlements) ||
    !Array.isArray(candidate.activity)
  ) {
    return emptyDb();
  }
  return {
    version: DB_VERSION,
    groups: candidate.groups,
    expenses: candidate.expenses,
    settlements: candidate.settlements,
    activity: candidate.activity,
    currentUserId: candidate.currentUserId || YOU_USER_ID,
  };
}

// ---- Reads -------------------------------------------------------------

export function getGroup(db: Db, groupId: string): Group | undefined {
  return db.groups.find((g) => g.id === groupId);
}

export function getExpenses(db: Db, groupId: string): Expense[] {
  return db.expenses
    .filter((e) => e.groupId === groupId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getSettlements(db: Db, groupId: string): Settlement[] {
  return db.settlements.filter((s) => s.groupId === groupId);
}

export function getActivity(db: Db, groupId: string): ActivityEntry[] {
  return db.activity
    .filter((a) => a.groupId === groupId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * The signed-in person's member row *in this group*, or null if they aren't in
 * it. Null is a real answer — you can hold a group you don't belong to — and
 * callers show group totals without a personal position rather than reporting
 * a misleading zero.
 */
export function currentMemberId(db: Db, groupId: string): string | null {
  const member = getGroup(db, groupId)?.members.find(
    (m) => m.userId === db.currentUserId,
  );
  return member?.id ?? null;
}

export function getUncategorized(db: Db, groupId: string): Expense[] {
  return db.expenses.filter((e) => e.groupId === groupId && e.category === null);
}

// ---- Writes ------------------------------------------------------------

function withActivity(
  db: Db,
  entry: Omit<ActivityEntry, "id" | "createdAt">,
): Db {
  return {
    ...db,
    activity: [...db.activity, { ...entry, id: id(), createdAt: now() }],
  };
}

function nameOf(db: Db, groupId: string, memberId: string): string {
  return (
    getGroup(db, groupId)?.members.find((m) => m.id === memberId)?.displayName ??
    "Someone"
  );
}

/**
 * Start a group with the people already in it.
 *
 * Members are named up front because a split needs them: an expense can only
 * be shared between people the group knows about, so a group of one is a group
 * that can't do anything. Returns the new group so the caller can navigate to
 * it without searching for it.
 */
export function createGroup(
  db: Db,
  input: {
    name: string;
    emoji: string;
    memberNames: string[];
    currency?: string;
  },
): { db: Db; group: Group } {
  const you: GroupMember = {
    id: id(),
    displayName: "You",
    userId: db.currentUserId,
    isGhost: false,
  };

  const others: GroupMember[] = [];
  for (const raw of input.memberNames) {
    const name = raw.trim();
    if (!name) continue;
    // The split logic can't tell two identically-named members apart — it
    // flags the ambiguity rather than guessing — so stop it at the door.
    if (isTaken(name, [you, ...others])) continue;
    others.push({ id: id(), displayName: name, userId: null, isGhost: true });
  }

  const group: Group = {
    id: id(),
    name: input.name.trim() || "New group",
    emoji: input.emoji || "🐈",
    defaultCurrency: isCurrency(input.currency)
      ? input.currency
      : DEFAULT_CURRENCY,
    members: [you, ...others],
  };

  const next = withActivity({ ...db, groups: [...db.groups, group] }, {
    groupId: group.id,
    action: "group_created",
    summary: `${group.name} created`,
    entityId: null,
  });

  return { db: next, group };
}

export function renameGroup(db: Db, groupId: string, name: string): Db {
  const trimmed = name.trim();
  if (!trimmed) return db;
  return {
    ...db,
    groups: db.groups.map((g) =>
      g.id === groupId ? { ...g, name: trimmed } : g,
    ),
  };
}

export function addMember(
  db: Db,
  groupId: string,
  displayName: string,
): { db: Db; error?: string } {
  const group = getGroup(db, groupId);
  if (!group) return { db, error: "Group not found." };

  const name = displayName.trim();
  if (!name) return { db, error: "A member needs a name." };
  if (isTaken(name, group.members)) {
    return { db, error: `This group already has someone called "${name}".` };
  }

  const member: GroupMember = {
    id: id(),
    displayName: name,
    userId: null,
    isGhost: true,
  };

  const next = withActivity(
    {
      ...db,
      groups: db.groups.map((g) =>
        g.id === groupId ? { ...g, members: [...g.members, member] } : g,
      ),
    },
    {
      groupId,
      action: "member_added",
      summary: `${name} was added to the group`,
      entityId: member.id,
    },
  );

  return { db: next };
}

/**
 * Remove someone who isn't part of anything yet.
 *
 * Refused once they appear on an expense or a settlement: their share is
 * already baked into amounts other people owe, so dropping the row would leave
 * money owed to nobody and the group would stop summing to zero.
 */
export function removeMember(
  db: Db,
  groupId: string,
  memberId: string,
): { db: Db; error?: string } {
  const group = getGroup(db, groupId);
  if (!group) return { db, error: "Group not found." };

  const member = group.members.find((m) => m.id === memberId);
  if (!member) return { db, error: "They're not in this group." };
  if (member.userId === db.currentUserId) {
    return { db, error: "You can't remove yourself from a group." };
  }

  const involved =
    db.expenses.some(
      (e) =>
        e.groupId === groupId &&
        (e.payers.some((p) => p.memberId === memberId) ||
          e.splits.some((s) => s.memberId === memberId && s.amountOwed !== 0)),
    ) ||
    db.settlements.some(
      (s) =>
        s.groupId === groupId &&
        (s.fromMember === memberId || s.toMember === memberId),
    );

  if (involved) {
    return {
      db,
      error: `${member.displayName} is already on an expense — settle up instead of removing them.`,
    };
  }

  return {
    db: {
      ...db,
      groups: db.groups.map((g) =>
        g.id === groupId
          ? { ...g, members: g.members.filter((m) => m.id !== memberId) }
          : g,
      ),
    },
  };
}

/** Build an equal-split expense. */
function equalExpense(input: {
  groupId: string;
  description: string;
  category: Category | null;
  categorySource: "ai" | "manual" | null;
  payers: ExpensePayer[];
  participantIds: string[];
  totalCents: Cents;
  currency: string;
}): Expense {
  const parts = apportion(
    input.totalCents,
    input.participantIds.map(() => 1),
    input.participantIds,
  );

  return {
    id: id(),
    groupId: input.groupId,
    description: input.description,
    category: input.category,
    categorySource: input.categorySource,
    totalAmount: input.totalCents,
    currency: input.currency,
    expenseDate: today(),
    sourceType: "manual",
    receiptImageUrl: null,
    rawComment: null,
    rawTranscript: null,
    lineItems: [],
    payers: input.payers,
    splits: input.participantIds.map((memberId, i) => ({
      memberId,
      lineItemId: null,
      splitType: "equal" as const,
      shareValue: null,
      amountOwed: parts[i],
    })),
    createdAt: now(),
  };
}

export function addManualExpense(
  db: Db,
  input: {
    groupId: string;
    description: string;
    category: Category | null;
    amount: string;
    payerId: string;
    participantIds: string[];
  },
): { db: Db; error?: string } {
  const group = getGroup(db, input.groupId);
  if (!group) return { db, error: "Group not found." };

  const description = input.description.trim();
  if (!description) return { db, error: "Give the expense a description." };

  let totalCents: Cents;
  try {
    totalCents = toCents(input.amount, group.defaultCurrency);
  } catch {
    return { db, error: "That amount doesn't look like a number." };
  }
  if (totalCents <= 0) {
    return { db, error: "An expense has to be for a positive amount." };
  }

  if (!group.members.some((m) => m.id === input.payerId)) {
    return { db, error: "Pick who paid." };
  }

  const participantIds = [...new Set(input.participantIds)];
  if (participantIds.length === 0) {
    return { db, error: "Pick at least one person to split between." };
  }
  if (!participantIds.every((p) => group.members.some((m) => m.id === p))) {
    return { db, error: "Someone in that split isn't in this group." };
  }

  const expense = equalExpense({
    groupId: input.groupId,
    currency: group.defaultCurrency,
    description,
    category: input.category,
    categorySource: input.category ? "manual" : null,
    payers: [{ memberId: input.payerId, amountPaid: totalCents }],
    participantIds,
    totalCents,
  });

  const next = withActivity({ ...db, expenses: [...db.expenses, expense] }, {
    groupId: input.groupId,
    action: "expense_created",
    summary: `${nameOf(db, input.groupId, input.payerId)} added ${description}`,
    entityId: expense.id,
  });

  return { db: next };
}

export interface ItemizedExpenseInput {
  description: string;
  totalCents: Cents;
  lineItems: LineItem[];
  splits: ExpenseSplit[];
  payers: ExpensePayer[];
  rawComment: string | null;
}

/**
 * Save a reviewed outing — one or more receipts, each its own expense.
 *
 * All-or-nothing: every receipt is validated before any is written. A
 * half-saved outing leaves balances that are real but incomplete, and nothing
 * on the group page says which half made it.
 */
export function addItemizedExpenses(
  db: Db,
  groupId: string,
  receipts: ItemizedExpenseInput[],
): { db: Db; error?: string } {
  const group = getGroup(db, groupId);
  if (!group) return { db, error: "Group not found." };
  if (receipts.length === 0) return { db, error: "There's nothing to save." };

  for (const receipt of receipts) {
    if (receipt.totalCents <= 0) {
      return { db, error: `"${receipt.description}" doesn't add up to anything to split.` };
    }
    if (receipt.payers.length === 0) {
      return { db, error: `Choose who paid for "${receipt.description}".` };
    }

    // Payers are checked as hard as splits. Money recorded against someone who
    // isn't in the group drops out of balances while the debts stay, the group
    // stops summing to zero, and debt simplification refuses to run.
    const seen = new Set<string>();
    let paid = 0;
    for (const payer of receipt.payers) {
      if (!group.members.some((m) => m.id === payer.memberId)) {
        return { db, error: `Whoever paid for "${receipt.description}" isn't in this group.` };
      }
      if (seen.has(payer.memberId)) {
        return { db, error: `The same person is listed twice as paying for "${receipt.description}".` };
      }
      seen.add(payer.memberId);
      paid += payer.amountPaid;
    }
    if (paid !== receipt.totalCents) {
      return {
        db,
        error: `What was paid for "${receipt.description}" doesn't match its total.`,
      };
    }

    const owed = receipt.splits.reduce((sum, s) => sum + s.amountOwed, 0);
    if (owed !== receipt.totalCents) {
      return { db, error: `The split of "${receipt.description}" doesn't add up to its total.` };
    }
    if (!receipt.splits.every((s) => group.members.some((m) => m.id === s.memberId))) {
      return { db, error: `Someone on "${receipt.description}" isn't in this group.` };
    }
  }

  let next = db;
  for (const receipt of receipts) {
    const expense: Expense = {
      id: id(),
      groupId,
      description: receipt.description,
      category: null,
      categorySource: null,
      totalAmount: receipt.totalCents,
      currency: group.defaultCurrency,
      expenseDate: today(),
      sourceType: "receipt_ai",
      receiptImageUrl: null,
      rawComment: receipt.rawComment,
      rawTranscript: null,
      lineItems: receipt.lineItems,
      payers: receipt.payers,
      splits: receipt.splits,
      createdAt: now(),
    };

    const payer = [...receipt.payers].sort(
      (a, b) => b.amountPaid - a.amountPaid,
    )[0];

    next = withActivity({ ...next, expenses: [...next.expenses, expense] }, {
      groupId,
      action: "expense_created",
      summary: `${nameOf(next, groupId, payer.memberId)} added ${receipt.description} from a receipt`,
      entityId: expense.id,
    });
  }

  return { db: next };
}

export function getExpense(db: Db, expenseId: string): Expense | undefined {
  return db.expenses.find((e) => e.id === expenseId);
}

/**
 * Correct a saved expense.
 *
 * Every editable field arrives at once, and what happens to the split is
 * decided from what actually moved:
 *
 * - Description, category or payer alone — the split is left exactly as it
 *   was. That matters most for a scanned receipt, where the split is an
 *   itemized one that a re-derivation could not reproduce.
 * - A different total, or a different set of people — the split is rebuilt as
 *   an even one, and any line items are dropped. They summed to the old total
 *   and would contradict the new one, and a stored breakdown that disagrees
 *   with the expense above it is worse than no breakdown at all.
 *
 * The caller warns about the second case before it happens; see
 * `splitWillReset`.
 */
export function updateExpense(
  db: Db,
  expenseId: string,
  changes: {
    description: string;
    category: Category | null;
    amount: string;
    payerIds: string[];
    participantIds: string[];
  },
): { db: Db; error?: string } {
  const expense = getExpense(db, expenseId);
  if (!expense) return { db, error: "That expense no longer exists." };

  const group = getGroup(db, expense.groupId);
  if (!group) return { db, error: "Group not found." };

  const description = changes.description.trim();
  if (!description) return { db, error: "Give the expense a description." };

  let totalCents: Cents;
  try {
    totalCents = toCents(changes.amount, expense.currency);
  } catch {
    return { db, error: "That amount doesn't look like a number." };
  }
  if (totalCents <= 0) {
    return { db, error: "An expense has to be for a positive amount." };
  }

  const payerIds = [...new Set(changes.payerIds)];
  if (payerIds.length === 0) return { db, error: "Pick who paid." };
  if (!payerIds.every((id) => group.members.some((m) => m.id === id))) {
    return { db, error: "Whoever paid isn't in this group." };
  }

  const participantIds = [...new Set(changes.participantIds)];
  if (participantIds.length === 0) {
    return { db, error: "Pick at least one person to split between." };
  }
  if (!participantIds.every((id) => group.members.some((m) => m.id === id))) {
    return { db, error: "Someone in that split isn't in this group." };
  }

  const totalChanged = totalCents !== expense.totalAmount;
  const peopleChanged = !sameMembers(
    participantIds,
    expense.splits.map((s) => s.memberId),
  );
  const resetSplit = totalChanged || peopleChanged;

  const splits: ExpenseSplit[] = resetSplit
    ? apportion(
        totalCents,
        participantIds.map(() => 1),
        participantIds,
      ).map((amountOwed, i) => ({
        memberId: participantIds[i],
        lineItemId: null,
        splitType: "equal" as const,
        shareValue: null,
        amountOwed,
      }))
    : expense.splits;

  // Payers keep their existing amounts only while both the people and the
  // total stand still; otherwise what they put in can't still add up.
  const payersUnchanged =
    !totalChanged && sameMembers(payerIds, expense.payers.map((p) => p.memberId));
  const payers: ExpensePayer[] = payersUnchanged
    ? expense.payers
    : apportion(
        totalCents,
        payerIds.map(() => 1),
        payerIds,
      ).map((amountPaid, i) => ({ memberId: payerIds[i], amountPaid }));

  const updated: Expense = {
    ...expense,
    description,
    category: changes.category,
    categorySource: changes.category ? "manual" : null,
    totalAmount: totalCents,
    lineItems: resetSplit ? [] : expense.lineItems,
    splits,
    payers,
  };

  const next = withActivity(
    {
      ...db,
      expenses: db.expenses.map((e) => (e.id === expenseId ? updated : e)),
    },
    {
      groupId: expense.groupId,
      action: "expense_updated",
      summary: `${description} was edited`,
      entityId: expense.id,
    },
  );

  return { db: next };
}

/** Whether saving these changes would replace an itemized split with an even one. */
export function splitWillReset(
  expense: Expense,
  amountCents: Cents,
  participantIds: string[],
): boolean {
  if (expense.lineItems.length === 0) return false;
  return (
    amountCents !== expense.totalAmount ||
    !sameMembers(participantIds, expense.splits.map((s) => s.memberId))
  );
}

export function deleteExpense(db: Db, expenseId: string): Db {
  const expense = getExpense(db, expenseId);
  if (!expense) return db;

  return withActivity(
    { ...db, expenses: db.expenses.filter((e) => e.id !== expenseId) },
    {
      groupId: expense.groupId,
      action: "expense_deleted",
      summary: `${expense.description} was deleted`,
      entityId: null,
    },
  );
}

function sameMembers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * Apply classification results.
 *
 * A `manual` category is never overwritten: if someone picked "Groceries" for
 * the corner-shop run, a later batch must not quietly relabel it.
 */
export function setCategories(
  db: Db,
  groupId: string,
  updates: Record<string, Category>,
): Db {
  return {
    ...db,
    expenses: db.expenses.map((expense) => {
      if (expense.groupId !== groupId) return expense;
      if (expense.categorySource === "manual") return expense;
      const next = updates[expense.id];
      if (!next || next === expense.category) return expense;
      return { ...expense, category: next, categorySource: "ai" as const };
    }),
  };
}

export function setCategoryManually(
  db: Db,
  expenseId: string,
  category: Category,
): Db {
  return {
    ...db,
    expenses: db.expenses.map((e) =>
      e.id === expenseId
        ? { ...e, category, categorySource: "manual" as const }
        : e,
    ),
  };
}

export function addSettlement(
  db: Db,
  input: {
    groupId: string;
    fromMember: string;
    toMember: string;
    amount: string;
    note: string | null;
  },
): { db: Db; error?: string } {
  const group = getGroup(db, input.groupId);
  if (!group) return { db, error: "Group not found." };

  const isMember = (memberId: string) =>
    group.members.some((m) => m.id === memberId);
  if (!isMember(input.fromMember) || !isMember(input.toMember)) {
    return { db, error: "Both people have to be in this group." };
  }
  if (input.fromMember === input.toMember) {
    return { db, error: "A settlement can't be between one person and themselves." };
  }

  let amountCents: Cents;
  try {
    amountCents = toCents(input.amount, group.defaultCurrency);
  } catch {
    return { db, error: "That amount doesn't look like a number." };
  }
  if (amountCents <= 0) {
    return { db, error: "A settlement has to be for a positive amount." };
  }

  const settlement: Settlement = {
    id: id(),
    groupId: input.groupId,
    fromMember: input.fromMember,
    toMember: input.toMember,
    amount: amountCents,
    currency: group.defaultCurrency,
    note: input.note,
    settledAt: now(),
  };

  const next = withActivity(
    { ...db, settlements: [...db.settlements, settlement] },
    {
      groupId: input.groupId,
      action: "settled_up",
      summary: `${nameOf(db, input.groupId, input.fromMember)} paid ${nameOf(db, input.groupId, input.toMember)}`,
      entityId: settlement.id,
    },
  );

  return { db: next };
}

export function deleteGroup(db: Db, groupId: string): Db {
  return {
    ...db,
    groups: db.groups.filter((g) => g.id !== groupId),
    expenses: db.expenses.filter((e) => e.groupId !== groupId),
    settlements: db.settlements.filter((s) => s.groupId !== groupId),
    activity: db.activity.filter((a) => a.groupId !== groupId),
  };
}

function isTaken(name: string, members: GroupMember[]): boolean {
  const key = name.trim().toLowerCase();
  return members.some((m) => m.displayName.trim().toLowerCase() === key);
}
