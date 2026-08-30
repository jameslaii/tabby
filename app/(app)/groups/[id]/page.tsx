"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  balanceFor,
  computeBalances,
  simplifyDebts,
} from "../../../../lib/balances";
import { formatAbs, formatCents } from "../../../../lib/money";
import {
  currentMemberId,
  getActivity,
  getExpenses,
  getGroup,
  getSettlements,
} from "../../../../lib/db";
import { AddMemberForm, SettleUpForm } from "../../../../components/Forms";
import { InsightsPanel } from "../../../../components/InsightsPanel";
import { GroupMissing } from "../../../../components/GroupMissing";
import { Loading, useStore } from "../../../../components/StoreProvider";
import { CATEGORY_EMOJI } from "../../../../lib/categories";

export default function GroupPage() {
  const { id } = useParams<{ id: string }>();
  const { db, ready } = useStore();

  if (!ready) return <Loading label="Opening the group…" />;

  const group = getGroup(db, id);
  if (!group) return <GroupMissing />;

  const expenses = getExpenses(db, id);
  const settlements = getSettlements(db, id);
  const balances = computeBalances(group.members, expenses, settlements);
  const transfers = simplifyDebts(balances);
  const me = currentMemberId(db, id);
  const myNet = balanceFor(balances, me);
  const nameOf = (memberId: string) =>
    group.members.find((m) => m.id === memberId)?.displayName ?? "Someone";

  const alone = group.members.length < 2;

  return (
    <main className="space-y-4 pt-5">
      {/* Hero — the group's headline state, sitting on the paper rather than
          inside a panel. One figure, set large and monospaced. */}
      <section className="pb-5 text-center">
        <span className="eyebrow">
          <span aria-hidden="true" className="not-italic">
            {group.emoji}
          </span>
          {group.name}
        </span>
        <h1 className="display mt-3.5 text-balance">
          {me === null
            ? "You're not in this group."
            : myNet === 0
              ? "You're all settled up."
              : myNet > 0
                ? "You're owed"
                : "You owe"}
        </h1>
        {myNet !== 0 && (
          <div
            className={`money mt-2.5 text-[44px] font-medium leading-none ${
              myNet > 0 ? "text-teal" : "text-ginger-dark"
            }`}
          >
            {formatAbs(myNet, group.defaultCurrency)}
          </div>
        )}
        <p className="lede mx-auto mt-3 max-w-[18rem] text-balance">
          {me === null
            ? "You can see what everyone owes, but none of it is yours."
            : myNet === 0
              ? "Nothing outstanding in this group."
              : `Split between ${group.members.map((m) => m.displayName).join(", ")}.`}
        </p>
      </section>

      {/* A group of one can't split anything, so that's the only thing worth
          asking for until it's fixed. */}
      {alone ? (
        <section className="card" style={{ borderColor: "rgba(217,115,13,.35)" }}>
          <h2 className="card-title">Add the others first</h2>
          <p className="mt-1.5 text-sm text-ink/60">
            There&rsquo;s only you in {group.name}, so there&rsquo;s nobody to
            split with yet. Add everyone who was there.
          </p>
          <div className="mt-4">
            <AddMemberForm groupId={id} />
          </div>
        </section>
      ) : (
        <div className="space-y-1">
          <Link href={`/groups/${id}/receipt`} className="btn-primary w-full">
            <span aria-hidden="true">📸</span> Scan a receipt
          </Link>
          <Link href={`/groups/${id}/add`} className="btn-ghost">
            or add it manually
          </Link>
        </div>
      )}

      {/* --- The bill ------------------------------------------------------
          Balances are the one thing on this screen that is literally a
          receipt, so they're set like one: torn edges, monospaced figures,
          and dotted leaders carrying the eye from a name to its amount. */}
      <section>
        <div className="tear" aria-hidden="true" />
        <div className="receipt px-5 pb-1 pt-1">
          <h2 className="card-title">Balances</h2>
          <ul className="mt-3.5 space-y-2.5">
            {balances.map((b) => (
              <li key={b.memberId} className="leader">
                <span className="text-[15px]">{b.displayName}</span>
                <span className="leader-dots" aria-hidden="true" />
                {/* The direction reads before the figure, the way a ledger
                    line does — "owes $46.10", not "$46.10 owes". */}
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-ink/40">
                  {b.net === 0 ? "" : b.net > 0 ? "is owed" : "owes"}
                </span>
                <span
                  className={`money shrink-0 text-[15px] ${
                    b.net > 0
                      ? "text-teal"
                      : b.net < 0
                        ? "text-ginger-dark"
                        : "text-ink/35"
                  }`}
                >
                  {b.net === 0 ? "settled" : formatAbs(b.net)}
                </span>
              </li>
            ))}
          </ul>

          <div
            className="mt-5 border-t border-dashed pt-4"
            style={{ borderColor: "var(--rule-strong)" }}
          >
            <h3 className="card-title">Simplest way to settle</h3>
            {transfers.length === 0 ? (
              <p className="mt-2 text-sm text-ink/55">
                Nothing to settle — everyone&rsquo;s square.
              </p>
            ) : (
              <>
                <ul className="mt-3 space-y-2">
                  {transfers.map((t, i) => (
                    <li key={i} className="leader text-[15px]">
                      <span>
                        <span className="font-semibold">
                          {nameOf(t.fromMemberId)}
                        </span>
                        <span className="text-ink/45"> pays </span>
                        <span className="font-semibold">
                          {nameOf(t.toMemberId)}
                        </span>
                      </span>
                      <span className="leader-dots" aria-hidden="true" />
                      <span className="money shrink-0 font-medium text-teal">
                        {formatCents(t.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-ink/45">
                  {transfers.length} payment{transfers.length === 1 ? "" : "s"}{" "}
                  instead of settling every expense one by one.
                </p>
              </>
            )}
          </div>
          <div className="h-4" />
        </div>
        <div className="tear tear-bottom" aria-hidden="true" />
      </section>

      {expenses.length > 0 && <InsightsPanel groupId={id} />}

      <section className="card card-data">
        <h2 className="card-title">Expenses</h2>
        {expenses.length === 0 ? (
          <p className="lede mt-2 text-[14px]">
            Nothing yet. Scan a receipt and it&rsquo;ll show up here.
          </p>
        ) : (
          <ul className="mt-2">
            {expenses.map((e) => (
              <li
                key={e.id}
                className="border-t first:border-t-0"
                style={{ borderColor: "var(--rule)" }}
              >
                <Link
                  href={`/groups/${id}/expenses/${e.id}`}
                  className="-mx-2 flex items-center gap-3 rounded-[11px] px-2 py-3 transition active:bg-paper"
                >
                  <div
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-base"
                    style={{ background: "var(--tape)" }}
                  >
                    {e.category ? CATEGORY_EMOJI[e.category] : "🧾"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{e.description}</div>
                    <div className="truncate font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink/40">
                      {e.payers.map((p) => nameOf(p.memberId)).join(" & ")} paid
                      {e.lineItems.length > 0 && ` · ${e.lineItems.length} items`}
                    </div>
                  </div>
                  <div className="money shrink-0 text-[15px] font-medium">
                    {formatCents(e.totalAmount, e.currency)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!alone && (
        <section className="card">
          <h2 className="card-title">Settle up</h2>
          <div className="mt-4">
            <SettleUpForm
              groupId={id}
              members={group.members}
              suggestions={transfers}
            />
          </div>
          {settlements.length > 0 && (
            <ul
              className="mt-5 space-y-1.5 border-t pt-4"
              style={{ borderColor: "var(--rule)" }}
            >
              {settlements.map((s) => (
                <li key={s.id} className="text-sm text-ink/55">
                  {nameOf(s.fromMember)} paid {nameOf(s.toMember)}{" "}
                  <span className="money font-medium text-ink">
                    {formatCents(s.amount, s.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Housekeeping. These were full cards carrying the same weight as the
          balances, which made the screen six near-identical panels and a very
          long scroll. Folded away, they're one tap from where they were. */}
      <details className="card fold">
        <summary>
          <h2 className="card-title">Members · {group.members.length}</h2>
        </summary>
        <ul className="mb-4 mt-4 flex flex-wrap gap-2">
          {group.members.map((m) => (
            <li
              key={m.id}
              className="chip"
              style={{
                background: m.isGhost ? "var(--tape)" : "rgba(26,87,84,.09)",
                color: m.isGhost ? "var(--ink-soft)" : "var(--teal)",
              }}
            >
              {m.displayName}
            </li>
          ))}
        </ul>
        {!alone && <AddMemberForm groupId={id} />}
      </details>

      <details className="card fold">
        <summary>
          <h2 className="card-title">Activity</h2>
        </summary>
        <ul className="mt-4 space-y-2.5">
          {getActivity(db, id).map((a) => (
            <li key={a.id} className="flex gap-2.5 text-sm">
              <span
                className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: "var(--ginger)" }}
              />
              <span className="text-ink/65">{a.summary}</span>
            </li>
          ))}
        </ul>
      </details>
    </main>
  );
}
