"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveReceiptAction } from "../app/actions";
import { computeFinalSplits } from "../lib/splits";
import { formatCents, toCents } from "../lib/money";
import { WHOLE_BILL, type GroupMember, type ParsedReceipt } from "../lib/types";
import { VoiceMemoButton } from "./VoiceMemoButton";

type Stage = "capture" | "review";

export function ReceiptFlow({
  groupId,
  members,
}: {
  groupId: string;
  members: GroupMember[];
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("capture");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);

  const [preview, setPreview] = useState<string | null>(null);
  const [image, setImage] = useState<{ base64: string; mediaType: string } | null>(
    null,
  );
  const [instructions, setInstructions] = useState("");
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null);
  const [payerId, setPayerId] = useState(members[0]?.id ?? "");
  const [description, setDescription] = useState("");

  // Recomputed on every edit, by the same function that writes the saved
  // record — so the preview can't drift from what actually gets stored.
  const result = useMemo(
    () => (parsed ? computeFinalSplits(parsed, members) : null),
    [parsed, members],
  );

  async function onFile(file: File) {
    setError(null);
    if (file.size > 8 * 1024 * 1024) {
      setError("That photo is over 8 MB — try a smaller one.");
      return;
    }
    const buffer = await file.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ""),
    );
    setImage({ base64, mediaType: file.type });
    setPreview(URL.createObjectURL(file));
  }

  async function parse() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/parse-receipt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupId,
          imageBase64: image?.base64,
          mediaType: image?.mediaType,
          instructions,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Couldn't read that receipt.");
      setParsed(data.parsed);
      setDemo(Boolean(data.demo));
      setDescription("Receipt");
      setStage("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  /** Toggle one member on or off an item, then re-derive the split. */
  function toggle(tempId: string, memberName: string) {
    setParsed((current) => {
      if (!current) return current;
      const assignments = [...current.assignments];
      const index = assignments.findIndex(
        (a) => a.line_item_temp_id === tempId,
      );

      if (index === -1) {
        return {
          ...current,
          assignments: [
            ...assignments,
            {
              line_item_temp_id: tempId,
              member_names: [memberName],
              split_type: "equal",
              shares: [],
            },
          ],
        };
      }

      const existing = assignments[index];
      const has = existing.member_names.includes(memberName);
      const names = has
        ? existing.member_names.filter((n) => n !== memberName)
        : [...existing.member_names, memberName];

      // Dropping to nobody would fall back to "everyone" with a warning.
      // Keep the last person rather than surprising the host.
      if (names.length === 0) return current;

      assignments[index] = {
        ...existing,
        member_names: names,
        split_type: "equal",
        shares: [],
      };
      return { ...current, assignments };
    });
  }

  async function save() {
    if (!parsed) return;
    setBusy(true);
    const response = await saveReceiptAction({
      groupId,
      description,
      payerId,
      parsed,
      rawComment: instructions,
    });
    setBusy(false);
    if (response.error) {
      setError(response.error);
      return;
    }
    router.push(`/groups/${groupId}`);
    router.refresh();
  }

  // ---- Capture ---------------------------------------------------------

  if (stage === "capture") {
    return (
      <div className="space-y-4">
        <label className="card block cursor-pointer text-center">
          {preview ? (
            <img
              src={preview}
              alt="Receipt preview"
              className="mx-auto max-h-72 rounded-xl object-contain"
            />
          ) : (
            <div className="py-10">
              <div className="text-4xl">🧾</div>
              <div className="mt-3 font-semibold">Photograph the receipt</div>
              <div className="mt-1 text-sm text-ink/50">
                JPEG, PNG or WebP
              </div>
            </div>
          )}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
        </label>

        <div className="card">
          <label className="label" htmlFor="instructions">
            Who had what?
          </label>
          <textarea
            id="instructions"
            rows={3}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Sarah had the salmon and the wine, John and I split the app, split the rest evenly"
            className="field resize-none"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <VoiceMemoButton
              onTranscript={(text) =>
                setInstructions((current) =>
                  current ? `${current} ${text}` : text,
                )
              }
            />
            <span className="text-xs text-ink/40">or type it above</span>
          </div>
        </div>

        {error && (
          <p className="rounded-xl bg-ginger/10 px-4 py-3 text-sm text-ginger-dark">
            {error}
          </p>
        )}

        <button
          className="btn-primary w-full py-3.5"
          disabled={busy || (!image && !instructions)}
          onClick={() => void parse()}
        >
          {busy ? "Reading the receipt…" : "Split it"}
        </button>
      </div>
    );
  }

  // ---- Review ----------------------------------------------------------

  if (!parsed || !result) return null;

  const itemRows = [
    ...parsed.line_items.map((item) => ({
      tempId: item.temp_id,
      label: item.description,
      cents: toCents(item.line_total),
    })),
  ];

  const wholeBill = parsed.assignments.find(
    (a) => a.line_item_temp_id === WHOLE_BILL,
  );
  const extras =
    toCents(parsed.tax) + toCents(parsed.tip) + toCents(parsed.other_charges);

  return (
    <div className="space-y-4">
      {demo && (
        <p className="rounded-xl bg-paper/60 px-4 py-3 text-sm text-ink/70">
          <strong>Sample receipt.</strong> Set <code>ANTHROPIC_API_KEY</code> to
          read a real photo — the review and math below are the real thing
          either way.
        </p>
      )}

      {result.warnings.length > 0 && (
        <div className="rounded-xl border border-ginger/30 bg-ginger/5 p-4">
          <h3 className="text-sm font-bold text-ginger-dark">
            Worth a look before you save
          </h3>
          <ul className="mt-2 space-y-1.5">
            {result.warnings.map((w, i) => (
              <li key={i} className="text-sm text-ink/70">
                • {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card space-y-3">
        <div>
          <label className="label" htmlFor="rc-description">
            Description
          </label>
          <input
            id="rc-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="rc-payer">
            Who paid?
          </label>
          <select
            id="rc-payer"
            value={payerId}
            onChange={(e) => setPayerId(e.target.value)}
            className="field"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <section className="card">
        <h2 className="card-title mb-1">Items</h2>
        <p className="mb-4 text-xs text-ink/45">
          Tap a name to add or remove them from an item.
        </p>

        <ul className="space-y-4">
          {itemRows.map((row) => {
            const assignment = parsed.assignments.find(
              (a) => a.line_item_temp_id === row.tempId,
            );
            const flagged = result.warnings.some(
              (w) => w.lineItemTempId === row.tempId,
            );

            return (
              <li
                key={row.tempId}
                className={`rounded-xl p-3 ${
                  flagged ? "bg-ginger/5 ring-1 ring-ginger/25" : "bg-canvas"
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">{row.label}</span>
                  <span className="shrink-0 font-semibold">
                    {formatCents(row.cents)}
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {members.map((m) => {
                    const on = assignment?.member_names.some(
                      (n) =>
                        n.trim().toLowerCase() ===
                        m.displayName.trim().toLowerCase(),
                    );
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggle(row.tempId, m.displayName)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                          on
                            ? "bg-teal text-white"
                            : "bg-ink/5 text-ink/50 hover:bg-ink/10"
                        }`}
                      >
                        {m.displayName}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}

          {wholeBill && (
            <li className="rounded-xl bg-canvas p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">Rest of the bill</span>
                <span className="shrink-0 font-semibold">
                  {formatCents(
                    toCents(parsed.subtotal) -
                      itemRows.reduce((s, r) => s + r.cents, 0),
                  )}
                </span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {wholeBill.member_names.map((n) => (
                  <span
                    key={n}
                    className="rounded-full bg-teal px-3 py-1 text-xs font-medium text-white"
                  >
                    {n}
                  </span>
                ))}
              </div>
            </li>
          )}
        </ul>

        {extras !== 0 && (
          <p className="mt-4 border-t border-ink/8 pt-3 text-sm text-ink/55">
            Tax, tip and fees ({formatCents(extras)}) are spread in proportion to
            what each person ate.
          </p>
        )}
      </section>

      <section className="card">
        <h2 className="card-title mb-4">Each person owes</h2>
        <ul className="space-y-2.5">
          {result.splits.map((s) => (
            <li key={s.memberId} className="flex items-center justify-between">
              <span className="text-[15px]">{s.memberName}</span>
              <span className="text-[15px] font-semibold">
                {formatCents(s.amountOwed)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center justify-between border-t border-ink/8 pt-3">
          <span className="font-bold">Total</span>
          <span className="font-bold text-teal">
            {formatCents(result.totalCents)}
          </span>
        </div>
      </section>

      {error && (
        <p className="rounded-xl bg-ginger/10 px-4 py-3 text-sm text-ginger-dark">
          {error}
        </p>
      )}

      <div className="grid grid-cols-3 gap-3">
        <button
          className="btn-secondary"
          onClick={() => setStage("capture")}
          disabled={busy}
        >
          Back
        </button>
        <button
          className="btn-primary col-span-2"
          onClick={() => void save()}
          disabled={busy}
        >
          {busy ? "Saving…" : "Save expense"}
        </button>
      </div>
    </div>
  );
}
