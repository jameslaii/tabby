import type { GroupMember } from "../lib/types";

/**
 * A group member for fixtures.
 *
 * Defaults to a real (non-ghost) member with an account, since that's what
 * most of these tests are about. Building the literal here means a new field
 * on `GroupMember` is one edit rather than one per fixture.
 */
export function member(
  id: string,
  displayName: string,
  overrides: Partial<GroupMember> = {},
): GroupMember {
  return {
    id,
    displayName,
    userId: `usr-${id}`,
    isGhost: false,
    ...overrides,
  };
}

/** A member with no account behind them — added by name, never signed in. */
export function ghost(id: string, displayName: string): GroupMember {
  return member(id, displayName, { userId: null, isGhost: true });
}
