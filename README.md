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
| `lib/categories.ts` | The fixed category vocabulary and keyword fallback |
| `lib/classify.ts` | Batched Claude categorization of expense descriptions |
| `lib/insights.ts` | Spend aggregation for the insights panel |
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

## The visual system

Defined in `app/globals.css` as a handful of component classes, so screens
mostly inherit it rather than restating it.

- **Surface** — a fixed warm gradient wash (peach top-left, blush top-right,
  cooling to white) with a dotted texture that fades out by mid-screen, so it
  never sits behind a column of figures.
- **Cards** — frosted glass (`backdrop-filter`, 24px radius, no hard border).
  `.card-data` raises the opacity for any panel carrying money; translucency
  behind a balance costs contrast, and balances are the one thing that must
  never be ambiguous. Under `prefers-reduced-transparency` the glass goes fully
  opaque rather than merely less blurred.
- **Type** — `.display` for hero headlines (clamped 30–38px, weight 800,
  leading 1.06), `.card-title` at 17px for section headings inside cards. Big
  type is reserved for the one hero moment per screen; card headings must not
  compete with it.
- **Buttons** — `.btn-primary` is black, with `.btn-ghost` as the quiet
  secondary beneath it. That keeps ginger meaningful: it stays an accent on
  small elements instead of becoming the loudest thing on every screen.
- **`.eyebrow`** — the small outlined pill that sits above a headline.

`/welcome` is a four-step onboarding flow in the hero genre — one idea per
screen, a floating glass preview, and a single black CTA. It's also where a
first-run user lands when they have no groups yet.

## Insights

Every expense is classified into one of ten fixed categories — Dining,
Groceries, Transport, Accommodation, Attractions, Shopping, Nightlife,
Utilities, Health, Other — and the group page shows spend broken down by them,
switchable between what the whole group spent and your own share.

Classification is **batched and lazy**, not per-expense-on-save. Adding "taxi,
$12" has to feel instant, so expenses save with no category and the panel
upgrades every pending one in a single call when you open it. Receipt line
items are passed alongside the description, which is usually the stronger
signal — a receipt titled "Receipt" whose items are salmon and Riesling is
plainly Dining.

The vocabulary is a closed enum enforced by the JSON Schema, deliberately: let
the model invent labels and you get "Dining", "Restaurants" and "Food" as three
separate rows. A category you pick by hand is marked `manual` and the AI pass
will never overwrite it. With no API key, a keyword fallback labels everything
so the panel is never empty.

Bars are single-hue on purpose. Spending categories are nominal — there's no
natural order to them — so shading bars by size would double-encode length as
colour; identity comes from the label and emoji instead.

## Deploying

Next.js on Vercel is zero-config — import the repo, set `ANTHROPIC_API_KEY`
(see `.env.example`), deploy. Or from a machine that's logged in:

```bash
npm i -g vercel
vercel login
vercel --prod
```

**Read this before you do.** `lib/store.ts` keeps state in module scope. That's
fine for one long-lived `next dev` process and wrong for Vercel, where every
route here is server-rendered on demand: each serverless instance gets its own
copy of the seed, instances are recycled when idle, and concurrent requests can
land on different ones. Add an expense and it may be gone on refresh; two people
will see different data. Nothing is corrupted — there's just no shared store
behind it yet.

So a deploy today is worth doing for one specific reason: it's the only way to
exercise the real Claude calls in `parseReceipt.ts` and `classify.ts`, which
can't run locally without a key. Treat it as a staging box for those, not as
something to hand to friends.

The fix is swapping `lib/store.ts` for a Supabase client. `supabase/schema.sql`
is ready to apply, RLS included.

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
