import { apportion, toCents, type Cents } from "./money";
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
 * In-memory store for the v1 prototype.
 *
 * Everything here maps 1:1 onto supabase/schema.sql — groups, group_members,
 * expenses, expense_payers, expense_line_items, expense_splits, settlements,
 * activity_log — so swapping this for a Supabase client is a matter of
 * replacing the function bodies, not reshaping the app. Balances are computed
 * at read time from expenses + settlements, never stored, exactly as the
 * schema intends.
 *
 * State lives in module scope and resets when the server restarts. That is
 * fine for a prototype and deliberately not fine for anything else.
 */

interface Db {
  groups: Group[];
  expenses: Expense[];
  settlements: Settlement[];
  activity: ActivityEntry[];
  /**
   * The signed-in user, stubbed until Supabase auth is wired up.
   *
   * A *user* id, not a member id. Every group holds its own `group_members`
   * row for this person, so identity has to sit one level above membership:
   * holding a member id here made "me" mean whichever group was created last.
   */
  currentUserId: string;
}

const id = () => crypto.randomUUID();

/** The stubbed signed-in account. One `users` row, present in every group. */
export const DEMO_USER_ID = "usr-you";

function seed(): Db {
  const members: GroupMember[] = [
    { id: "mem-you", displayName: "You", userId: DEMO_USER_ID, isGhost: false },
    { id: "mem-sarah", displayName: "Sarah", userId: "usr-sarah", isGhost: false },
    { id: "mem-john", displayName: "John", userId: null, isGhost: true },
    { id: "mem-alex", displayName: "Alex", userId: "usr-alex", isGhost: false },
  ];

  const group: Group = {
    id: "grp-lisbon",
    name: "Lisbon Trip",
    emoji: "🇵🇹",
    defaultCurrency: "USD",
    members,
  };

  const dinner = manualExpense({
    groupId: group.id,
    description: "Tasca dinner",
    category: null,
    categorySource: null,
    payers: [["mem-you", 12000]],
    participantIds: members.map((m) => m.id),
    totalCents: 12000,
  });

  const taxi = manualExpense({
    groupId: group.id,
    description: "Airport taxi",
    category: "Transport",
    categorySource: "manual",
    payers: [["mem-sarah", 4500]],
    participantIds: ["mem-you", "mem-sarah", "mem-alex"],
    totalCents: 4500,
  });

  return {
    groups: [group],
    expenses: [dinner, taxi],
    settlements: [],
    activity: [
      {
        id: id(),
        groupId: group.id,
        action: "group_created",
        summary: "Lisbon Trip created",
        entityId: null,
        createdAt: new Date(Date.now() - 864e5 * 3).toISOString(),
      },
      {
        id: id(),
        groupId: group.id,
        action: "expense_created",
        summary: "You added Tasca dinner — $120.00",
        entityId: dinner.id,
        createdAt: dinner.createdAt,
      },
      {
        id: id(),
        groupId: group.id,
        action: "expense_created",
        summary: "Sarah added Airport taxi — $45.00",
        entityId: taxi.id,
        createdAt: taxi.createdAt,
      },
    ],
    currentUserId: DEMO_USER_ID,
  };
}

/** Survives Next.js dev-server module reloads. */
const globalForDb = globalThis as unknown as { __tabbyDb?: Db };
export const db: Db = (globalForDb.__tabbyDb ??= seed());

// ---- Reads -------------------------------------------------------------

export function listGroups(): Group[] {
  return db.groups;
}

export function getGroup(groupId: string): Group | undefined {
  return db.groups.find((g) => g.id === groupId);
}

export function getExpenses(groupId: string): Expense[] {
  return db.expenses
    .filter((e) => e.groupId === groupId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getSettlements(groupId: string): Settlement[] {
  return db.settlements.filter((s) => s.groupId === groupId);
}

export function getActivity(groupId: string): ActivityEntry[] {
  return db.activity
    .filter((a) => a.groupId === groupId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function currentUserId(): string {
  return db.currentUserId;
}

/**
 * The signed-in user's member row *in this group*, or null if they aren't in
 * it. Null is a real answer — you can hold a link to a group you don't belong
 * to — and callers show group totals without a personal position rather than
 * silently reporting zero.
 */
export function currentMemberId(groupId: string): string | null {
  const member = getGroup(groupId)?.members.find(
    (m) => m.userId === db.currentUserId,
  );
  return member?.id ?? null;
}

// ---- Writes ------------------------------------------------------------

function logActivity(entry: Omit<ActivityEntry, "id" | "createdAt">) {
  db.activity.push({ ...entry, id: id(), createdAt: new Date().toISOString() });
}

/** Build an equal-split expense. Used by the seed and by manual entry. */
function manualExpense(input: {
  groupId: string;
  description: string;
  category: Category | null;
  categorySource: "ai" | "manual" | null;
  payers: [string, Cents][];
  participantIds: string[];
  totalCents: Cents;
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
    currency: "USD",
    expenseDate: new Date().toISOString().slice(0, 10),
    sourceType: "manual",
    receiptImageUrl: null,
    rawComment: null,
    rawTranscript: null,
    lineItems: [],
    payers: input.payers.map(([memberId, amountPaid]) => ({ memberId, amountPaid })),
    splits: input.participantIds.map((memberId, i) => ({
      memberId,
      lineItemId: null,
      splitType: "equal" as const,
      shareValue: null,
      amountOwed: parts[i],
    })),
    createdAt: new Date().toISOString(),
  };
}

export function addManualExpense(input: {
  groupId: string;
  description: string;
  category: Category | null;
  amount: string;
  payerId: string;
  participantIds: string[];
}): Expense {
  const totalCents = toCents(input.amount);
  const expense = manualExpense({
    groupId: input.groupId,
    description: input.description,
    category: input.category,
    categorySource: input.category ? "manual" : null,
    payers: [[input.payerId, totalCents]],
    participantIds: input.participantIds,
    totalCents,
  });

  db.expenses.push(expense);
  logActivity({
    groupId: input.groupId,
    action: "expense_created",
    summary: `${nameOf(input.groupId, input.payerId)} added ${expense.description}`,
    entityId: expense.id,
  });
  return expense;
}

export function addItemizedExpense(input: {
  groupId: string;
  description: string;
  payerId: string;
  totalCents: Cents;
  lineItems: LineItem[];
  splits: ExpenseSplit[];
  rawComment: string | null;
  payers?: ExpensePayer[];
}): Expense {
  const expense: Expense = {
    id: id(),
    groupId: input.groupId,
    description: input.description,
    category: null,
    categorySource: null,
    totalAmount: input.totalCents,
    currency: "USD",
    expenseDate: new Date().toISOString().slice(0, 10),
    sourceType: "receipt_ai",
    receiptImageUrl: null,
    rawComment: input.rawComment,
    rawTranscript: null,
    lineItems: input.lineItems,
    payers: input.payers ?? [{ memberId: input.payerId, amountPaid: input.totalCents }],
    splits: input.splits,
    createdAt: new Date().toISOString(),
  };

  db.expenses.push(expense);
  logActivity({
    groupId: input.groupId,
    action: "expense_created",
    summary: `${nameOf(input.groupId, input.payerId)} added ${expense.description} from a receipt`,
    entityId: expense.id,
  });
  return expense;
}

/** Expenses that have never been categorized, oldest first. */
export function getUncategorized(groupId: string): Expense[] {
  return db.expenses.filter((e) => e.groupId === groupId && e.category === null);
}

/**
 * Apply classification results.
 *
 * A `manual` category is never overwritten: if someone picked "Groceries" for
 * the corner-shop run, a later batch run must not quietly relabel it.
 */
export function setCategories(
  groupId: string,
  updates: Record<string, Category>,
): number {
  let applied = 0;
  for (const expense of db.expenses) {
    if (expense.groupId !== groupId) continue;
    if (expense.categorySource === "manual") continue;

    const next = updates[expense.id];
    if (!next || next === expense.category) continue;

    expense.category = next;
    expense.categorySource = "ai";
    applied += 1;
  }
  return applied;
}

export function addSettlement(input: {
  groupId: string;
  fromMember: string;
  toMember: string;
  amountCents: Cents;
  note: string | null;
}): Settlement {
  if (input.fromMember === input.toMember) {
    throw new Error("A settlement can't be between one person and themselves.");
  }
  if (input.amountCents <= 0) {
    throw new Error("A settlement has to be for a positive amount.");
  }

  const settlement: Settlement = {
    id: id(),
    groupId: input.groupId,
    fromMember: input.fromMember,
    toMember: input.toMember,
    amount: input.amountCents,
    currency: "USD",
    note: input.note,
    settledAt: new Date().toISOString(),
  };

  db.settlements.push(settlement);
  logActivity({
    groupId: input.groupId,
    action: "settled_up",
    summary: `${nameOf(input.groupId, input.fromMember)} paid ${nameOf(input.groupId, input.toMember)}`,
    entityId: settlement.id,
  });
  return settlement;
}

export function addMember(groupId: string, displayName: string): GroupMember {
  const group = getGroup(groupId);
  if (!group) throw new Error("Group not found");

  const trimmed = displayName.trim();
  if (!trimmed) throw new Error("A member needs a name.");

  // The split logic can't tell two identically-named members apart — it flags
  // the ambiguity rather than guessing — so stop the collision at the door.
  const clash = group.members.some(
    (m) => m.displayName.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (clash) {
    throw new Error(`This group already has someone called "${trimmed}".`);
  }

  const member: GroupMember = {
    id: id(),
    displayName: trimmed,
    userId: null,
    isGhost: true,
  };
  group.members.push(member);
  logActivity({
    groupId,
    action: "member_added",
    summary: `${trimmed} was added to the group`,
    entityId: member.id,
  });
  return member;
}

export function createGroup(name: string, emoji: string): Group {
  const group: Group = {
    id: id(),
    name: name.trim() || "New group",
    emoji: emoji || "🐈",
    defaultCurrency: "USD",
    members: [
      {
        id: id(),
        displayName: "You",
        userId: db.currentUserId,
        isGhost: false,
      },
    ],
  };
  db.groups.push(group);
  logActivity({
    groupId: group.id,
    action: "group_created",
    summary: `${group.name} created`,
    entityId: null,
  });
  return group;
}

function nameOf(groupId: string, memberId: string): string {
  return (
    getGroup(groupId)?.members.find((m) => m.id === memberId)?.displayName ??
    "Someone"
  );
}
