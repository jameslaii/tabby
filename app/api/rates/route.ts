import { NextResponse } from "next/server";
import { isCurrency } from "../../../lib/currencies";
import { withinRateLimit } from "../../../lib/http";

/**
 * Today's exchange rates, for converting a bill into its group's currency.
 *
 * Proxied through the server rather than fetched from the browser for three
 * reasons: it does not depend on a third party's CORS headers staying friendly,
 * one cached answer serves everybody instead of every phone fetching its own,
 * and swapping the source later touches one file.
 *
 * The source is open.er-api.com — free, no key, ~166 currencies, updated daily.
 * The obvious alternative, Frankfurter, is European Central Bank data and has
 * no dong, no new Taiwan dollar and no dirham, which rules it out for exactly
 * the trips this feature is for.
 */

/** Rates move daily at most, so a six-hour cache costs nothing in accuracy. */
const CACHE_SECONDS = 60 * 60 * 6;

export async function GET(request: Request) {
  if (!withinRateLimit(request, "rates", 60)) {
    return NextResponse.json(
      { error: "Too many requests — give it a minute." },
      { status: 429 },
    );
  }

  const base = new URL(request.url).searchParams.get("base") ?? "";
  if (!isCurrency(base)) {
    return NextResponse.json(
      { error: "Unknown currency." },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(
      `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`,
      { next: { revalidate: CACHE_SECONDS }, signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) throw new Error(`upstream ${response.status}`);

    const data = (await response.json()) as {
      result?: string;
      rates?: Record<string, unknown>;
      time_last_update_utc?: string;
    };
    if (data.result !== "success" || !data.rates) {
      throw new Error("upstream returned no rates");
    }

    // Only the codes Tabby offers, and only ones that are usable numbers — a
    // null or a zero here would silently turn a bill into nothing.
    const rates: Record<string, number> = {};
    for (const [code, value] of Object.entries(data.rates)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        rates[code] = value;
      }
    }

    return NextResponse.json({
      base,
      rates,
      asOf: data.time_last_update_utc ?? null,
    });
  } catch {
    // Deliberately not a made-up rate. A wrong number here is a wrong balance,
    // and the form says so and stays in the group's currency instead.
    return NextResponse.json(
      { error: "Couldn't reach today's exchange rates. Try again in a moment." },
      { status: 502 },
    );
  }
}
