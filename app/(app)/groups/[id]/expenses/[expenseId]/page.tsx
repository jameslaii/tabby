"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { getExpense, getGroup } from "../../../../../../lib/db";
import { ExpenseEditor } from "../../../../../../components/ExpenseEditor";
import { GroupMissing } from "../../../../../../components/GroupMissing";
import { Loading, useStore } from "../../../../../../components/StoreProvider";

export default function ExpensePage() {
  const { id, expenseId } = useParams<{ id: string; expenseId: string }>();
  const { db, ready } = useStore();

  if (!ready) return <Loading />;

  const group = getGroup(db, id);
  if (!group) return <GroupMissing />;

  const expense = getExpense(db, expenseId);
  if (!expense || expense.groupId !== id) {
    return (
      <main className="space-y-5 pt-6 text-center">
        <div className="text-4xl" aria-hidden="true">
          🧾
        </div>
        <div>
          <h1 className="display-sm">That expense is gone</h1>
          <p className="lede mx-auto mt-2 max-w-[20rem] text-balance text-[14px]">
            It may already have been deleted.
          </p>
        </div>
        <Link href={`/groups/${id}`} className="btn-primary w-full">
          Back to {group.name}
        </Link>
      </main>
    );
  }

  return (
    <main className="space-y-5 pt-5">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink/40">
        {group.emoji} {group.name}
      </p>
      <div>
        <h1 className="display-sm">Edit expense</h1>
        <p className="lede mt-1.5 text-[14px]">
          Fix a total, a payer, or who was in on it — or take it off the books.
        </p>
      </div>
      <ExpenseEditor
        expense={expense}
        members={group.members}
        groupId={id}
      />
    </main>
  );
}
