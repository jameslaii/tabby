import { NextResponse } from "next/server";
import {
  demoReceipt,
  isConfigured,
  parseReceiptAndSplit,
  type ReceiptMediaType,
} from "../../../lib/parseReceipt";
import { getGroup } from "../../../lib/store";
import { MAX_IMAGE_BASE64_CHARS, readJson } from "../../../lib/http";

const ALLOWED: ReceiptMediaType[] = ["image/jpeg", "image/png", "image/webp"];

export async function POST(request: Request) {
  const body = await readJson(request);
  if (body === null) {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const { groupId, imageBase64, mediaType, instructions } = body;

  const group = getGroup(String(groupId));
  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  // No API key: return a fixed receipt so the review/edit flow is still
  // demonstrable. The response says which mode produced it.
  if (!isConfigured()) {
    return NextResponse.json({
      parsed: demoReceipt(group.members),
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
      hostInstructions: String(instructions ?? ""),
      members: group.members,
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
