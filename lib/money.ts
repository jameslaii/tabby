/**
 * All money in Tabby is integer cents. Never floats.
 *
 * Rationale: `0.1 + 0.2 !== 0.3`, and the Supabase JS client returns
 * `numeric(12,2)` columns as *strings* — so `"10.00" + "5.00"` is the string
 * `"10.005.00"` if you're careless. Parsing to cents at the boundary and
 * staying in integers all the way through removes both hazards.
 *
 * "Cents" is shorthand for *minor units*: hundredths of a dollar, but whole
 * yen, won and dong, which have no subdivision at all. Everything below scales
 * by the currency's own exponent rather than a hardcoded 100.
 */

import { minorPerUnit, minorUnits } from "./currencies";

export type Cents = number;

/**
 * Parse a money value from the model, a form, or a numeric() column, into
 * whole minor units of `currency`.
 *
 * Strings are parsed digit-by-digit rather than through `Number`, because the
 * float round-trip is lossy exactly where money cares: `1.005 * 100` is
 * `100.49999999999999` in binary floating point, so the naive version rounds
 * a legitimate half-cent *down*. Since `numeric(12,2)` arrives from Supabase
 * as a string, that path has to be exact.
 *
 * Number inputs carry whatever imprecision they already had — `toCents(1.005)`
 * is 100, because the double nearest to 1.005 is below it. Prefer strings
 * wherever the value came from a database or a form field.
 */
export function toCents(value: number | string, currency = "USD"): Cents {
  const scale = minorPerUnit(currency);
  const places = minorUnits(currency);

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot convert non-finite value to cents: ${value}`);
    }
    // Round half away from zero: Math.round alone is asymmetric on negatives.
    return Math.sign(value) * Math.round(Math.abs(value) * scale);
  }

  const trimmed = value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new Error(`Cannot parse money string: ${JSON.stringify(value)}`);
  }
  const [, sign, whole, fraction = ""] = match;
  const minor =
    Number(whole) * scale +
    (places > 0 ? Number((fraction + "0".repeat(places)).slice(0, places)) : 0);

  // Round on the first dropped digit, away from zero.
  const dropped = fraction.length > places ? Number(fraction[places]) : 0;
  const rounded = minor + (dropped >= 5 ? 1 : 0);

  return sign === "-" ? -rounded : rounded;
}

export function formatCents(cents: Cents, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    cents / minorPerUnit(currency),
  );
}

/** Absolute dollars, no sign — for "owes / is owed" phrasing. */
export function formatAbs(cents: Cents, currency = "USD"): string {
  return formatCents(Math.abs(cents), currency);
}

/**
 * Convert `amount` (minor units of `from`) into minor units of `to`.
 *
 * `rate` is whole units of `to` per one whole unit of `from` — the shape every
 * rate source quotes. The two currencies can have different numbers of decimal
 * places, which is why this goes via whole units rather than scaling the minor
 * figure directly: 40.00 EUR into dong is 4000 EUR-cents -> 40 EUR -> 1,080,000
 * dong, and the dong has no minor unit to multiply by.
 */
export function convertMinor(
  amount: Cents,
  from: string,
  to: string,
  rate: number,
): Cents {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Exchange rate must be a positive number, got ${rate}`);
  }
  if (from === to) return amount;
  const whole = amount / minorPerUnit(from);
  const target = whole * rate * minorPerUnit(to);
  return Math.sign(target) * Math.round(Math.abs(target));
}

/**
 * Minor units back to the plain string a form field wants: "1500" in yen,
 * "15.00" in dollars. The naive `(cents / 100).toFixed(2)` shows a yen bill at
 * a hundredth of its value and invents two decimals a yen does not have.
 */
export function toAmountInput(cents: Cents, currency = "USD"): string {
  return (cents / minorPerUnit(currency)).toFixed(minorUnits(currency));
}

export function sumCents(values: Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Split `total` across `weights` so the parts sum to exactly `total`.
 *
 * Largest-remainder (Hamilton) apportionment: floor every share, then hand the
 * leftover cents out one at a time to the largest fractional remainders. Ties
 * break on `keys` so the result is stable regardless of input ordering — the
 * same receipt always bills the same person the odd cent.
 *
 * Returns parts parallel to `weights`. A zero weight always gets zero.
 */
export function apportion(
  total: Cents,
  weights: number[],
  keys: string[],
): Cents[] {
  if (weights.length !== keys.length) {
    throw new Error("apportion: weights and keys must be the same length");
  }
  if (weights.length === 0) return [];
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new Error("apportion: weights must be finite and non-negative");
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) {
    throw new Error("apportion: total weight must be greater than zero");
  }

  // Work on magnitude so negative totals (refunds) apportion symmetrically.
  const sign = total < 0 ? -1 : 1;
  const magnitude = Math.abs(total);

  const exact = weights.map((w) => (magnitude * w) / totalWeight);
  const floors = exact.map(Math.floor);
  let remaining = magnitude - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, i) => ({ i, frac: value - Math.floor(value), key: keys[i] }))
    .sort((a, b) => b.frac - a.frac || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const parts = [...floors];
  for (let n = 0; n < order.length && remaining > 0; n++) {
    // Never award a leftover cent to a zero-weight participant.
    if (weights[order[n].i] === 0) continue;
    parts[order[n].i] += 1;
    remaining -= 1;
  }

  return parts.map((p) => sign * p);
}
