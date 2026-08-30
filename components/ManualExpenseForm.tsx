"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addManualExpense } from "../lib/db";
import { useStore } from "./StoreProvider";
import type { GroupMember } from "../lib/types";
import { CATEGORIES, CATEGORY_EMOJI, isCategory } from "../lib/categories";
import { CURRENCIES } from "../lib/currencies";
import { convertMinor, formatCents, toCents } from "../lib/money";
import { useRates } from "./useRates";

export function ManualExpenseForm({
  groupId,
  members,
  currency,
}: {
  groupId: string;
  members: GroupMember[];
  /** The group's currency. Bills default to it and rarely leave it. */
  currency: string;
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
  const [billCurrency, setBillCurrency] = useState(currency);
  const foreign = billCurrency !== currency;
  const rates = useRates(currency, foreign);

  const rate = rates.rateFrom(billCurrency);

  // What the group will actually be charged, shown before saving rather than
  // discovered afterwards.
  let converted: string | null = null;
  if (foreign && rate && amount.trim()) {
    try {
      converted = formatCents(
        convertMinor(toCents(amount, billCurrency), billCurrency, currency, rate),
        currency,
      );
    } catch {
      converted = null;
    }
  }

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
        currency: foreign ? billCurrency : undefined,
        exchangeRate: foreign && rate ? rate : undefined,
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

      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="amount">
            Amount
          </label>
          <div className="flex gap-2">
            <input
              id="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="field flex-1"
            />
            <select
              className="field w-[6.2rem] shrink-0"
              value={billCurrency}
              onChange={(e) => setBillCurrency(e.target.value)}
              aria-label="Currency this bill was in"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
          </div>
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

      {foreign && (
        <div
          className="rounded-[11px] px-3.5 py-3 text-sm"
          style={{ background: "var(--paper)" }}
        >
          {rates.loading && (
            <span className="text-ink/55">Fetching today&rsquo;s rate&hellip;</span>
          )}
          {rates.error && (
            <span className="text-ginger-dark">{rates.error}</span>
          )}
          {!rates.loading && !rates.error && !rate && (
            <span className="text-ginger-dark">
              No rate available for {billCurrency}.
            </span>
          )}
          {rate && (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-ink/55">Charged to the group</span>
                <span className="money font-medium">{converted ?? "—"}</span>
              </div>
              <p className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[0.09em] text-ink/40">
                1 {billCurrency} = {rate.toPrecision(6)} {currency}
                {rates.asOf ? ` · ${rates.asOf.slice(0, 16)}` : ""}
              </p>
              <p className="mt-1.5 text-xs text-ink/45">
                This rate is saved with the expense and never recalculated, so
                a group that has settled up stays settled.
              </p>
            </>
          )}
        </div>
      )}

      {error && <p className="text-sm text-ginger-dark">{error}</p>}

      <button className="btn-primary w-full" disabled={foreign && !rate}>
        Save expense
      </button>
    </form>
  );
}
