import Link from "next/link";

/**
 * Shown when a group id in the URL isn't in this browser's data.
 *
 * A bare 404 was the wrong answer here twice over: the page exists, and the
 * usual reason for landing on it is a link opened somewhere the group was
 * never stored — another device, or a browser whose site data was cleared.
 * Saying so is more use than "not found".
 */
export function GroupMissing() {
  return (
    <main className="space-y-5 pt-6 text-center">
      <div className="text-4xl" aria-hidden="true">
        🐈
      </div>
      <div>
        <h1 className="display-sm">That group isn&rsquo;t on this device</h1>
        <p className="lede mx-auto mt-2 max-w-[20rem] text-balance text-[14px]">
          Tabby keeps your groups in the browser you made them in. If you
          started this one somewhere else — another phone, another browser, or
          before clearing site data — it won&rsquo;t be here.
        </p>
      </div>
      <div className="space-y-2">
        <Link href="/" className="btn-primary w-full">
          Your groups
        </Link>
        <Link href="/groups/new" className="btn-ghost block">
          or start a new one
        </Link>
      </div>
    </main>
  );
}
