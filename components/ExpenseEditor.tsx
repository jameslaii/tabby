"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteExpense,
  splitWillReset,
  updateExpense,
} from "../lib/db";
import { useStore } from "./StoreProvider";
import { formatCents, toCents } from "../lib/money";
import { CATEGORIES, CATEGORY_EMOJI, isCategory } from "../lib/categories";
import type { Expense, GroupMember } from "../lib/types";

/**
 * Correct or remove a saved expense.
 *
 * Until this existed an expense was permanent: a typo'd total, a wrong payer
 * or a double-tap stayed on the books, and the only way out was rebuilding the
 * group. Everything is one form rather than a set of per-field edits, because
 * the corrections that matter usually come in pairs — the amount was wrong
 * *and* so was who paid.
 */
export function ExpenseEditor({
  expense,
  members,
  groupId,
}: {
  expense: Expense;
  members: GroupMember[];
  groupId: string;
}) {
  const router = useRouter();
  const { update } = useStore();

  const [description, setDescription] = useState(expense.description);
  const [amount, setAmount] = useState((expense.totalAmount / 100).toFixed(2));
  const [category, setCategory] = useState<string>(expense.category ?? "");
  const [payerIds, setPayerIds] = useState<string[]>(
    expense.payers.map((p) => p.memberId),
  );
  const [participantIds, setParticipantIds] = useState<string[]>(
    expense.splits.map((s) => s.memberId),
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const nameOf = (id: string) =>
    members.find((m) => m.id === id)?.displayName ?? "Someone";

  // Warn before an itemized split is replaced, not after.
  let willReset = false;
  try {
    willReset = splitWillReset(expense, toCents(amount), participantIds);
  } catch {
    willReset = false;
  }

  function toggle(
    id: string,
    list: string[],
    set: (next: string[]) => void,
  ) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    const result = update((db) =>
      updateExpense(db, expense.id, {
        description,
        category: isCategory(category) ? category : null,
        amount,
        payerIds,
        participantIds,
      }),
    );
    if (result.error) {
      setError(result.error);
      return;
    }
    router.push(`/groups/${groupId}`);
  }

  function remove() {
    update((db) => ({ db: deleteExpense(db, expense.id) }));
    router.push(`/groups/${groupId}`);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={save} className="card space-y-4">
        <div>
          <label className="label" htmlFor="edit-description">
            What was it?
          </label>
          <input
            id="edit-description"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 200))}
            className="field"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="edit-amount">
              Amount
            </label>
            <input
              id="edit-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="edit-category">
              Category
            </label>
            <select
              id="edit-category"
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

        <fieldset>
          <legend className="label">Who paid?</legend>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => {
              const on = payerIds.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(m.id, payerIds, setPayerIds)}
                  className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
                    on ? "border-ink bg-ink text-white" : "border-ink/15 text-ink/60"
                  }`}
                >
                  {m.displayName}
                </button>
              );
            })}
          </div>
          {payerIds.length > 1 && (
            <p className="mt-2 text-xs text-ink/45">
              Split evenly between them.
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend className="label">Split between</legend>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => {
              const on = participantIds.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() =>
                    toggle(m.id, participantIds, setParticipantIds)
                  }
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

        {willReset && (
          <p className="rounded-xl border border-ginger/30 bg-ginger/5 px-4 py-3 text-sm text-ink/70">
            <strong className="text-ginger-dark">Heads up.</strong> Changing the
            amount or who&rsquo;s included replaces the itemized split from the
            receipt with an even one, and drops the {expense.lineItems.length}{" "}
            stored line items.
          </p>
        )}

        {error && <p className="text-sm text-ginger-dark">{error}</p>}

        <button className="btn-primary w-full">Save changes</button>
      </form>

      <section className="card">
        <h2 className="card-title">Delete</h2>
        {confirmingDelete ? (
          <>
            <p className="mt-1.5 text-sm text-ink/60">
              Delete &ldquo;{expense.description}&rdquo; for{" "}
              {formatCents(expense.totalAmount, expense.currency)}? Everyone&rsquo;s
              balance changes to match. This can&rsquo;t be undone.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmingDelete(false)}
              >
                Keep it
              </button>
              <button
                type="button"
                className="rounded-full bg-ginger-dark px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
                onClick={remove}
              >
                Delete expense
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1.5 text-sm text-ink/60">
              Removes it from the group and from everyone&rsquo;s balance.
            </p>
            <button
              type="button"
              className="btn-secondary mt-4 w-full"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete this expense
            </button>
          </>
        )}
      </section>

      {expense.lineItems.length > 0 && (
        <section className="card">
          <h2 className="card-title">From the receipt</h2>
          <ul className="mt-3 divide-y divide-ink/8">
            {expense.lineItems.map((item) => (
              <li key={item.id} className="flex justify-between gap-3 py-2 text-sm">
                <span>
                  {item.description}
                  {item.quantity > 1 && (
                    <span className="text-ink/45"> ×{item.quantity}</span>
                  )}
                </span>
                <span className="money shrink-0 text-[14px] font-medium">
                  {formatCents(item.lineTotal, expense.currency)}
                </span>
              </li>
            ))}
          </ul>
          {expense.rawComment && (
            <p className="mt-3 border-t border-ink/8 pt-3 text-sm text-ink/55">
              &ldquo;{expense.rawComment}&rdquo;
            </p>
          )}
        </section>
      )}

      <section className="card card-data">
        <h2 className="card-title">Currently splits as</h2>
        <ul className="mt-3 space-y-2">
          {expense.splits.map((split) => (
            <li
              key={split.memberId}
              className="flex items-center justify-between text-[15px]"
            >
              <span>{nameOf(split.memberId)}</span>
              <span className="money text-[14px] font-medium">
                {formatCents(split.amountOwed, expense.currency)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-ink/8 pt-3 text-sm text-ink/55">
          Paid by{" "}
          {expense.payers
            .map(
              (p) =>
                `${nameOf(p.memberId)}${
                  expense.payers.length > 1 ? ` (${formatCents(p.amountPaid, expense.currency)})` : ""
                }`,
            )
            .join(" and ")}
          .
        </p>
      </section>
    </div>
  );
}
