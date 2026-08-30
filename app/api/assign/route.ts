import { NextResponse } from "next/server";
import {
  assignAcrossReceipts,
  isConfigured,
  type AssignReceipt,
} from "../../../lib/assign";
import {
  MAX_INSTRUCTIONS_CHARS,
  readJson,
  readMemberNames,
  withinRateLimit,
} from "../../../lib/http";
import { MAX_RECEIPTS_PER_SPLIT, type ParsedReceipt } from "../../../lib/types";

/**
 * Re-interpret "who had what, who paid" across every receipt on screen.
 *
 * Text-only: the photos were already read by /api/parse-receipt, so editing
 * an instruction costs one cheap call instead of re-uploading the images.
 */
export async function POST(request: Request) {
  if (!withinRateLimit(request, "assign", 20)) {
    return NextResponse.json(
      { error: "Too many changes at once — give it a minute." },
      { status: 429 },
    );
  }

  const body = await readJson(request);
  if (body === null) {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const memberNames = readMemberNames(body.memberNames);
  if (memberNames.length === 0) {
    return NextResponse.json(
      { error: "That group has nobody in it to split between." },
      { status: 400 },
    );
  }

  const instructions = String(body.instructions ?? "").slice(
    0,
    MAX_INSTRUCTIONS_CHARS,
  );
  if (!instructions.trim()) {
    return NextResponse.json(
      { error: "Say who had what, or who paid, and it'll re-split." },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.receipts) || body.receipts.length === 0) {
    return NextResponse.json(
      { error: "There are no receipts to re-split." },
      { status: 400 },
    );
  }
  if (body.receipts.length > MAX_RECEIPTS_PER_SPLIT) {
    return NextResponse.json(
      { error: `That's more than ${MAX_RECEIPTS_PER_SPLIT} receipts at once.` },
      { status: 400 },
    );
  }

  // The client sends back what /api/parse-receipt gave it. Shape-check rather
  // than trust it: a malformed entry must be a 400, not a throw inside the
  // model call that surfaces as "we broke".
  const receipts: AssignReceipt[] = [];
  for (const raw of body.receipts as unknown[]) {
    const entry = raw as { id?: unknown; label?: unknown; parsed?: unknown };
    const parsed = entry.parsed as ParsedReceipt | undefined;
    if (
      typeof entry.id !== "string" ||
      !parsed ||
      !Array.isArray(parsed.line_items)
    ) {
      return NextResponse.json(
        { error: "That receipt data is malformed — scan the receipts again." },
        { status: 400 },
      );
    }
    receipts.push({
      id: entry.id,
      label: String(entry.label ?? "Receipt").slice(0, 200),
      parsed,
    });
  }

  if (!isConfigured()) {
    return NextResponse.json({ patches: {}, usedAi: false });
  }

  try {
    const patches = await assignAcrossReceipts(receipts, instructions, memberNames);
    return NextResponse.json({ patches, usedAi: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Couldn't work out that split.",
      },
      { status: 502 },
    );
  }
}
