import Link from "next/link";
import { TabbyMark } from "../../components/Logo";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-md px-5 pb-16">
      <header className="flex items-center justify-between py-5">
        <Link href="/" aria-label="Tabby home" className="flex items-center gap-2.5">
          <TabbyMark size={32} />
          <span className="text-xl font-extrabold tracking-tight">Tabby</span>
        </Link>
        <Link
          href="/welcome"
          className="rounded-full px-3 py-1.5 text-[13px] font-semibold text-ink/45 transition hover:bg-white/60 hover:text-ink/70"
        >
          How it works
        </Link>
      </header>
      {children}
    </div>
  );
}
