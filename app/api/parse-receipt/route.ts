import { NextResponse } from "next/server";
import {
  demoReceipt,
  isConfigured,
  parseReceiptAndSplit,
  type ReceiptMediaType,
} from "../../../lib/parseReceipt";
import { getGroup } from "../../../lib/store";

const ALLOWED: ReceiptMediaType[] = ["image/jpeg", "image/png", "image/webp"];

export async function POST(request: Request) {
  const body = await request.json();
  const { groupId, imageBase64, mediaType, instructions } = body ?? {};

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

  if (!imageBase64 || !ALLOWED.includes(mediaType)) {
    return NextResponse.json(
      { error: "Upload a JPEG, PNG or WebP photo of the receipt." },
      { status: 400 },
    );
  }

  try {
    const parsed = await parseReceiptAndSplit({
      receiptImageBase64: String(imageBase64),
      receiptMediaType: mediaType,
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
