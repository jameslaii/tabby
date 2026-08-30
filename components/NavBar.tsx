"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TabbyMark } from "./Logo";

/**
 * The parent of a screen, worked out from its path.
 *
 * Deliberately not `router.back()`: history is whatever the browser happens to
 * hold, so on a deep link — the way a shared group will usually be opened —
 * back leaves the app entirely. The route tree always knows where up is.
 */
function parentOf(pathname: string): string | null {
  const segs = pathname.split("/").filter(Boolean);
  if (segs.length === 0) return null; // already at the root
  if (segs[0] !== "groups") return "/";
  // /groups/new and /groups/[id] both sit directly under the group list;
  // anything deeper belongs to its group.
  return segs.length <= 2 ? "/" : `/groups/${segs[1]}`;
}

/**
 * The top bar.
 *
 * It used to be the same on every screen — a logo and a "How it works" link,
 * with no way back — so each sub-screen printed its own "← Group name" link
 * inside the content instead. That put the one control you reach for most in a
 * different place on every page, and left it scrolled off the moment you moved
 * down a long receipt. Here it is sticky, in the corner a thumb expects, and
 * on every screen below the root.
 */
export function NavBar() {
  const pathname = usePathname();
  const parent = parentOf(pathname);

  return (
    <header className="safe-top sticky top-0 z-30 -mx-5 bg-paper px-5">
      <div className="flex h-[58px] items-center justify-between">
        {parent === null ? (
          <Link
            href="/"
            aria-label="Tabby home"
            className="flex items-center gap-2.5"
          >
            <TabbyMark size={30} />
            <span className="font-display text-[21px] font-extrabold tracking-tight">
              Tabby
            </span>
          </Link>
        ) : (
          <Link
            href={parent}
            className="-ml-2 flex min-h-[44px] items-center gap-2 rounded-[10px] px-2 pr-3 text-[15px] font-semibold text-ink/60 transition active:scale-95"
          >
            <span
              aria-hidden="true"
              className="h-[9px] w-[9px] rotate-[225deg] border-r-[1.75px] border-t-[1.75px] border-current"
            />
            {parent === "/" ? "Groups" : "Back"}
          </Link>
        )}

        <Link
          href="/welcome"
          className="rounded-[9px] px-2.5 py-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.11em] text-ink/40 transition hover:bg-white hover:text-ink/70"
        >
          How it works
        </Link>
      </div>
      <div className="h-px" style={{ background: "var(--rule)" }} />
    </header>
  );
}
