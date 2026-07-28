"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORY_EMOJI } from "../lib/categories";
import { formatCents } from "../lib/money";
import type { Insights } from "../lib/insights";

type Measure = "group" | "you";

export function InsightsPanel({
  groupId,
  initial,
}: {
  groupId: string;
  initial: Insights;
}) {
  const [insights, setInsights] = useState(initial);
  const [measure, setMeasure] = useState<Measure>("group");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ran = useRef(false);

  // Classify on first open, batched. Expenses save instantly with no category
  // and get labelled here, so adding an expense never waits on a model call.
  useEffect(() => {
    if (ran.current || initial.uncategorized === 0) return;
    ran.current = true;

    (async () => {
      setBusy(true);
      try {
        const response = await fetch("/api/categorize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ groupId }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setInsights(data.insights);
        if (!data.usedAi && data.applied > 0) {
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
  }, [groupId, initial.uncategorized]);

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
          className="flex rounded-full bg-ink/5 p-0.5"
        >
          {(["group", "you"] as Measure[]).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={measure === m}
              onClick={() => setMeasure(m)}
              className={`rounded-full px-3.5 py-1 text-xs font-semibold transition ${
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
        <div className="text-xs font-semibold uppercase tracking-wider text-ink/45">
          {measure === "group" ? "Total group spend" : "Your share"}
        </div>
        <div className="mt-1 text-[48px] font-extrabold leading-none tracking-tight text-ink">
          {formatCents(total)}
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
          value={insights.largest ? formatCents(insights.largest.cents) : "—"}
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
              title={`${row.category}: ${formatCents(cents)} across ${row.count} expense${
                row.count === 1 ? "" : "s"
              }`}
            >
              <div className="flex items-baseline justify-between gap-3 text-[15px]">
                <span className="truncate">
                  <span aria-hidden="true">{CATEGORY_EMOJI[row.category]}</span>{" "}
                  {row.category}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatCents(cents)}
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
                  ` · your share ${formatCents(row.yourCents)}`}
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
    <div className="flex min-h-[68px] flex-col justify-between rounded-xl bg-canvas p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-bold" title={hint}>
        {value}
      </div>
    </div>
  );
}
