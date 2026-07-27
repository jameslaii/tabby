import type { Cents } from "./money";
import type { Expense, GroupMember, Settlement } from "./types";

export interface Balance {
  memberId: string;
  displayName: string;
  /** Positive: the group owes them. Negative: they owe the group. */
  net: Cents;
}

export interface Transfer {
  fromMemberId: string;
  toMemberId: string;
  amount: Cents;
}

/**
 * Net position per member, derived from expenses and settlements at read time
 * (HANDOVER.md: balances are computed, never stored).
 *
 * net = everything you paid − everything you owe.
 * A settlement is a payment: it raises the sender's net and lowers the
 * recipient's by the same amount, so the group total stays at zero.
 */
export function computeBalances(
  members: GroupMember[],
  expenses: Expense[],
  settlements: Settlement[],
): Balance[] {
  const net = new Map<string, Cents>(members.map((m) => [m.id, 0]));
  const add = (memberId: string, amount: Cents) => {
    // Ignore rows pointing at members of another group. The schema's foreign
    // keys reference group_members(id) globally, so nothing at the database
    // level stops a cross-group reference from being inserted.
    if (!net.has(memberId)) return;
    net.set(memberId, (net.get(memberId) ?? 0) + amount);
  };

  for (const expense of expenses) {
    for (const payer of expense.payers) add(payer.memberId, payer.amountPaid);
    for (const split of expense.splits) add(split.memberId, -split.amountOwed);
  }

  for (const s of settlements) {
    add(s.fromMember, s.amount);
    add(s.toMember, -s.amount);
  }

  return members.map((m) => ({
    memberId: m.id,
    displayName: m.displayName,
    net: net.get(m.id) ?? 0,
  }));
}

/**
 * Collapse balances into the fewest payments that settle the group.
 *
 * Greedy, as scoped in the handover: repeatedly match the largest creditor
 * with the largest debtor and move the smaller of the two amounts. Each pass
 * zeroes at least one party, so it emits at most n−1 transfers and always
 * terminates.
 *
 * Everything is integer cents, which is what makes that guarantee hold — the
 * float version of this loop can spin forever on a residual like 1e-14 that
 * never compares equal to zero.
 */
export function simplifyDebts(balances: Balance[]): Transfer[] {
  const byMagnitude = (a: Balance, b: Balance) =>
    Math.abs(b.net) - Math.abs(a.net) ||
    (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0);

  const creditors = balances.filter((b) => b.net > 0).sort(byMagnitude);
  const debtors = balances.filter((b) => b.net < 0).sort(byMagnitude);

  const owedTotal = creditors.reduce((s, c) => s + c.net, 0);
  const debtTotal = debtors.reduce((s, d) => s - d.net, 0);
  if (owedTotal !== debtTotal) {
    throw new Error(
      `Balances don't sum to zero (owed ${owedTotal}¢, debt ${debtTotal}¢) — refusing to simplify.`,
    );
  }

  const transfers: Transfer[] = [];
  const remaining = new Map<string, Cents>(
    balances.map((b) => [b.memberId, b.net]),
  );

  let ci = 0;
  let di = 0;
  // Every iteration either emits a transfer (which zeroes at least one party,
  // so at most n−1 of those) or steps past an exhausted one (at most n of
  // those). The bound is a tripwire against a logic error, not the thing that
  // makes the loop terminate — integer cents do that.
  const maxIterations = 2 * (creditors.length + debtors.length) + 1;
  let iterations = 0;

  while (ci < creditors.length && di < debtors.length) {
    if (++iterations > maxIterations) {
      throw new Error("simplifyDebts failed to converge");
    }

    const creditor = creditors[ci];
    const debtor = debtors[di];
    const credit = remaining.get(creditor.memberId) ?? 0;
    const debt = -(remaining.get(debtor.memberId) ?? 0);

    if (credit === 0) { ci++; continue; }
    if (debt === 0) { di++; continue; }

    const amount = Math.min(credit, debt);
    transfers.push({
      fromMemberId: debtor.memberId,
      toMemberId: creditor.memberId,
      amount,
    });

    remaining.set(creditor.memberId, credit - amount);
    remaining.set(debtor.memberId, -(debt - amount));
  }

  return transfers;
}

/** What one member owes or is owed, for the "you" line at the top of a group. */
export function balanceFor(
  balances: Balance[],
  memberId: string,
): Cents {
  return balances.find((b) => b.memberId === memberId)?.net ?? 0;
}
