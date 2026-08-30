"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addManualExpense } from "../lib/db";
import { useStore } from "./StoreProvider";
import type { GroupMember } from "../lib/types";
import { CATEGORIES, CATEGORY_EMOJI, isCategory } from "../lib/categories";

export function ManualExpenseForm({
  groupId,
  members,
}: {
  groupId: string;
  members: GroupMember[];
}) {
  const router = useRouter();
  const { update } = useStore();

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [payerId, setPayerId] = useState(members[0]?.id ?? "");
  const [participants, setParticipants] = useState<string[]>(
    members.map((m) => m.id),
  );
  const [error, setError] = useState<string | null>(null);

  function toggle(memberId: string) {
    setParticipants((current) =>
      current.includes(memberId)
        ? current.filter((p) => p !== memberId)
        : [...current, memberId],
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = update((db) =>
      addManualExpense(db, {
        groupId,
        description,
        category: isCategory(category) ? category : null,
        amount,
        payerId,
        participantIds: participants,
      }),
    );
    if (result.error) {
      setError(result.error);
      return;
    }
    router.push(`/groups/${groupId}`);
  }

  return (
    <form onSubmit={submit} className="card space-y-4">
      <div>
        <label className="label" htmlFor="description">
          What was it?
        </label>
        <input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Groceries, cab, tickets…"
          className="field"
          autoFocus
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="amount">
            Amount
          </label>
          <input
            id="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="category">
            Category
          </label>
          {/* Empty value means "let Tabby classify it". A category picked
              here is marked manual and is never overwritten by the AI pass. */}
          <select
            id="category"
            className="field"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">✨ Auto</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_EMOJI[c]} {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="payerId">
          Who paid?
        </label>
        <select
          id="payerId"
          className="field"
          value={payerId}
          onChange={(e) => setPayerId(e.target.value)}
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className="label">Split equally between</legend>
        <div className="flex flex-wrap gap-2">
          {members.map((m) => {
            const on = participants.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m.id)}
                className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
                  on
                    ? "border-teal bg-teal text-white"
                    : "border-ink/15 text-ink/60"
                }`}
              >
                {m.displayName}
              </button>
            );
          })}
        </div>
      </fieldset>

      {error && <p className="text-sm text-ginger-dark">{error}</p>}

      <button className="btn-primary w-full">Save expense</button>
    </form>
  );
}
