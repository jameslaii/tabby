"use client";

import { useActionState } from "react";
import { addExpenseAction, type ActionResult } from "../app/actions";
import type { GroupMember } from "../lib/types";
import { CATEGORIES, CATEGORY_EMOJI } from "../lib/categories";

export function ManualExpenseForm({
  groupId,
  members,
}: {
  groupId: string;
  members: GroupMember[];
}) {
  const [state, action, pending] = useActionState(
    addExpenseAction,
    {} as ActionResult,
  );

  return (
    <form action={action} className="card space-y-4">
      <input type="hidden" name="groupId" value={groupId} />

      <div>
        <label className="label" htmlFor="description">
          What was it?
        </label>
        <input
          id="description"
          name="description"
          placeholder="Groceries, cab, tickets…"
          className="field"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="amount">
            Amount
          </label>
          <input
            id="amount"
            name="amount"
            inputMode="decimal"
            placeholder="0.00"
            className="field"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="category">
            Category
          </label>
          {/* Empty value means "let Tabby classify it". A category picked
              here is marked manual and is never overwritten by the AI pass. */}
          <select id="category" name="category" className="field" defaultValue="">
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
        <select id="payerId" name="payerId" className="field">
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
          {members.map((m) => (
            <label
              key={m.id}
              className="cursor-pointer select-none rounded-full border border-ink/15 px-3.5 py-1.5 text-sm
                         transition has-[:checked]:border-teal has-[:checked]:bg-teal has-[:checked]:text-white"
            >
              <input
                type="checkbox"
                name="participants"
                value={m.id}
                defaultChecked
                className="sr-only"
              />
              {m.displayName}
            </label>
          ))}
        </div>
      </fieldset>

      {state.error && <p className="text-sm text-ginger-dark">{state.error}</p>}

      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Saving…" : "Save expense"}
      </button>
    </form>
  );
}
