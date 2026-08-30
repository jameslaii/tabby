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

  // The figure the screen leads with: the viewer's overall position.
  //
  // "Me" is resolved per group — the same person holds a different member row
  // in each one, so a single id can't stand in for all of them. And the totals
  // are kept *per currency*, because adding euros to dollars produces a number
  // that is not money. A trip in one currency still shows a single headline
  // figure; a phone holding groups in several shows one line each rather than
  // a confident, meaningless sum.
  const netByCurrency = new Map<string, number>();
  for (const group of groups) {
    const balances = computeBalances(
      group.members,
      getExpenses(db, group.id),
      getSettlements(db, group.id),
    );
    const net = balanceFor(balances, currentMemberId(db, group.id));
    netByCurrency.set(
      group.defaultCurrency,
      (netByCurrency.get(group.defaultCurrency) ?? 0) + net,
    );
  }

  const outstanding = [...netByCurrency.entries()].filter(([, net]) => net !== 0);
  const settled = outstanding.length === 0;
  const single = outstanding.length === 1 ? outstanding[0] : null;
  const owedOverall = outstanding.every(([, net]) => net > 0);

  return (
    <main className="pt-5">
      <section className="pb-7 text-center">
        <span className="eyebrow">
          <span aria-hidden="true">🐈</span>
          {groups.length} group{groups.length === 1 ? "" : "s"}
        </span>
        <h1 className="display mt-3.5 text-balance">
          {settled
            ? "You're all square."
            : single
              ? single[1] > 0
                ? "You're owed money."
                : "You owe money."
              : owedOverall
                ? "You're owed money."
                : "There's money outstanding."}
        </h1>
        {single && (
          <div
            className={`money mt-3 text-[44px] font-medium leading-none ${
              single[1] > 0 ? "text-teal" : "text-ginger-dark"
            }`}
          >
            {formatAbs(single[1], single[0])}
          </div>
        )}
        {!single && outstanding.length > 0 && (
          <ul className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1">
            {outstanding.map(([code, net]) => (
              <li
                key={code}
                className={`money text-[26px] font-medium leading-tight ${
                  net > 0 ? "text-teal" : "text-ginger-dark"
                }`}
              >
                {formatAbs(net, code)}
              </li>
            ))}
          </ul>
        )}
        <p className="lede mx-auto mt-3 max-w-[17rem] text-balance">
          {settled
            ? "Nothing outstanding across your groups. Enjoy it while it lasts."
            : single
              ? "Across every group you're part of."
              : "Kept apart by currency — these don't add together."}
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
              <div className="card flex items-center gap-3.5 p-4 transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none">
                <div
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-[12px] text-2xl"
                  style={{ background: "var(--tape)" }}
                >
                  {group.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{group.name}</div>
                  <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink/40">
                    {group.members.length}{" "}
                    {group.members.length === 1 ? "person" : "people"}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {net === 0 ? (
                    <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink/35">
                      settled
                    </span>
                  ) : (
                    <>
                      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink/40">
                        {net > 0 ? "owed" : "you owe"}
                      </div>
                      <div
                        className={`money text-[17px] font-medium ${
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

      <Link href="/groups/new" className="btn-primary mt-4 w-full">
        <span aria-hidden="true">＋</span> Start a group
      </Link>
    </main>
  );
}
