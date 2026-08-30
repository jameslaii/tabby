"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_EMOJI } from "../lib/categories";
import { formatCents } from "../lib/money";
import { buildInsights } from "../lib/insights";
import {
  currentMemberId,
  getExpenses,
  getUncategorized,
  setCategories,
} from "../lib/db";
import { useStore } from "./StoreProvider";

type Measure = "group" | "you";

export function InsightsPanel({
  groupId,
  currency,
}: {
  groupId: string;
  currency: string;
}) {
  const { db, update } = useStore();
  const [measure, setMeasure] = useState<Measure>("group");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ran = useRef(false);

  const expenses = getExpenses(db, groupId);
  const me = currentMemberId(db, groupId);
  const insights = useMemo(
    () => buildInsights(expenses, me),
    [expenses, me],
  );

  const pending = getUncategorized(db, groupId);
  const pendingCount = pending.length;

  // Classify on first open, batched. Expenses save instantly with no category
  // and get labelled here, so adding an expense never waits on a model call.
  useEffect(() => {
    if (ran.current || pendingCount === 0) return;
    ran.current = true;

    const items = pending.map((expense) => ({
      id: expense.id,
      description: expense.description,
      lineItems: expense.lineItems.map((li) => li.description),
    }));

    (async () => {
      setBusy(true);
      try {
        const response = await fetch("/api/categorize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items }),
        });
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;
        if (!response.ok || !data) {
          throw new Error(data?.error ?? "Couldn't categorize those.");
        }

        update((current) => ({
          db: setCategories(current, groupId, data.categories ?? {}),
        }));

        if (!data.usedAi) {
          setNote(
            "Categorized by keyword — set ANTHROPIC_API_KEY for Claude to read the descriptions properly.",
          );
        }
      } catch {
        setNote("Couldn't categorize automatically. Showing what's already labelled.");
      } finally {
        setBusy(false);
      }
    })();
    // Runs once per mount; `ran` guards re-entry while the request is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, pendingCount]);

  const total = measure === "group" ? insights.groupTotal : insights.yourTotal;
  const rows = [...insights.byCategory].sort((a, b) =>
    measure === "group"
      ? b.groupCents - a.groupCents
      : b.yourCents - a.yourCents,
  );
  const peak = Math.max(
    1,
    ...rows.map((r) => (measure === "group" ? r.groupCents : r.yourCents)),
  );
  const top = rows[0];

  if (insights.expenseCount === 0) {
    return (
      <section className="card">
        <h2 className="card-title">Insights</h2>
        <p className="mt-2 text-sm text-ink/50">
          Add a few expenses and Tabby will show what the group spends most on.
        </p>
      </section>
    );
  }

  return (
    <section className="card card-data">
      <div className="flex items-center justify-between gap-3">
        <h2 className="card-title">Insights</h2>
        {/* Filter row, above the chart. */}
        <div
          role="group"
          aria-label="Show spending for"
          className="flex rounded-[10px] bg-ink/5 p-0.5"
        >
          {(["group", "you"] as Measure[]).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={measure === m}
              onClick={() => setMeasure(m)}
              className={`min-h-[30px] rounded-[8px] px-3.5 text-xs font-semibold transition ${
                measure === m ? "bg-white text-ink shadow-sm" : "text-ink/50"
              }`}
            >
              {m === "group" ? "Group" : "You"}
            </button>
          ))}
        </div>
      </div>

      {/* Hero figure — the one number the panel leads with. */}
      <div className="mt-5">
        <div className="card-title">
          {measure === "group" ? "Total group spend" : "Your share"}
        </div>
        {/* 48px extrabold overflowed the card as soon as a total ran to four
            figures; the mono face is narrower and this is a secondary number
            anyway — the hero belongs to the balance at the top of the screen. */}
        <div className="money mt-1.5 text-[36px] font-medium leading-none text-ink">
          {formatCents(total, currency)}
        </div>
      </div>

      {/* Stat tiles. */}
      <div className="mt-5 grid grid-cols-3 gap-2">
        <Tile label="Expenses" value={String(insights.expenseCount)} />
        <Tile
          label="Top"
          value={top ? `${CATEGORY_EMOJI[top.category]} ${top.category}` : "—"}
        />
        <Tile
          label="Biggest"
          value={insights.largest ? formatCents(insights.largest.cents, currency) : "—"}
          hint={insights.largest?.description}
        />
      </div>

      {/* Ranked bars. Spending categories are nominal — there's no natural
          order to them — so every bar carries the same hue and identity comes
          from the label, not the colour. */}
      <div className="mt-6 space-y-3.5">
        {rows.map((row) => {
          const cents = measure === "group" ? row.groupCents : row.yourCents;
          const pct = Math.round((cents / total) * 100);
          return (
            <div
              key={row.category}
              title={`${row.category}: ${formatCents(cents, currency)} across ${row.count} expense${
                row.count === 1 ? "" : "s"
              }`}
            >
              <div className="flex items-baseline justify-between gap-3 text-[15px]">
                <span className="truncate">
                  <span aria-hidden="true">{CATEGORY_EMOJI[row.category]}</span>{" "}
                  {row.category}
                </span>
                <span className="money shrink-0 text-[14px] font-medium">
                  {formatCents(cents, currency)}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-l-[1px] bg-ink/5">
                  <div
                    className="h-full rounded-r bg-teal"
                    style={{ width: `${Math.max(2, (cents / peak) * 100)}%` }}
                  />
                </div>
                <span className="w-9 shrink-0 text-right text-xs text-ink/40 tabular-nums">
                  {pct}%
                </span>
              </div>
              <div className="mt-1 text-xs text-ink/40">
                {row.count} expense{row.count === 1 ? "" : "s"}
                {measure === "group" &&
                  row.yourCents > 0 &&
                  ` · your share ${formatCents(row.yourCents, currency)}`}
              </div>
            </div>
          );
        })}
      </div>

      {busy && (
        <p className="mt-4 text-sm text-ink/45">Categorizing expenses…</p>
      )}
      {note && <p className="mt-4 text-xs text-ink/50">{note}</p>}
    </section>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      className="flex min-h-[68px] flex-col justify-between rounded-[10px] p-3"
      style={{ background: "var(--paper)" }}
    >
      <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.11em] text-ink/40">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-bold" title={hint}>
        {value}
      </div>
    </div>
  );
}
