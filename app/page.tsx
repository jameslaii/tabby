import Link from "next/link";
import { computeBalances, balanceFor } from "../lib/balances";
import { formatAbs } from "../lib/money";
import {
  currentMemberId,
  getExpenses,
  getSettlements,
  listGroups,
} from "../lib/store";
import { createGroupAction } from "./actions";

export default function HomePage() {
  const groups = listGroups();
  const me = currentMemberId();

  return (
    <main className="space-y-6">
      <section className="space-y-3">
        <h1 className="text-lg font-bold">Your groups</h1>

        {groups.map((group) => {
          const balances = computeBalances(
            group.members,
            getExpenses(group.id),
            getSettlements(group.id),
          );
          const net = balanceFor(balances, me);

          return (
            <Link key={group.id} href={`/groups/${group.id}`} className="block">
              <div className="card flex items-center gap-4 transition hover:border-teal/30">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-paper/60 text-2xl">
                  {group.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">{group.name}</div>
                  <div className="text-sm text-ink/50">
                    {group.members.length} people
                  </div>
                </div>
                <div className="text-right">
                  {net === 0 ? (
                    <span className="text-sm font-medium text-ink/40">
                      settled up
                    </span>
                  ) : (
                    <>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink/40">
                        {net > 0 ? "you're owed" : "you owe"}
                      </div>
                      <div
                        className={`text-lg font-bold ${
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

      <section className="card">
        <h2 className="mb-4 font-bold">Start a new group</h2>
        <form action={createGroupAction} className="flex gap-2">
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
          <button className="btn-primary shrink-0">Create</button>
        </form>
      </section>
    </main>
  );
}
