# Tabby

**Split the bill, not the friendship.**

Photograph a receipt, say who had what in plain English, and Tabby produces an
itemized split — no manual math. Claude reads the receipt and decides *who gets
which item*; the app does every cent of the arithmetic.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # 42 tests over the money paths
```

It runs with no configuration. Without an API key the receipt flow returns a
fixed sample receipt so the review-and-edit screen is still exercisable — the
splitting, warnings and math are the real code either way.

To read real photos, set `ANTHROPIC_API_KEY` in `.env.local`.

## What's here

| Path | |
|---|---|
| `lib/money.ts` | Integer-cent primitives and largest-remainder apportionment |
| `lib/splits.ts` | Claude's item→person mapping → exact per-person amounts |
| `lib/balances.ts` | Net positions and greedy debt simplification |
| `lib/parseReceipt.ts` | The Claude vision + Structured Outputs call |
| `lib/store.ts` | In-memory data layer, shaped 1:1 to `supabase/schema.sql` |
| `app/` | Next.js App Router pages, server actions, parse API route |
| `supabase/schema.sql` | Postgres schema with RLS policies and sum-integrity triggers |
| `docs/TEST_PLAN.md` | Coverage analysis this build was driven from |

## How the money works

Everything is integer cents. `numeric(12,2)` arrives from Supabase as a
*string*, so `"10.00" + "5.00"` is `"10.005.00"` if you're careless; parsing to
cents at the boundary removes that hazard along with binary float drift.

Per-person amounts come from **largest-remainder apportionment**: floor each
share, then hand leftover cents to the largest fractional remainders, breaking
ties on member id. Splits sum to the total exactly, by construction, and the
same receipt always bills the same person the odd cent regardless of the order
members appear in.

The draft in the handover instead added `grand_total - sum(splits)` to whoever
owed the most. That delta was unbounded, so any upstream fault — an unmatched
name, an unhandled `WHOLE_BILL` assignment, an OCR misread of the total —
became a large silent charge against one arbitrary person. A receipt whose
total read `$1000` instead of `$100` billed `$933.34` to whoever happened to be
first in the array. Here a discrepancy has nowhere to hide: it surfaces as a
warning on the review screen instead. `docs/TEST_PLAN.md` has the six
reproduced failures; `tests/splits.test.ts` pins each one.

## Not done yet

- **Auth.** There is no login; the app acts as a fixed demo member. Supabase
  auth is the next step, and `supabase/schema.sql` already carries the RLS
  policies it needs.
- **Persistence.** `lib/store.ts` is in-memory and resets on restart. It's
  written against the same shape as the schema, so it swaps for a Supabase
  client function by function.
- **Multi-currency.** Amounts are USD-labelled throughout; no conversion. The
  exchange-rate source is still an open decision in the handover.
- **Multi-payer entry.** The data model supports several payers per expense and
  balances compute correctly from it, but the manual-entry form only offers one.
