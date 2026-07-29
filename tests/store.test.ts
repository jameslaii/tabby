import { beforeEach, describe, expect, it } from "vitest";
import {
  addManualExpense,
  createGroup,
  currentMemberId,
  currentUserId,
  db,
  getExpenses,
  getGroup,
  getSettlements,
} from "../lib/store";
import { balanceFor, computeBalances } from "../lib/balances";

/**
 * The store is module-scoped singleton state, so each test starts by putting
 * it back to a known shape rather than assuming a fresh import.
 */
const SEEDED_GROUP = "grp-lisbon";

beforeEach(() => {
  db.groups = db.groups.filter((g) => g.id === SEEDED_GROUP);
  db.expenses = db.expenses.filter((e) => e.groupId === SEEDED_GROUP);
  db.settlements = [];
});

describe("who 'me' is", () => {
  it("resolves to this user's member row in the group asked about", () => {
    expect(currentMemberId(SEEDED_GROUP)).toBe("mem-you");
  });

  it("is null for a group the user isn't in", () => {
    expect(currentMemberId("grp-does-not-exist")).toBeNull();
  });

  /**
   * The regression this file exists for.
   *
   * `createGroup` used to repoint a single global "current member id" at the
   * new group's You. Every earlier group then had no member matching it, so
   * the balance lookup fell through to its `?? 0` default and the group page
   * announced "You're all settled up" over a real outstanding debt.
   */
  it("still points at the old group's member after a new group is made", () => {
    const before = currentMemberId(SEEDED_GROUP);

    createGroup("Ski trip", "🎿");

    expect(currentMemberId(SEEDED_GROUP)).toBe(before);
  });

  it("keeps an outstanding position visible in the first group after making a second", () => {
    addManualExpense({
      groupId: SEEDED_GROUP,
      description: "Pastéis",
      category: null,
      amount: "30.00",
      payerId: "mem-sarah",
      participantIds: ["mem-you", "mem-sarah"],
    });

    // Non-zero is the whole point: zero is what the bug produced, and it is
    // indistinguishable from being genuinely square.
    const netBefore = myNetIn(SEEDED_GROUP);
    expect(netBefore).not.toBe(0);

    createGroup("Ski trip", "🎿");

    expect(myNetIn(SEEDED_GROUP)).toBe(netBefore);
  });

  it("gives the new group its own member row for the same user", () => {
    const group = createGroup("Ski trip", "🎿");
    const meThere = currentMemberId(group.id);

    expect(meThere).not.toBeNull();
    expect(meThere).not.toBe(currentMemberId(SEEDED_GROUP));
    expect(group.members[0].userId).toBe(currentUserId());
  });
});

describe("createGroup", () => {
  it("does not change which user is signed in", () => {
    const before = currentUserId();
    createGroup("Ski trip", "🎿");
    expect(currentUserId()).toBe(before);
  });
});

function myNetIn(groupId: string): number {
  const group = getGroup(groupId)!;
  const balances = computeBalances(
    group.members,
    getExpenses(groupId),
    getSettlements(groupId),
  );
  return balanceFor(balances, currentMemberId(groupId));
}
