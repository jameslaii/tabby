"use client";

import { useActionState } from "react";
import {
  addMemberAction,
  settleUpAction,
  type ActionResult,
} from "../app/actions";
import type { GroupMember } from "../lib/types";
import type { Transfer } from "../lib/balances";
import { formatCents } from "../lib/money";

const empty: ActionResult = {};

export function AddMemberForm({ groupId }: { groupId: string }) {
  const [state, action, pending] = useActionState(addMemberAction, empty);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="groupId" value={groupId} />
      <div className="flex gap-2">
        <input
          name="displayName"
          placeholder="Add someone by name"
          className="field flex-1"
          required
        />
        <button className="btn-secondary shrink-0" disabled={pending}>
          Add
        </button>
      </div>
      {state.error && <p className="text-sm text-ginger-dark">{state.error}</p>}
      <p className="text-xs text-ink/45">
        They join as a ghost member — no account needed until they want one.
      </p>
    </form>
  );
}

export function SettleUpForm({
  groupId,
  members,
  suggestions,
}: {
  groupId: string;
  members: GroupMember[];
  suggestions: Transfer[];
}) {
  const [state, action, pending] = useActionState(settleUpAction, empty);
  const first = suggestions[0];
  const nameOf = (id: string) =>
    members.find((m) => m.id === id)?.displayName ?? "";

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="groupId" value={groupId} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="fromMember">
            From
          </label>
          <select
            id="fromMember"
            name="fromMember"
            className="field"
            defaultValue={first?.fromMemberId ?? members[0]?.id}
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="toMember">
            To
          </label>
          <select
            id="toMember"
            name="toMember"
            className="field"
            defaultValue={first?.toMemberId ?? members[1]?.id}
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="settle-amount">
          Amount
        </label>
        <input
          id="settle-amount"
          name="amount"
          inputMode="decimal"
          placeholder="0.00"
          className="field"
          defaultValue={first ? (first.amount / 100).toFixed(2) : ""}
          required
        />
      </div>

      {first && (
        <p className="text-xs text-ink/45">
          Pre-filled from the suggested payment:{" "}
          {nameOf(first.fromMemberId)} → {nameOf(first.toMemberId)}{" "}
          {formatCents(first.amount)}.
        </p>
      )}

      {state.error && <p className="text-sm text-ginger-dark">{state.error}</p>}
      <button className="btn-teal w-full" disabled={pending}>
        {pending ? "Recording…" : "Record payment"}
      </button>
    </form>
  );
}
