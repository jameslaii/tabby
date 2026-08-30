/**
 * The currencies a group can be kept in.
 *
 * Deliberately a short curated list rather than all ~180 ISO codes: a picker
 * you scroll for a minute is worse than one that covers the trips people
 * actually take. Codes are ISO 4217, which is what `Intl.NumberFormat` and
 * every exchange-rate source speak.
 */

export interface Currency {
  code: string;
  name: string;
}

export const CURRENCIES: Currency[] = [
  { code: "USD", name: "US dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British pound" },
  { code: "SGD", name: "Singapore dollar" },
  { code: "MYR", name: "Malaysian ringgit" },
  { code: "THB", name: "Thai baht" },
  { code: "VND", name: "Vietnamese dong" },
  { code: "IDR", name: "Indonesian rupiah" },
  { code: "PHP", name: "Philippine peso" },
  { code: "JPY", name: "Japanese yen" },
  { code: "KRW", name: "South Korean won" },
  { code: "CNY", name: "Chinese yuan" },
  { code: "HKD", name: "Hong Kong dollar" },
  { code: "TWD", name: "New Taiwan dollar" },
  { code: "INR", name: "Indian rupee" },
  { code: "AUD", name: "Australian dollar" },
  { code: "NZD", name: "New Zealand dollar" },
  { code: "CAD", name: "Canadian dollar" },
  { code: "CHF", name: "Swiss franc" },
  { code: "AED", name: "UAE dirham" },
];

export const DEFAULT_CURRENCY = "USD";

export function isCurrency(value: unknown): value is string {
  return (
    typeof value === "string" && CURRENCIES.some((c) => c.code === value)
  );
}

export function currencyName(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.name ?? code;
}

/**
 * How many decimal places this currency actually has.
 *
 * The reason any of this exists: **not every currency has cents.** The yen,
 * the won and the dong are whole-unit currencies, so ¥1000 is one thousand
 * yen, not ten. Storing 1000 and dividing by 100 to display it would show
 * ¥10 — an app that is wrong by a factor of a hundred in exactly the places
 * you most want to trust it.
 *
 * The answer comes from Intl (that is, from CLDR) rather than a table typed
 * out here, because that table would be one more thing to keep correct.
 */
const minorUnitsCache = new Map<string, number>();

export function minorUnits(currency: string): number {
  const hit = minorUnitsCache.get(currency);
  if (hit !== undefined) return hit;

  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat("en-US", { style: "currency", currency })
        .resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // An unknown code falls back to two, which is right far more often than
    // it is wrong, and never throws in the middle of adding up a bill.
    digits = 2;
  }
  minorUnitsCache.set(currency, digits);
  return digits;
}

/** The number one whole unit of this currency is worth, in minor units. */
export function minorPerUnit(currency: string): number {
  return 10 ** minorUnits(currency);
}
