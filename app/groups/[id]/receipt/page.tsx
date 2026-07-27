import Link from "next/link";
import { notFound } from "next/navigation";
import { getGroup } from "../../../../lib/store";
import { ReceiptFlow } from "../../../../components/ReceiptFlow";

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
      <Link href={`/groups/${id}`} className="text-sm text-teal">
        ← {group.name}
      </Link>
      <div>
        <h1 className="text-xl font-bold">Scan a receipt</h1>
        <p className="mt-1 text-sm text-ink/55">
          Photograph the bill, say who had what, and review before it saves.
        </p>
      </div>
      <ReceiptFlow groupId={id} members={group.members} />
    </main>
  );
}
