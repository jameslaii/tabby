import Link from "next/link";
import { redirect } from "next/navigation";
import { computeBalances, balanceFor } from "../../lib/balances";
import { formatAbs } from "../../lib/money";
import {
  currentMemberId,
  getExpenses,
  getSettlements,
  listGroups,
} from "../../lib/store";
import { createGroupAction } from "../actions";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const groups = listGroups();
  const { new: isNew } = await searchParams;

  // First run with nothing to show: go straight to the tour.
  if (groups.length === 0 && !isNew) redirect("/welcome");

  // The one figure the screen leads with: the viewer's overall position.
  // "Me" is resolved per group — the same person holds a different member row
  // in each one, so a single id can't stand in for all of them.
  const netOverall = groups.reduce((sum, group) => {
    const balances = computeBalances(
      group.members,
      getExpenses(group.id),
      getSettlements(group.id),
    );
    return sum + balanceFor(balances, currentMemberId(group.id));
  }, 0);

  return (
    <main>
      <section className="pb-8 pt-4 text-center">
        <span className="eyebrow">
          <span aria-hidden="true">🐈</span>
          {groups.length} group{groups.length === 1 ? "" : "s"}
        </span>
        <h1 className="display mt-4 text-balance">
          {netOverall === 0
            ? "You're all square."
            : netOverall > 0
              ? "You're owed money."
              : "You owe money."}
        </h1>
        {netOverall !== 0 && (
          <div
            className={`mt-3 text-[44px] font-extrabold leading-none tracking-tight ${
              netOverall > 0 ? "text-teal" : "text-ginger-dark"
            }`}
          >
            {formatAbs(netOverall)}
          </div>
        )}
        <p className="lede mx-auto mt-3 max-w-[17rem] text-balance">
          {netOverall === 0
            ? "Nothing outstanding across your groups. Enjoy it while it lasts."
            : "Across every group you're part of."}
        </p>
      </section>

      <section className="space-y-3">
        {groups.map((group) => {
          const balances = computeBalances(
            group.members,
            getExpenses(group.id),
            getSettlements(group.id),
          );
          const net = balanceFor(balances, currentMemberId(group.id));

          return (
            <Link key={group.id} href={`/groups/${group.id}`} className="block">
              <div className="card flex items-center gap-4 transition hover:-translate-y-0.5">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/70 text-2xl">
                  {group.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">{group.name}</div>
                  <div className="text-[13px] text-ink/45">
                    {group.members.length} people
                  </div>
                </div>
                <div className="text-right">
                  {net === 0 ? (
                    <span className="text-[13px] font-medium text-ink/35">
                      settled
                    </span>
                  ) : (
                    <>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-ink/40">
                        {net > 0 ? "owed" : "you owe"}
                      </div>
                      <div
                        className={`text-lg font-extrabold ${
                          net > 0 ? "text-teal" : "text-ginger-dark"
                        }`}
                      >
                        {formatAbs(net, group.defaultCurrency)}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </section>

      <section className="card mt-4">
        <h2 className="display-sm">Start a group</h2>
        <p className="lede mt-1.5 text-[14px]">
          A trip, a flat, a standing dinner — anywhere money gets shared.
        </p>
        <form action={createGroupAction} className="mt-4 space-y-3">
          <div className="flex gap-2">
            <input
              name="emoji"
              defaultValue="🍜"
              aria-label="Group emoji"
              className="field w-16 text-center text-xl"
              maxLength={4}
            />
            <input
              name="name"
              placeholder="Ski trip, flatmates, book club…"
              className="field flex-1"
              required
            />
          </div>
          <button className="btn-primary w-full">Create group</button>
        </form>
      </section>
    </main>
  );
}
