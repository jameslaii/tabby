import Link from "next/link";
import { notFound } from "next/navigation";
import { getGroup } from "../../../../lib/store";
import { ManualExpenseForm } from "../../../../components/ManualExpenseForm";

export default async function AddExpensePage({
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
      <h1 className="text-xl font-bold">Add an expense</h1>
      <ManualExpenseForm groupId={id} members={group.members} />
    </main>
  );
}
