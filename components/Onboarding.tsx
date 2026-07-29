"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TabbyMark } from "./Logo";

/**
 * Onboarding — the hero-moment genre.
 *
 * One idea per screen: a floating glass preview up top, an eyebrow pill, a
 * large centred headline, a supporting line, and a single black CTA. The
 * layout stays fixed across steps so only the content changes between them.
 */

interface Step {
  eyebrow: string;
  eyebrowIcon: string;
  headline: string;
  lede: string;
  cta: string;
  preview: React.ReactNode;
}

export function Onboarding({ hasGroups }: { hasGroups: boolean }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);

  const steps: Step[] = [
    {
      eyebrow: "Welcome",
      eyebrowIcon: "👋",
      headline: "Split the bill, not the friendship.",
      lede: "Track what everyone owes without the awkward maths at the end of dinner.",
      cta: "Show me how",
      preview: <WelcomePreview />,
    },
    {
      eyebrow: "Snap it",
      eyebrowIcon: "🧾",
      headline: "Photograph the receipt. That's the hard part done.",
      lede: "Tabby reads every line item — the salmon, the wine, the tip — so you don't type a thing.",
      cta: "Then what?",
      preview: <ReceiptPreview />,
    },
    {
      eyebrow: "Say it",
      eyebrowIcon: "💬",
      headline: "Just say who had what, in plain English.",
      lede: "Type it or record a voice memo. Tabby matches each dish to the right person.",
      cta: "And the maths?",
      preview: <SpeechPreview />,
    },
    {
      eyebrow: "Settle it",
      eyebrowIcon: "🤝",
      headline: "Everyone pays exactly what they owe.",
      lede: "Down to the cent, with tax and tip shared in proportion. Then we collapse it into the fewest payments.",
      cta: hasGroups ? "Back to my groups" : "Create my first group",
      preview: <SettlePreview />,
    },
  ];

  const step = steps[index];
  const last = index === steps.length - 1;

  return (
    <div className="flex min-h-[100dvh] flex-col px-6 pb-10 pt-6">
      {/* Progress — thin, quiet, one segment per step. */}
      <div className="flex gap-1.5" aria-hidden="true">
        {steps.map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              i <= index ? "bg-ink/70" : "bg-ink/10"
            }`}
          />
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        Step {index + 1} of {steps.length}
      </p>

      {/* Floating preview. */}
      <div className="flex flex-1 items-center justify-center py-8">
        <div key={index} className="animate-[fadeUp_450ms_ease-out]">
          {step.preview}
        </div>
      </div>

      {/* Copy block. */}
      <div className="text-center">
        <span className="eyebrow">
          <span aria-hidden="true">{step.eyebrowIcon}</span>
          {step.eyebrow}
        </span>
        <h1 className="display mt-4 text-balance">{step.headline}</h1>
        <p className="lede mx-auto mt-3 max-w-[19rem] text-balance">{step.lede}</p>
      </div>

      <div className="mt-8">
        <button
          className="btn-primary w-full"
          onClick={() => {
            if (!last) return setIndex(index + 1);
            router.push(hasGroups ? "/" : "/?new=1");
          }}
        >
          {step.cta}
          {!last && <span aria-hidden="true">›››</span>}
        </button>
        {!last && (
          <button className="btn-ghost mt-1" onClick={() => router.push("/")}>
            Skip
          </button>
        )}
      </div>
    </div>
  );
}

/* --- Previews ---------------------------------------------------------
   Small glass compositions rather than illustrations, so each step shows
   the actual interface it's describing. */

function WelcomePreview() {
  return (
    // Stacked with a small overlap rather than absolutely positioned — an
    // absolute card sat on top of the tagline at narrow widths.
    <div className="w-[17rem]">
      <div className="card flex items-center gap-3.5 p-4">
        <TabbyMark size={46} />
        <div>
          <div className="text-lg font-extrabold leading-none">Tabby</div>
          <div className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-teal">
            Split the bill
          </div>
        </div>
      </div>
      <div className="card card-data relative -mt-2 ml-auto w-[10.5rem] p-3.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-ink/40">
          You're owed
        </div>
        <div className="mt-0.5 text-2xl font-extrabold text-teal">$75.00</div>
      </div>
    </div>
  );
}

function ReceiptPreview() {
  const items = [
    ["Grilled Salmon", "$28.00"],
    ["Glass of Riesling", "$11.00"],
    ["Burrata", "$16.00"],
  ];
  return (
    <div className="card w-[17rem] p-4">
      <div className="flex items-center justify-between border-b border-ink/8 pb-2.5">
        <span className="text-[13px] font-bold">Tasca do Chico</span>
        <span className="text-lg">🧾</span>
      </div>
      <ul className="mt-2.5 space-y-2">
        {items.map(([name, price], i) => (
          <li
            key={name}
            className="flex justify-between text-[13px] opacity-0 animate-[fadeUp_400ms_ease-out_forwards]"
            style={{ animationDelay: `${150 + i * 130}ms` }}
          >
            <span className="text-ink/70">{name}</span>
            <span className="font-semibold tabular-nums">{price}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SpeechPreview() {
  return (
    <div className="relative w-[17rem]">
      <div className="card p-4">
        <p className="text-[14px] leading-relaxed text-ink/75">
          “Sarah had the salmon and the wine, John and I split the burrata,
          split the rest evenly.”
        </p>
      </div>
      <div className="card card-data absolute -bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-2 px-4 py-2.5">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ginger opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-ginger" />
        </span>
        <span className="text-[13px] font-semibold">Listening…</span>
      </div>
    </div>
  );
}

function SettlePreview() {
  const rows = [
    ["Sarah", "$55.41"],
    ["You", "$45.78"],
    ["John", "$33.82"],
  ];
  return (
    <div className="relative w-[17rem]">
      <div className="card card-data p-4">
        <div className="text-[10px] font-bold uppercase tracking-wider text-ink/40">
          Each person owes
        </div>
        <ul className="mt-2.5 space-y-2">
          {rows.map(([name, amount], i) => (
            <li
              key={name}
              className="flex justify-between text-[14px] opacity-0 animate-[fadeUp_400ms_ease-out_forwards]"
              style={{ animationDelay: `${120 + i * 120}ms` }}
            >
              <span>{name}</span>
              <span className="font-bold tabular-nums">{amount}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="card absolute -bottom-7 -right-4 flex items-center gap-2 px-3.5 py-2">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-teal text-[11px] text-white">
          ✓
        </span>
        <span className="text-[12px] font-semibold">2 payments</span>
      </div>
    </div>
  );
}
