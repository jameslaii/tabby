"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { getGroup } from "../../../../../lib/db";
import { ReceiptFlow } from "../../../../../components/ReceiptFlow";
import { GroupMissing } from "../../../../../components/GroupMissing";
import { Loading, useStore } from "../../../../../components/StoreProvider";

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const { db, ready } = useStore();

  if (!ready) return <Loading />;

  const group = getGroup(db, id);
  if (!group) return <GroupMissing />;

  return (
    <main className="space-y-5">
      <Link
        href={`/groups/${id}`}
        className="inline-block text-sm font-semibold text-ink/45 transition hover:text-ink/70"
      >
        ← {group.name}
      </Link>
      <div>
        <h1 className="display-sm">Split an outing</h1>
        <p className="lede mt-1.5 text-[14px]">
          Add every receipt — the ride there, dinner, the ride back. Say who had
          what and who paid, then review before it saves.
        </p>
      </div>
      <ReceiptFlow groupId={id} members={group.members} />
    </main>
  );
}
