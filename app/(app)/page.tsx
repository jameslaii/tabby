"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { computeBalances, balanceFor } from "../../lib/balances";
import { formatAbs } from "../../lib/money";
import {
  currentMemberId,
  getExpenses,
  getSettlements,
} from "../../lib/db";
import { Loading, useStore } from "../../components/StoreProvider";

export default function HomePage() {
  const router = useRouter();
  const { db, ready, persistent } = useStore();
  const groups = db.groups;

  // First run with nothing to show: go straight to the tour.
  useEffect(() => {
    if (ready && groups.length === 0) router.replace("/welcome");
  }, [ready, groups.length, router]);

  if (!ready) return <Loading label="Opening your groups…" />;

  // The one figure the screen leads with: the viewer's overall position.
  // "Me" is resolved per group — the same person holds a different member row
  // in each one, so a single id can't stand in for all of them.
  const netOverall = groups.reduce((sum, group) => {
    const balances = computeBalances(
      group.members,
      getExpenses(db, group.id),
      getSettlements(db, group.id),
    );
    return sum + balanceFor(balances, currentMemberId(db, group.id));
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

      {!persistent && (
        <p className="mb-4 rounded-xl bg-ginger/10 px-4 py-3 text-sm text-ginger-dark">
          This browser won&rsquo;t let Tabby save anything, so your groups will
          be gone when you close the tab. Turn off private browsing, or allow
          site data for this page.
        </p>
      )}

      <section className="space-y-3">
        {groups.map((group) => {
          const balances = computeBalances(
            group.members,
            getExpenses(db, group.id),
            getSettlements(db, group.id),
          );
          const net = balanceFor(balances, currentMemberId(db, group.id));

          return (
            <Link key={group.id} href={`/groups/${group.id}`} className="block">
              <div className="card flex items-center gap-4 transition hover:-translate-y-0.5">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/70 text-2xl">
                  {group.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">{group.name}</div>
                  <div className="text-[13px] text-ink/45">
                    {group.members.length}{" "}
                    {group.members.length === 1 ? "person" : "people"}
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

      <Link href="/groups/new" className="btn-primary mt-4 w-full py-3.5">
        <span aria-hidden="true">＋</span> Start a group
      </Link>
    </main>
  );
}
