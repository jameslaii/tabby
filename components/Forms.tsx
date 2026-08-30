"use client";

import { useState } from "react";
import { addMember, addSettlement } from "../lib/db";
import { useStore } from "./StoreProvider";
import type { GroupMember } from "../lib/types";
import type { Transfer } from "../lib/balances";
import { formatCents } from "../lib/money";

export function AddMemberForm({ groupId }: { groupId: string }) {
  const { update } = useStore();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = update((db) => addMember(db, groupId, name));
    if (result.error) {
      setError(result.error);
      return;
    }
    setName("");
    setError(null);
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 60))}
          placeholder="Add someone by name"
          aria-label="Add someone by name"
          className="field flex-1"
        />
        <button className="btn-secondary shrink-0" disabled={!name.trim()}>
          Add
        </button>
      </div>
      {error && <p className="text-sm text-ginger-dark">{error}</p>}
      <p className="text-xs text-ink/45">
        No account needed — a name is enough to split with someone.
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
  const { update } = useStore();
  const first = suggestions[0];

  const [fromMember, setFromMember] = useState(
    first?.fromMemberId ?? members[0]?.id ?? "",
  );
  const [toMember, setToMember] = useState(
    first?.toMemberId ?? members[1]?.id ?? "",
  );
  const [amount, setAmount] = useState(
    first ? (first.amount / 100).toFixed(2) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const nameOf = (id: string) =>
    members.find((m) => m.id === id)?.displayName ?? "";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = update((db) =>
      addSettlement(db, {
        groupId,
        fromMember,
        toMember,
        amount,
        note: null,
      }),
    );
    if (result.error) {
      setError(result.error);
      setDone(false);
      return;
    }
    setError(null);
    setDone(true);
    setAmount("");
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="fromMember">
            From
          </label>
          <select
            id="fromMember"
            className="field"
            value={fromMember}
            onChange={(e) => setFromMember(e.target.value)}
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
            className="field"
            value={toMember}
            onChange={(e) => setToMember(e.target.value)}
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
          inputMode="decimal"
          placeholder="0.00"
          className="field"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setDone(false);
          }}
        />
      </div>

      {first && (
        <p className="text-xs text-ink/45">
          Suggested: {nameOf(first.fromMemberId)} → {nameOf(first.toMemberId)}{" "}
          {formatCents(first.amount)}.
        </p>
      )}

      {error && <p className="text-sm text-ginger-dark">{error}</p>}
      {done && <p className="text-sm text-teal">Payment recorded.</p>}

      <button className="btn-teal w-full" disabled={!amount.trim()}>
        Record payment
      </button>
    </form>
  );
}
