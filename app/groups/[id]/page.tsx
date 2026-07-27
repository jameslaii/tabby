import Link from "next/link";
import { notFound } from "next/navigation";
import { computeBalances, simplifyDebts } from "../../../lib/balances";
import { formatAbs, formatCents } from "../../../lib/money";
import {
  currentMemberId,
  getActivity,
  getExpenses,
  getGroup,
  getSettlements,
} from "../../../lib/store";
import { AddMemberForm, SettleUpForm } from "../../../components/Forms";
import { InsightsPanel } from "../../../components/InsightsPanel";
import { buildInsights } from "../../../lib/insights";
import { CATEGORY_EMOJI } from "../../../lib/categories";

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
    <main className="space-y-6">
      <section className="card bg-teal text-white">
        <div className="flex items-start gap-3">
          <span className="text-3xl">{group.emoji}</span>
          <div className="flex-1">
            <h1 className="text-xl font-bold">{group.name}</h1>
            <p className="mt-1 text-sm text-white/70">
              {group.members.map((m) => m.displayName).join(" · ")}
            </p>
          </div>
        </div>
        <div className="mt-5 border-t border-white/15 pt-4">
          {myNet === 0 ? (
            <p className="text-lg font-bold">You're all settled up 🎉</p>
          ) : (
            <p className="text-lg font-bold">
              {myNet > 0 ? "You're owed " : "You owe "}
              <span className="text-paper">
                {formatAbs(myNet, group.defaultCurrency)}
              </span>
            </p>
          )}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Link href={`/groups/${id}/receipt`} className="btn-primary py-3.5">
          📸 Scan a receipt
        </Link>
        <Link href={`/groups/${id}/add`} className="btn-secondary py-3.5">
          Add manually
        </Link>
      </div>

      <section className="card">
        <h2 className="mb-4 font-bold">Balances</h2>
        <ul className="space-y-2.5">
          {balances.map((b) => (
            <li key={b.memberId} className="flex items-center justify-between">
              <span className="text-[15px]">{b.displayName}</span>
              <span
                className={`text-[15px] font-semibold ${
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

        <div className="mt-5 rounded-xl bg-paper/40 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink/50">
            Simplest way to settle
          </h3>
          {transfers.length === 0 ? (
            <p className="mt-2 text-sm text-ink/60">
              Nothing to settle — everyone's square.
            </p>
          ) : (
            <ul className="mt-2.5 space-y-1.5">
              {transfers.map((t, i) => (
                <li key={i} className="text-[15px]">
                  <span className="font-semibold">
                    {nameOf(t.fromMemberId)}
                  </span>{" "}
                  pays{" "}
                  <span className="font-semibold">{nameOf(t.toMemberId)}</span>{" "}
                  <span className="font-bold text-teal">
                    {formatCents(t.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink/45">
            {transfers.length} payment{transfers.length === 1 ? "" : "s"}{" "}
            instead of settling every expense one by one.
          </p>
        </div>
      </section>

      <InsightsPanel
        groupId={id}
        initial={buildInsights(expenses, me)}
      />

      <section className="card">
        <h2 className="mb-4 font-bold">Expenses</h2>
        {expenses.length === 0 ? (
          <p className="text-sm text-ink/50">No expenses yet.</p>
        ) : (
          <ul className="divide-y divide-ink/8">
            {expenses.map((e) => (
              <li key={e.id} className="flex items-start gap-3 py-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-paper/50 text-sm">
                  {e.category ? CATEGORY_EMOJI[e.category] : "🧾"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{e.description}</div>
                  <div className="text-xs text-ink/50">
                    {e.category ?? "Uncategorized"} ·{" "}
                    {e.payers.map((p) => nameOf(p.memberId)).join(" & ")} paid ·{" "}
                    {e.expenseDate}
                    {e.lineItems.length > 0 &&
                      ` · ${e.lineItems.length} items`}
                  </div>
                </div>
                <div className="shrink-0 font-semibold">
                  {formatCents(e.totalAmount, e.currency)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="mb-4 font-bold">Settle up</h2>
        <SettleUpForm
          groupId={id}
          members={group.members}
          suggestions={transfers}
        />
        {settlements.length > 0 && (
          <ul className="mt-5 space-y-1.5 border-t border-ink/8 pt-4">
            {settlements.map((s) => (
              <li key={s.id} className="text-sm text-ink/60">
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
        <h2 className="mb-4 font-bold">Members</h2>
        <ul className="mb-4 flex flex-wrap gap-2">
          {group.members.map((m) => (
            <li
              key={m.id}
              className={`chip ${
                m.isGhost
                  ? "bg-paper/60 text-ink/70"
                  : "bg-teal/10 text-teal"
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
        <h2 className="mb-4 font-bold">Activity</h2>
        <ul className="space-y-2.5">
          {getActivity(id).map((a) => (
            <li key={a.id} className="flex gap-2.5 text-sm">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ginger" />
              <span className="text-ink/70">{a.summary}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
