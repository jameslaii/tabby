"use client";

import { useEffect, useState } from "react";

/**
 * What Tabby is doing while it reads a receipt.
 *
 * Reading a photo takes a few seconds, and a few seconds of nothing reads as a
 * broken app: people assume it has hung and leave. A spinner is barely better,
 * because it says only "wait" and never "wait for what".
 *
 * So the wait is itemised. Every step here is a real phase of the real
 * pipeline, and it flips to done when that phase actually finishes -- nothing
 * is on a timer, and no step appears that did not happen. When a step knows
 * something concrete on the way past ("shrunk to 284 KB", "14 items") it says
 * so, because a number is the difference between a progress bar and evidence.
 *
 * Note which way round it opens. The reference this borrows from collapses by
 * default and expands on demand, which is right for a trace you read after the
 * fact. Here it is the opposite: open while it works, folded away once it is
 * finished, since the entire reason it exists is to be seen mid-flight.
 */

export type TraceState = "pending" | "active" | "done" | "failed";

export interface TraceStep {
  key: string;
  label: string;
  state: TraceState;
  /** Something the step learned, shown in the muted column beside it. */
  detail?: string;
}

export function ThinkingTrace({
  steps,
  startedAt,
  finishedAt,
  failed = false,
}: {
  steps: TraceStep[];
  startedAt: number;
  finishedAt?: number;
  failed?: boolean;
}) {
  const elapsed = useElapsed(startedAt, finishedAt);
  const running = finishedAt === undefined && !failed;

  if (running) {
    return (
      <div className="rounded-[12px] border border-ink/10 bg-paper/60 p-3.5">
        <Header running elapsed={elapsed} failed={false} />
        <Steps steps={steps} />
      </div>
    );
  }

  // Finished. The detail is still one tap away, but it stops competing with
  // the receipt it was waiting for.
  return (
    <details className="fold rounded-[12px] border border-ink/10 bg-paper/60 px-3.5 py-2.5">
      <summary>
        <Header running={false} elapsed={elapsed} failed={failed} />
      </summary>
      <div className="pt-2">
        <Steps steps={steps} />
      </div>
    </details>
  );
}

function Header({
  running,
  elapsed,
  failed,
}: {
  running: boolean;
  elapsed: number;
  failed: boolean;
}) {
  return (
    <span className="flex items-center gap-2">
      {running ? (
        <span className="pulse-dot" aria-hidden="true" />
      ) : (
        <span
          aria-hidden="true"
          className={`text-[12px] ${failed ? "text-ginger-dark" : "text-teal"}`}
        >
          {failed ? "\u2715" : "\u2713"}
        </span>
      )}
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink/55">
        {running
          ? "Reading your receipt"
          : failed
            ? "Couldn't read it"
            : `Read in ${elapsed.toFixed(1)}s`}
      </span>
      {running && (
        <span className="money ml-auto text-[11px] text-ink/40">
          {elapsed.toFixed(1)}s
        </span>
      )}
    </span>
  );
}

function Steps({ steps }: { steps: TraceStep[] }) {
  return (
    <ol className="mt-2.5 space-y-1.5" aria-live="polite">
      {steps.map((step) => (
        <li
          key={step.key}
          className={`flex items-baseline gap-2.5 text-[13px] transition-opacity ${
            step.state === "pending" ? "opacity-35" : "opacity-100"
          }`}
        >
          <span
            aria-hidden="true"
            className={`w-3 shrink-0 text-center text-[11px] ${
              step.state === "done"
                ? "text-teal"
                : step.state === "failed"
                  ? "text-ginger-dark"
                  : "text-ink/40"
            }`}
          >
            {step.state === "done"
              ? "\u2713"
              : step.state === "failed"
                ? "\u2715"
                : step.state === "active"
                  ? "\u00b7"
                  : "\u00b7"}
          </span>
          <span
            className={
              step.state === "active" ? "font-semibold text-ink" : "text-ink/70"
            }
          >
            {step.label}
          </span>
          {step.detail && (
            <span className="money ml-auto shrink-0 text-[11.5px] text-ink/40">
              {step.detail}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * Tenths of a second since the work started, frozen the moment it ends.
 *
 * Ticking at 100ms rather than on every frame: the number only shows one
 * decimal, so anything faster is repaints nobody can read.
 */
function useElapsed(startedAt: number, finishedAt?: number): number {
  const [now, setNow] = useState(() => finishedAt ?? Date.now());

  useEffect(() => {
    if (finishedAt !== undefined) {
      setNow(finishedAt);
      return;
    }
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [finishedAt]);

  return Math.max(0, (now - startedAt) / 1000);
}
