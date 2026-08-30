import Link from "next/link";
import { notFound } from "next/navigation";
import { getGroup } from "../../../../../lib/store";
import { ReceiptFlow } from "../../../../../components/ReceiptFlow";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const group = getGroup(id);
  if (!group) notFound();

  return (
    <main className="space-y-5">
      <Link href={`/groups/${id}`} className="inline-block text-sm font-semibold text-ink/45 transition hover:text-ink/70">
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
