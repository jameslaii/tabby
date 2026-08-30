"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addItemizedExpenses, type ItemizedExpenseInput } from "../lib/db";
import { useStore } from "./StoreProvider";
import { computeFinalSplits, payersFor, resolvePayers } from "../lib/splits";
import { formatCents, toCents } from "../lib/money";
import {
  MAX_RECEIPTS_PER_SPLIT,
  WHOLE_BILL,
  type ExpensePayer,
  type GroupMember,
  type ParsedReceipt,
  type SplitResult,
} from "../lib/types";
import { VoiceMemoButton } from "./VoiceMemoButton";

/**
 * Scan one or more receipts from a single outing and split them together.
 *
 * Several receipts rather than one because that's how an outing actually
 * bills: a ride there, dinner, a ride back. Each stays its own expense with
 * its own payer — "I got the Grab there, Sarah got the way back" is one
 * sentence a person says and two different debts — but they're reviewed and
 * saved in one pass, and one description covers all of them.
 */

type Stage = "capture" | "review";

interface Draft {
  id: string;
  /** What the host calls this bill. Also steers which instruction applies to it. */
  label: string;
  previewUrl: string;
  status: "parsing" | "ready" | "error";
  error?: string;
  parsed?: ParsedReceipt;
  payers: ExpensePayer[];
  /** Notes from reading who paid — cleared once the host picks by hand. */
  payerNotes: string[];
  demo: boolean;
}

/**
 * Receipts are downscaled and re-encoded before upload.
 *
 * A phone photo is 3–8 MB, and base64 adds a third on top — past the 4.5 MB
 * body limit the host enforces at the edge, which rejects the request before
 * any of our code runs. Re-encoding to a long edge of 1600px lands a legible
 * receipt at roughly 300 KB. It also normalises whatever the camera produced
 * (an iPhone shoots HEIC, which the API doesn't take) into JPEG, and drops
 * the EXIF payload we have no use for.
 */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

export function ReceiptFlow({
  groupId,
  members,
}: {
  groupId: string;
  members: GroupMember[];
}) {
  const router = useRouter();
  const { update } = useStore();
  const [stage, setStage] = useState<Stage>("capture");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  // Recomputed on every edit by the same function that writes the saved
  // record, so the preview can't drift from what actually gets stored.
  const results = useMemo(() => {
    const out = new Map<string, SplitResult>();
    for (const draft of drafts) {
      if (draft.status !== "ready" || !draft.parsed) continue;
      try {
        out.set(draft.id, computeFinalSplits(draft.parsed, members));
      } catch {
        // A malformed amount is reported on the draft itself, not here.
      }
    }
    return out;
  }, [drafts, members]);

  const totals = useMemo(() => {
    const perMember = new Map<string, number>(members.map((m) => [m.id, 0]));
    let grand = 0;
    for (const result of results.values()) {
      grand += result.totalCents;
      for (const split of result.splits) {
        perMember.set(
          split.memberId,
          (perMember.get(split.memberId) ?? 0) + split.amountOwed,
        );
      }
    }
    return { perMember, grand };
  }, [results, members]);

  const ready = drafts.filter((d) => d.status === "ready" && d.parsed);
  const parsing = drafts.some((d) => d.status === "parsing");

  // ---- Reading receipts -------------------------------------------------

  async function ingest(file: File) {
    const id = newId();
    setDrafts((current) => [
      ...current,
      {
        id,
        label: "",
        previewUrl: "",
        status: "parsing",
        payers: [],
        payerNotes: [],
        demo: false,
      },
    ]);

    const patch = (change: Partial<Draft>) =>
      setDrafts((current) =>
        current.map((d) => (d.id === id ? { ...d, ...change } : d)),
      );

    try {
      const image = await prepareImage(file);
      patch({ previewUrl: image.previewUrl });

      const data = await postJson<{ parsed: ParsedReceipt; demo: boolean }>(
        "/api/parse-receipt",
        {
          // The group lives in this browser, so the server is told who's in it
          // rather than looking it up.
          memberNames: members.map((m) => m.displayName),
          imageBase64: image.base64,
          mediaType: image.mediaType,
          instructions,
        },
      );

      setDrafts((current) =>
        current.map((d) =>
          d.id === id ? hydrate(d, data.parsed, members, data.demo) : d,
        ),
      );
    } catch (e) {
      patch({ status: "error", error: messageFor(e), payers: [] });
    }
  }

  async function addFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;

    setError(null);
    const room = MAX_RECEIPTS_PER_SPLIT - drafts.length;
    if (room <= 0) {
      setError(`You can split up to ${MAX_RECEIPTS_PER_SPLIT} receipts at once.`);
      return;
    }
    if (files.length > room) {
      setError(
        `Only the first ${room} of those were added — ${MAX_RECEIPTS_PER_SPLIT} receipts is the limit for one split.`,
      );
    }

    // Straight to review: reading the photo is the slow part, and watching it
    // happen beats staring at the capture screen wondering if it took.
    setStage("review");
    await Promise.all(files.slice(0, room).map((file) => ingest(file)));
  }

  // ---- Editing ----------------------------------------------------------

  /** Re-read the description against every receipt at once. */
  async function applyInstructions() {
    if (ready.length === 0) return;
    if (!instructions.trim()) {
      setError("Say who had what, or who paid, and it'll re-split.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const data = await postJson<{
        patches: Record<
          string,
          Pick<ParsedReceipt, "assignments" | "payers" | "unresolved_items">
        >;
        usedAi: boolean;
      }>("/api/assign", {
        memberNames: members.map((m) => m.displayName),
        instructions,
        receipts: ready.map((d) => ({
          id: d.id,
          label: labelFor(d, drafts),
          parsed: d.parsed,
        })),
      });

      if (!data.usedAi) {
        setError(
          "Re-splitting from a description needs an API key. Tap names below to assign items by hand.",
        );
        return;
      }

      setDrafts((current) =>
        current.map((draft) => {
          const patch = data.patches[draft.id];
          if (!patch || !draft.parsed) return draft;
          return hydrate(
            draft,
            { ...draft.parsed, ...patch },
            members,
            draft.demo,
          );
        }),
      );
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }

  /** Toggle one member on or off an item, then re-derive the split. */
  function toggleItem(draftId: string, tempId: string, memberName: string) {
    setDrafts((current) =>
      current.map((draft) => {
        if (draft.id !== draftId || !draft.parsed) return draft;

        const assignments = [...draft.parsed.assignments];
        const index = assignments.findIndex(
          (a) => a.line_item_temp_id === tempId,
        );

        if (index === -1) {
          return {
            ...draft,
            parsed: {
              ...draft.parsed,
              assignments: [
                ...assignments,
                {
                  line_item_temp_id: tempId,
                  member_names: [memberName],
                  split_type: "equal" as const,
                  shares: [],
                },
              ],
            },
          };
        }

        const existing = assignments[index];
        const has = existing.member_names.includes(memberName);
        const names = has
          ? existing.member_names.filter((n) => n !== memberName)
          : [...existing.member_names, memberName];

        // Dropping to nobody would fall back to "everyone" with a warning.
        // Keep the last person rather than surprising the host.
        if (names.length === 0) return draft;

        assignments[index] = {
          ...existing,
          member_names: names,
          split_type: "equal",
          shares: [],
        };
        return { ...draft, parsed: { ...draft.parsed, assignments } };
      }),
    );
  }

  /**
   * Set how many of a multi-quantity item went to one person.
   *
   * Three pints between two people is not an equal split, and tapping names
   * can only ever say "these people shared it evenly". Counts turn the
   * assignment into weights — 2 and 1 bills £14 and £7 of a £21 round.
   *
   * The assignment is rebuilt from the group's own member list, so editing
   * also normalises whatever spelling came back from the model.
   */
  function setShare(
    draftId: string,
    tempId: string,
    memberName: string,
    count: number,
  ) {
    setDrafts((current) =>
      current.map((draft) => {
        if (draft.id !== draftId || !draft.parsed) return draft;

        const assignments = [...draft.parsed.assignments];
        const index = assignments.findIndex(
          (a) => a.line_item_temp_id === tempId,
        );
        const existing = index === -1 ? undefined : assignments[index];

        const names: string[] = [];
        const shares: number[] = [];
        for (const member of members) {
          const next =
            member.displayName === memberName
              ? Math.max(0, count)
              : shareOf(existing, member.displayName);
          if (next > 0) {
            names.push(member.displayName);
            shares.push(next);
          }
        }

        // Dropping to nobody would fall back to "everyone" with a warning.
        // Keep what was there rather than surprising the host.
        if (names.length === 0) return draft;

        const entry = {
          line_item_temp_id: tempId,
          member_names: names,
          split_type: "shares" as const,
          shares,
        };
        if (index === -1) assignments.push(entry);
        else assignments[index] = entry;

        return { ...draft, parsed: { ...draft.parsed, assignments } };
      }),
    );
  }

  /**
   * Add a bill that has no receipt worth photographing.
   *
   * A cab fare is a description and a number, split evenly — but it still
   * belongs to the outing, because it has its own payer and the same sentence
   * usually covers it ("I got the Grab there"). Entering it here rather than
   * through the manual form is what keeps it in the same split.
   */
  function addTyped(description: string, amount: string): string | null {
    let cents: number;
    try {
      cents = toCents(amount);
    } catch {
      return "That amount doesn't look like a number.";
    }
    if (cents <= 0) return "An amount has to be more than zero.";

    const total = cents / 100;
    const parsed: ParsedReceipt = {
      line_items: [],
      subtotal: total,
      tax: 0,
      tip: 0,
      other_charges: 0,
      grand_total: total,
      assignments: [
        {
          line_item_temp_id: WHOLE_BILL,
          member_names: members.map((m) => m.displayName),
          split_type: "equal",
          shares: [],
        },
      ],
      payers: [],
      unresolved_items: [],
    };

    setDrafts((current) => [
      ...current,
      hydrate(
        {
          id: newId(),
          label: description.trim(),
          previewUrl: "",
          status: "parsing",
          payers: [],
          payerNotes: [],
          demo: false,
        },
        parsed,
        members,
        false,
      ),
    ]);
    setStage("review");
    setError(null);
    return null;
  }

  /** Add or remove a payer. Several payers share the bill evenly. */
  function togglePayer(draftId: string, memberId: string) {
    setDrafts((current) =>
      current.map((draft) => {
        if (draft.id !== draftId) return draft;
        const total = results.get(draft.id)?.totalCents ?? 0;
        const ids = draft.payers.some((p) => p.memberId === memberId)
          ? draft.payers
              .filter((p) => p.memberId !== memberId)
              .map((p) => p.memberId)
          : [...draft.payers.map((p) => p.memberId), memberId];
        return { ...draft, payers: payersFor(ids, total), payerNotes: [] };
      }),
    );
  }

  function removeDraft(draftId: string) {
    setDrafts((current) => current.filter((d) => d.id !== draftId));
    setError(null);
  }

  function save() {
    if (ready.length === 0) {
      setError("There's nothing to save yet.");
      return;
    }
    const unpaid = ready.find((d) => d.payers.length === 0);
    if (unpaid) {
      setError(`Choose who paid for "${labelFor(unpaid, drafts)}".`);
      return;
    }

    // Amounts are recomputed here from the assignments rather than read off
    // the rendered rows, so what's stored comes from the same function that
    // drew the preview.
    const receipts: ItemizedExpenseInput[] = [];
    for (const draft of ready) {
      const parsed = draft.parsed as ParsedReceipt;
      const result = results.get(draft.id);
      if (!result) {
        setError(`"${labelFor(draft, drafts)}" didn't add up — scan it again.`);
        return;
      }

      let lineItems;
      try {
        lineItems = parsed.line_items.map((item) => ({
          id: newId(),
          description: String(item.description ?? "").slice(0, 200),
          quantity: item.quantity,
          unitPrice: toCents(item.unit_price),
          lineTotal: toCents(item.line_total),
        }));
      } catch {
        setError(`The amounts on "${labelFor(draft, drafts)}" aren't readable.`);
        return;
      }

      receipts.push({
        description: labelFor(draft, drafts),
        totalCents: result.totalCents,
        lineItems,
        splits: result.splits.map((s) => ({
          memberId: s.memberId,
          lineItemId: null,
          splitType: "exact" as const,
          shareValue: null,
          amountOwed: s.amountOwed,
        })),
        payers: draft.payers,
        rawComment: instructions.slice(0, 2000) || null,
      });
    }

    setBusy(true);
    const outcome = update((db) => addItemizedExpenses(db, groupId, receipts));
    setBusy(false);

    if (outcome.error) {
      setError(outcome.error);
      return;
    }
    router.push(`/groups/${groupId}`);
  }

  // ---- Capture ----------------------------------------------------------

  const pickers = (
    <>
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={galleryInput}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );

  if (stage === "capture") {
    return (
      <div className="space-y-4">
        {pickers}

        <div className="card text-center">
          <div className="py-6">
            <div className="text-4xl">🧾</div>
            <div className="mt-3 font-semibold">Add your receipts</div>
            <div className="mt-1 text-sm text-ink/50">
              Add as many as the outing had — the ride there, dinner, the ride
              back. Each one splits on its own.
            </div>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <button
              type="button"
              className="btn-primary py-3.5"
              onClick={() => cameraInput.current?.click()}
            >
              📷 Take a photo
            </button>
            <button
              type="button"
              className="btn-secondary py-3.5"
              onClick={() => galleryInput.current?.click()}
            >
              🖼 Browse gallery
            </button>
          </div>
        </div>

        <TypedEntry onAdd={addTyped} />

        <div className="card">
          <label className="label" htmlFor="instructions">
            Who had what? Who paid? <span className="text-ink/40">(optional)</span>
          </label>
          <textarea
            id="instructions"
            rows={3}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="I paid the Grab there, Sarah got the way back. She had the salmon, John and I split the app, rest evenly."
            className="field resize-none"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <VoiceMemoButton
              onTranscript={(text) =>
                setInstructions((current) => (current ? `${current} ${text}` : text))
              }
            />
            <span className="text-xs text-ink/40">
              You can also add this after scanning
            </span>
          </div>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    );
  }

  // ---- Review -----------------------------------------------------------

  return (
    <div className="space-y-4">
      {pickers}

      {drafts.some((d) => d.demo) && (
        <p className="rounded-xl bg-paper/60 px-4 py-3 text-sm text-ink/70">
          <strong>Sample receipt.</strong> Set <code>ANTHROPIC_API_KEY</code> to
          read a real photo — the review and math below are the real thing
          either way.
        </p>
      )}

      <div className="card card-data">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="card-title">
            {ready.length === 1 ? "1 receipt" : `${ready.length} receipts`}
            {parsing && <span className="text-ink/40"> · reading…</span>}
          </h2>
          <span className="text-lg font-bold text-teal">
            {formatCents(totals.grand)}
          </span>
        </div>
        {ready.length > 0 && (
          <ul className="mt-3 space-y-2 border-t border-ink/8 pt-3">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between">
                <span className="text-[15px]">{m.displayName}</span>
                <span className="text-[15px] font-semibold">
                  {formatCents(totals.perMember.get(m.id) ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <label className="label" htmlFor="review-instructions">
          Who had what? Who paid?
        </label>
        <textarea
          id="review-instructions"
          rows={3}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="I paid the Grab there, Sarah got the way back. She had the salmon, John and I split the app, rest evenly."
          className="field resize-none"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            className="btn-primary"
            disabled={busy || parsing || ready.length === 0}
            onClick={() => void applyInstructions()}
          >
            {busy ? "Re-splitting…" : "Apply to the split"}
          </button>
          <VoiceMemoButton
            onTranscript={(text) =>
              setInstructions((current) => (current ? `${current} ${text}` : text))
            }
          />
        </div>
        <p className="mt-2.5 text-xs text-ink/45">
          Name the receipts below (&ldquo;Grab there&rdquo;) and you can talk
          about them separately.
        </p>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {drafts.map((draft) => {
        const result = results.get(draft.id);
        const label = labelFor(draft, drafts);

        return (
          <section key={draft.id} className="card space-y-3">
            <div className="flex items-start gap-3">
              {draft.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={draft.previewUrl}
                  alt={`${label} preview`}
                  className="h-16 w-16 shrink-0 rounded-xl object-cover"
                />
              ) : (
                <div className="h-16 w-16 shrink-0 rounded-xl bg-ink/5" />
              )}
              <div className="min-w-0 flex-1">
                <input
                  value={draft.label}
                  onChange={(e) =>
                    setDrafts((current) =>
                      current.map((d) =>
                        d.id === draft.id ? { ...d, label: e.target.value } : d,
                      )
                    )
                  }
                  placeholder={label}
                  className="field"
                  aria-label="What this receipt is"
                />
                <div className="mt-1.5 flex items-center gap-3 text-sm">
                  {draft.status === "parsing" && (
                    <span className="text-ink/45">Reading the receipt…</span>
                  )}
                  {result && (
                    <span className="font-semibold">
                      {formatCents(result.totalCents)}
                    </span>
                  )}
                  <button
                    type="button"
                    className="text-ink/40 underline transition hover:text-ink/70"
                    onClick={() => removeDraft(draft.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>

            {draft.status === "error" && (
              <ErrorNote>{draft.error ?? "Couldn't read that receipt."}</ErrorNote>
            )}

            {draft.status === "ready" && draft.parsed && result && (
              <>
                {(result.warnings.length > 0 || draft.payerNotes.length > 0) && (
                  <div className="rounded-xl border border-ginger/30 bg-ginger/5 p-4">
                    <h3 className="text-sm font-bold text-ginger-dark">
                      Worth a look before you save
                    </h3>
                    <ul className="mt-2 space-y-1.5">
                      {[
                        ...draft.payerNotes,
                        ...result.warnings.map((w) => w.message),
                      ].map((message, i) => (
                        <li key={i} className="text-sm text-ink/70">
                          • {message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <div className="label">Who paid this one?</div>
                  <div className="flex flex-wrap gap-1.5">
                    {members.map((m) => {
                      const paid = draft.payers.find((p) => p.memberId === m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => togglePayer(draft.id, m.id)}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                            paid
                              ? "bg-ink text-white"
                              : "bg-ink/5 text-ink/50 hover:bg-ink/10"
                          }`}
                        >
                          {m.displayName}
                          {paid && draft.payers.length > 1 && (
                            <span className="ml-1.5 opacity-70">
                              {formatCents(paid.amountPaid)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {draft.payers.length === 0 && (
                    <p className="mt-1.5 text-xs text-ginger-dark">
                      Tap whoever settled this bill.
                    </p>
                  )}
                  {draft.payers.length > 1 && (
                    <p className="mt-1.5 text-xs text-ink/45">
                      Split evenly between them. Say the amounts above to divide
                      it differently.
                    </p>
                  )}
                </div>

                <ItemList
                  draft={draft}
                  result={result}
                  members={members}
                  onToggle={(tempId, name) => toggleItem(draft.id, tempId, name)}
                  onShare={(tempId, name, count) =>
                    setShare(draft.id, tempId, name, count)
                  }
                />
              </>
            )}
          </section>
        );
      })}

      <div className="card space-y-3">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => cameraInput.current?.click()}
            disabled={busy}
          >
            📷 Add another
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => galleryInput.current?.click()}
            disabled={busy}
          >
            🖼 Browse gallery
          </button>
        </div>
        <TypedEntry onAdd={addTyped} compact />
      </div>

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
          onClick={save}
          disabled={busy || parsing || ready.length === 0}
        >
          {busy
            ? "Saving…"
            : ready.length > 1
              ? `Save ${ready.length} expenses`
              : "Save expense"}
        </button>
      </div>
    </div>
  );
}

// ---- Pieces --------------------------------------------------------------

function ItemList({
  draft,
  result,
  members,
  onToggle,
  onShare,
}: {
  draft: Draft;
  result: SplitResult;
  members: GroupMember[];
  onToggle: (tempId: string, memberName: string) => void;
  onShare: (tempId: string, memberName: string, count: number) => void;
}) {
  const parsed = draft.parsed as ParsedReceipt;

  const wholeBill = parsed.assignments.find(
    (a) => a.line_item_temp_id === WHOLE_BILL,
  );
  const itemsTotal = parsed.line_items.reduce(
    (sum, item) => sum + safeCents(item.line_total),
    0,
  );
  const remainder = safeCents(parsed.subtotal) - itemsTotal;
  const extras =
    safeCents(parsed.tax) + safeCents(parsed.tip) + safeCents(parsed.other_charges);

  return (
    <div>
      {parsed.line_items.length > 0 && (
        <div className="label">
          Items{" "}
          <span className="text-ink/40">— tap a name to add or remove them</span>
        </div>
      )}
      <ul className="space-y-3">
        {parsed.line_items.map((item) => {
          const assignment = parsed.assignments.find(
            (a) => a.line_item_temp_id === item.temp_id,
          );
          const flagged = result.warnings.some(
            (w) => w.lineItemTempId === item.temp_id,
          );
          // Several of the same thing rarely went to people evenly — three
          // pints between two is the ordinary case, not the exotic one.
          const countable = Number.isFinite(item.quantity) && item.quantity > 1;

          return (
            <li
              key={item.temp_id}
              className={`rounded-xl p-3 ${
                flagged ? "bg-ginger/5 ring-1 ring-ginger/25" : "bg-canvas"
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">
                  {item.description}
                  {countable && (
                    <span className="ml-1.5 text-ink/45">×{item.quantity}</span>
                  )}
                </span>
                <span className="shrink-0 font-semibold">
                  {formatCents(safeCents(item.line_total))}
                </span>
              </div>

              {countable ? (
                <div className="mt-2.5 space-y-1">
                  {members.map((m) => {
                    const count = shareOf(assignment, m.displayName);
                    return (
                      <div
                        key={m.id}
                        className="flex items-center justify-between gap-3"
                      >
                        <span
                          className={`text-sm ${count > 0 ? "font-medium" : "text-ink/45"}`}
                        >
                          {m.displayName}
                        </span>
                        <div className="flex items-center gap-1">
                          <Step
                            label={`One fewer ${item.description} for ${m.displayName}`}
                            disabled={count === 0}
                            onClick={() =>
                              onShare(item.temp_id, m.displayName, count - 1)
                            }
                          >
                            −
                          </Step>
                          <span
                            className={`w-6 text-center text-sm tabular-nums ${
                              count > 0 ? "font-bold" : "text-ink/30"
                            }`}
                          >
                            {count}
                          </span>
                          <Step
                            label={`One more ${item.description} for ${m.displayName}`}
                            onClick={() =>
                              onShare(item.temp_id, m.displayName, count + 1)
                            }
                          >
                            +
                          </Step>
                        </div>
                      </div>
                    );
                  })}
                  <ShareHint assignment={assignment} quantity={item.quantity} />
                </div>
              ) : (
                <MemberChips
                  members={members}
                  assignment={assignment}
                  onToggle={(name) => onToggle(item.temp_id, name)}
                />
              )}
            </li>
          );
        })}

        {/* Shown whenever there's a bill left over to share — an unitemized
            fare is entirely this row, and it has to be editable: "Alex wasn't
            in this cab" was previously impossible to say. */}
        {(wholeBill || remainder > 0) && (
          <li className="rounded-xl bg-canvas p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">
                {parsed.line_items.length === 0 ? "The bill" : "Rest of the bill"}
              </span>
              <span className="shrink-0 font-semibold">
                {formatCents(remainder)}
              </span>
            </div>
            <MemberChips
              members={members}
              assignment={wholeBill}
              fallbackToEveryone
              onToggle={(name) => onToggle(WHOLE_BILL, name)}
            />
          </li>
        )}
      </ul>

      {extras !== 0 && (
        <p className="mt-3 border-t border-ink/8 pt-3 text-sm text-ink/55">
          Tax, tip and fees ({formatCents(extras)}) are spread in proportion to
          what each person had.
        </p>
      )}
    </div>
  );
}

function MemberChips({
  members,
  assignment,
  onToggle,
  fallbackToEveryone = false,
}: {
  members: GroupMember[];
  assignment?: ParsedReceipt["assignments"][number];
  onToggle: (memberName: string) => void;
  /** With no assignment yet, the split falls to everyone — show that. */
  fallbackToEveryone?: boolean;
}) {
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {members.map((m) => {
        const named = assignment?.member_names.some((n) => sameName(n, m.displayName));
        const on = named ?? false;
        const shown = !assignment && fallbackToEveryone ? true : on;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onToggle(m.displayName)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              shown
                ? "bg-teal text-white"
                : "bg-ink/5 text-ink/50 hover:bg-ink/10"
            }`}
          >
            {m.displayName}
          </button>
        );
      })}
    </div>
  );
}

function Step({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-7 w-7 place-items-center rounded-full bg-ink/5 text-sm font-bold transition hover:bg-ink/10 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** Says whether the counts account for everything ordered. */
function ShareHint({
  assignment,
  quantity,
}: {
  assignment?: ParsedReceipt["assignments"][number];
  quantity: number;
}) {
  if (!assignment || assignment.split_type !== "shares") return null;

  const assigned = assignment.shares.reduce((sum, n) => sum + n, 0);
  if (assigned === quantity) {
    return (
      <p className="pt-1 text-xs text-ink/45">All {quantity} accounted for.</p>
    );
  }
  return (
    <p className="pt-1 text-xs text-ink/45">
      {assigned} of {quantity} counted — the cost is split{" "}
      {assignment.shares.join(":")} either way.
    </p>
  );
}

/**
 * A bill with nothing worth photographing: a description and a total.
 *
 * Most fares and tickets are exactly this — one number, split evenly — and
 * making people photograph a cab receipt to include it in the outing was
 * asking for a ritual rather than an answer.
 */
function TypedEntry({
  onAdd,
  compact = false,
}: {
  onAdd: (description: string, amount: string) => string | null;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(compact);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    if (!description.trim()) {
      setError("Give it a name — “Grab there”, “Taxi home”.");
      return;
    }
    const failure = onAdd(description, amount);
    if (failure) {
      setError(failure);
      return;
    }
    setDescription("");
    setAmount("");
    setError(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn-ghost w-full"
        onClick={() => setOpen(true)}
      >
        or add one without a photo
      </button>
    );
  }

  return (
    <div className={compact ? "" : "card"}>
      {!compact && (
        <div className="label">No receipt? Just the name and the total</div>
      )}
      <div className="flex gap-2">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 200))}
          placeholder="Grab there"
          aria-label="What the bill was for"
          className="field flex-1"
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          inputMode="decimal"
          placeholder="0.00"
          aria-label="Total"
          className="field w-24"
        />
        <button type="button" className="btn-secondary shrink-0" onClick={add}>
          Add
        </button>
      </div>
      <p className="mt-2 text-xs text-ink/45">
        Splits evenly across the group — untick anyone who wasn&rsquo;t there.
      </p>
      {error && <p className="mt-1.5 text-sm text-ginger-dark">{error}</p>}
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-ginger/10 px-4 py-3 text-sm text-ginger-dark">
      {children}
    </p>
  );
}

// ---- Helpers -------------------------------------------------------------

/** Fold a freshly parsed receipt into a draft, keeping what the host chose. */
function hydrate(
  draft: Draft,
  parsed: ParsedReceipt,
  members: GroupMember[],
  demo: boolean,
): Draft {
  let totalCents = 0;
  try {
    totalCents = computeFinalSplits(parsed, members).totalCents;
  } catch {
    return {
      ...draft,
      status: "error",
      error: "The amounts on that receipt didn't read as numbers. Try a clearer photo.",
    };
  }

  const { payers, warnings } = resolvePayers(parsed, members, totalCents);

  // A re-split that names nobody keeps whoever the host already picked —
  // re-apportioned, since the total may have moved.
  const kept =
    payers.length > 0
      ? payers
      : payersFor(draft.payers.map((p) => p.memberId), totalCents);

  return {
    ...draft,
    parsed,
    demo,
    status: "ready",
    error: undefined,
    payers: kept,
    payerNotes: warnings
      .filter((w) => w.code !== "no_payer" || kept.length === 0)
      .map((w) => w.message),
  };
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** How many of an item are down to one person. Absent means none. */
function shareOf(
  assignment: ParsedReceipt["assignments"][number] | undefined,
  memberName: string,
): number {
  if (!assignment) return 0;
  const index = assignment.member_names.findIndex((n) => sameName(n, memberName));
  if (index === -1) return 0;

  const weighted =
    assignment.split_type === "shares" &&
    assignment.shares.length === assignment.member_names.length;
  const share = weighted ? assignment.shares[index] : 1;
  return Number.isFinite(share) && share > 0 ? share : 1;
}

function labelFor(draft: Draft, all: Draft[]): string {
  const typed = draft.label.trim();
  if (typed) return typed;
  if (all.length <= 1) return "Receipt";
  return `Receipt ${all.findIndex((d) => d.id === draft.id) + 1}`;
}

function safeCents(value: number): number {
  try {
    return toCents(value);
  } catch {
    return 0;
  }
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `r-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * POST JSON and get JSON back, or a message worth reading.
 *
 * The host can reject a request before any of our code runs — an oversized
 * upload comes back as a 413 with an empty body — so the response can't be
 * assumed to be JSON. Reading it as text first turns an empty body into
 * something actionable instead of a raw parser exception, which is what used
 * to reach the user here as "The string did not match the expected pattern".
 */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data: { error?: string } | null = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    throw new Error(data?.error ?? statusMessage(response.status));
  }
  if (!data) {
    throw new Error("The server sent back something unreadable. Try again.");
  }
  return data as T;
}

function statusMessage(status: number): string {
  if (status === 413) {
    return "That photo was too large to upload. Try again with a smaller one.";
  }
  if (status === 429) {
    return "That's a lot of receipts at once — give it a minute and try again.";
  }
  if (status >= 500) {
    return "The receipt reader is having a moment. Try again in a few seconds.";
  }
  return `That request didn't go through (${status}). Try again.`;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** Decode, downscale and re-encode a photo to a JPEG small enough to upload. */
async function prepareImage(
  file: File,
): Promise<{ base64: string; mediaType: string; previewUrl: string }> {
  const source = await decodeImage(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));

    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser couldn't process that photo.");
    context.drawImage(source.image, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    if (!base64) throw new Error("This browser couldn't process that photo.");

    return { base64, mediaType: "image/jpeg", previewUrl: dataUrl };
  } finally {
    source.release();
  }
}

async function decodeImage(file: File): Promise<{
  image: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}> {
  if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
    throw new Error("That file isn't a photo.");
  }

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Safari can't always decode a camera HEIC this way; the <img> path can.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () =>
        reject(new Error("This browser couldn't open that photo. Try a JPEG or PNG."));
      element.src = url;
    });
    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
