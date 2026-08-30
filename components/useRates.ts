"use client";

import { useEffect, useState } from "react";

interface RatesState {
  rates: Record<string, number> | null;
  asOf: string | null;
  error: string | null;
  loading: boolean;
}

/**
 * Today's rates, quoted against `base`.
 *
 * Fetched once per group currency rather than once per currency the user tries,
 * and inverted on the way out: the API quotes "X per one base", and what an
 * expense needs is "base per one X". The inversion happens in floating point,
 * which is harmless because the result is only ever used to produce a whole
 * number of minor units, rounded at the door in `convertMinor`.
 */
export function useRates(base: string, enabled = true) {
  const [state, setState] = useState<RatesState>({
    rates: null,
    asOf: null,
    error: null,
    loading: false,
  });

  useEffect(() => {
    // Almost every bill is in its group's own currency, and that case needs no
    // rate at all. Fetching only once a foreign currency is actually picked
    // keeps the common path free of a network round trip.
    if (!enabled) {
      setState({ rates: null, asOf: null, error: null, loading: false });
      return;
    }

    let live = true;
    setState({ rates: null, asOf: null, error: null, loading: true });

    (async () => {
      try {
        const response = await fetch(`/api/rates?base=${encodeURIComponent(base)}`);
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;
        if (!response.ok || !data?.rates) {
          throw new Error(data?.error ?? "Couldn't load exchange rates.");
        }
        if (live) {
          setState({
            rates: data.rates,
            asOf: data.asOf ?? null,
            error: null,
            loading: false,
          });
        }
      } catch (e) {
        if (live) {
          setState({
            rates: null,
            asOf: null,
            error:
              e instanceof Error ? e.message : "Couldn't load exchange rates.",
            loading: false,
          });
        }
      }
    })();

    return () => {
      live = false;
    };
  }, [base, enabled]);

  /** Whole units of `base` per one whole unit of `from`. */
  function rateFrom(from: string): number | null {
    if (from === base) return 1;
    const perBase = state.rates?.[from];
    if (typeof perBase !== "number" || perBase <= 0) return null;
    return 1 / perBase;
  }

  return { ...state, rateFrom };
}
