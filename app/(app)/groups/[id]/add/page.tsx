"use client";

import { useParams } from "next/navigation";
import { getGroup } from "../../../../../lib/db";
import { ManualExpenseForm } from "../../../../../components/ManualExpenseForm";
import { GroupMissing } from "../../../../../components/GroupMissing";
import { Loading, useStore } from "../../../../../components/StoreProvider";

export default function AddExpensePage() {
  const { id } = useParams<{ id: string }>();
  const { db, ready } = useStore();

  if (!ready) return <Loading />;

  const group = getGroup(db, id);
  if (!group) return <GroupMissing />;

  return (
    <main className="space-y-5 pt-5">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink/40">
        {group.emoji} {group.name}
      </p>
      <div>
        <h1 className="display-sm">Add an expense</h1>
        <p className="lede mt-1.5 text-[14px]">
          Leave the category on Auto and Tabby will work it out.
        </p>
      </div>
      <ManualExpenseForm
        groupId={id}
        members={group.members}
        currency={group.defaultCurrency}
      />
    </main>
  );
}
