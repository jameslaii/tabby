import Link from "next/link";
import { notFound } from "next/navigation";
import { computeBalances, simplifyDebts } from "../../../../lib/balances";
import { formatAbs, formatCents } from "../../../../lib/money";
import {
  currentMemberId,
  getActivity,
  getExpenses,
  getGroup,
  getSettlements,
} from "../../../../lib/store";
import { AddMemberForm, SettleUpForm } from "../../../../components/Forms";
import { InsightsPanel } from "../../../../components/InsightsPanel";
import { buildInsights } from "../../../../lib/insights";
import { CATEGORY_EMOJI } from "../../../../lib/categories";

export default async function GroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const group = getGroup(id);
  if (!group) notFound();

  const expenses = getExpenses(id);
  const settlements = getSettlements(id);
  const balances = computeBalances(group.members, expenses, settlements);
  const transfers = simplifyDebts(balances);
  const me = currentMemberId();
  const myNet = balances.find((b) => b.memberId === me)?.net ?? 0;
  const nameOf = (memberId: string) =>
    group.members.find((m) => m.id === memberId)?.displayName ?? "Someone";

  return (
    <main className="space-y-4">
      {/* Hero — the group's headline state, sitting on the wash rather than
          inside a coloured block. */}
      <section className="pb-6 pt-2 text-center">
        <span className="eyebrow">
          <span aria-hidden="true">{group.emoji}</span>
          {group.name}
        </span>
        <h1 className="display mt-4 text-balance">
          {myNet === 0
            ? "You're all settled up."
            : myNet > 0
              ? "You're owed"
              : "You owe"}
        </h1>
        {myNet !== 0 && (
          <div
            className={`mt-2 text-[46px] font-extrabold leading-none tracking-tight ${
              myNet > 0 ? "text-teal" : "text-ginger-dark"
            }`}
          >
            {formatAbs(myNet, group.defaultCurrency)}
          </div>
        )}
        <p className="lede mx-auto mt-3 max-w-[18rem] text-balance">
          {myNet === 0
            ? "Nothing outstanding in this group."
            : `Split between ${group.members.map((m) => m.displayName).join(", ")}.`}
        </p>
      </section>

      <div>
        <Link href={`/groups/${id}/receipt`} className="btn-primary w-full">
          <span aria-hidden="true">📸</span> Scan a receipt
        </Link>
        <Link
          href={`/groups/${id}/add`}
          className="btn-ghost mt-1 block"
        >
          or add it manually
        </Link>
      </div>

      <section className="card card-data">
        <h2 className="card-title">Balances</h2>
        <ul className="mt-4 space-y-2.5">
          {balances.map((b) => (
            <li key={b.memberId} className="flex items-center justify-between">
              <span className="text-[15px]">{b.displayName}</span>
              <span
                className={`text-[15px] font-semibold tabular-nums ${
                  b.net > 0
                    ? "text-teal"
                    : b.net < 0
                      ? "text-ginger-dark"
                      : "text-ink/35"
                }`}
              >
                {b.net === 0
                  ? "settled"
                  : b.net > 0
                    ? `is owed ${formatAbs(b.net)}`
                    : `owes ${formatAbs(b.net)}`}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-5 rounded-2xl bg-paper/35 p-4">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink/45">
            Simplest way to settle
          </h3>
          {transfers.length === 0 ? (
            <p className="mt-2 text-sm text-ink/55">
              Nothing to settle — everyone's square.
            </p>
          ) : (
            <>
              <ul className="mt-2.5 space-y-1.5">
                {transfers.map((t, i) => (
                  <li key={i} className="text-[15px]">
                    <span className="font-semibold">{nameOf(t.fromMemberId)}</span>{" "}
                    pays{" "}
                    <span className="font-semibold">{nameOf(t.toMemberId)}</span>{" "}
                    <span className="font-extrabold tabular-nums text-teal">
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
      </section>

      <InsightsPanel groupId={id} initial={buildInsights(expenses, me)} />

      <section className="card card-data">
        <h2 className="card-title">Expenses</h2>
        {expenses.length === 0 ? (
          <p className="lede mt-2 text-[14px]">Nothing yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink/8">
            {expenses.map((e) => (
              <li key={e.id} className="flex items-start gap-3 py-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paper/40 text-base">
                  {e.category ? CATEGORY_EMOJI[e.category] : "🧾"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{e.description}</div>
                  <div className="text-[12px] text-ink/45">
                    {e.category ?? "Uncategorized"} ·{" "}
                    {e.payers.map((p) => nameOf(p.memberId)).join(" & ")} paid ·{" "}
                    {e.expenseDate}
                    {e.lineItems.length > 0 && ` · ${e.lineItems.length} items`}
                  </div>
                </div>
                <div className="shrink-0 font-bold tabular-nums">
                  {formatCents(e.totalAmount, e.currency)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

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
          <ul className="mt-5 space-y-1.5 border-t border-ink/8 pt-4">
            {settlements.map((s) => (
              <li key={s.id} className="text-sm text-ink/55">
                {nameOf(s.fromMember)} paid {nameOf(s.toMember)}{" "}
                <span className="font-semibold text-ink">
                  {formatCents(s.amount, s.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Members</h2>
        <ul className="mb-4 mt-4 flex flex-wrap gap-2">
          {group.members.map((m) => (
            <li
              key={m.id}
              className={`chip ${
                m.isGhost ? "bg-paper/50 text-ink/70" : "bg-teal/10 text-teal"
              }`}
            >
              {m.displayName}
              {m.isGhost && <span className="text-[10px] opacity-60">ghost</span>}
            </li>
          ))}
        </ul>
        <AddMemberForm groupId={id} />
      </section>

      <section className="card">
        <h2 className="card-title">Activity</h2>
        <ul className="mt-4 space-y-2.5">
          {getActivity(id).map((a) => (
            <li key={a.id} className="flex gap-2.5 text-sm">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ginger" />
              <span className="text-ink/65">{a.summary}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
