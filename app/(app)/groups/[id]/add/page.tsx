import Link from "next/link";
import { notFound } from "next/navigation";
import { getGroup } from "../../../../../lib/store";
import { ManualExpenseForm } from "../../../../../components/ManualExpenseForm";

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
      <Link href={`/groups/${id}`} className="inline-block text-sm font-semibold text-ink/45 transition hover:text-ink/70">
        ← {group.name}
      </Link>
      <div>
        <h1 className="display-sm">Add an expense</h1>
        <p className="lede mt-1.5 text-[14px]">
          Leave the category on Auto and Tabby will work it out.
        </p>
      </div>
      <ManualExpenseForm groupId={id} members={group.members} />
    </main>
  );
}
