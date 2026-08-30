import { NextResponse } from "next/server";
import {
  demoReceipt,
  isConfigured,
  parseReceiptAndSplit,
  type ReceiptMediaType,
} from "../../../lib/parseReceipt";
import {
  MAX_IMAGE_BASE64_CHARS,
  MAX_INSTRUCTIONS_CHARS,
  readJson,
  readMemberNames,
  withinRateLimit,
} from "../../../lib/http";

const ALLOWED: ReceiptMediaType[] = ["image/jpeg", "image/png", "image/webp"];

/**
 * Read a receipt photo.
 *
 * Groups live in the caller's browser, so the members come in with the
 * request. Nothing about the group is stored here — the route is a stateless
 * wrapper around the model call, which is what lets it run on any instance.
 */
export async function POST(request: Request) {
  // A vision call per request is the most expensive thing this app does;
  // ten a minute is far beyond any real receipt-splitting session.
  if (!withinRateLimit(request, "parse-receipt", 10)) {
    return NextResponse.json(
      { error: "Too many receipts at once — give it a minute." },
      { status: 429 },
    );
  }

  const body = await readJson(request);
  if (body === null) {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const members = readMemberNames(body.memberNames);
  if (members.length === 0) {
    return NextResponse.json(
      { error: "That group has nobody in it to split between." },
      { status: 400 },
    );
  }

  const { imageBase64, mediaType, instructions } = body;

  // No API key: return a fixed receipt so the review/edit flow is still
  // demonstrable. The response says which mode produced it.
  if (!isConfigured()) {
    return NextResponse.json({
      parsed: demoReceipt(members.map(asMember)),
      demo: true,
    });
  }

  if (
    typeof imageBase64 !== "string" ||
    !imageBase64 ||
    !ALLOWED.includes(mediaType as ReceiptMediaType)
  ) {
    return NextResponse.json(
      { error: "Upload a JPEG, PNG or WebP photo of the receipt." },
      { status: 400 },
    );
  }

  if (imageBase64.length > MAX_IMAGE_BASE64_CHARS) {
    return NextResponse.json(
      { error: "That photo is too large. Try again at a smaller resolution." },
      { status: 413 },
    );
  }

  try {
    const parsed = await parseReceiptAndSplit({
      receiptImageBase64: imageBase64,
      receiptMediaType: mediaType as ReceiptMediaType,
      hostInstructions: String(instructions ?? "").slice(0, MAX_INSTRUCTIONS_CHARS),
      members: members.map(asMember),
    });
    return NextResponse.json({ parsed, demo: false });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Couldn't read that receipt.",
      },
      { status: 502 },
    );
  }
}

/** The model only ever sees display names; ids stay in the browser. */
function asMember(displayName: string) {
  return { id: displayName, displayName, userId: null, isGhost: true };
}
