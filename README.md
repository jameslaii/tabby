# Tabby

**Split the bill, not the friendship.**

Photograph a receipt, say who had what in plain English, and Tabby produces an
itemized split — no manual math. Claude reads the receipt and decides *who gets
which item*; the app does every cent of the arithmetic.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # 87 tests over the money paths
npm run typecheck    # tsc --noEmit; `next build` skips tests/
```

It runs with no configuration. Without an API key the receipt flow returns a
fixed sample receipt so the review-and-edit screen is still exercisable — the
splitting, warnings and math are the real code either way.

To read real photos, copy `.env.example` to `.env.local` and set
`ANTHROPIC_API_KEY`.

CI runs typecheck, tests and build on every pull request.

## What's here

| Path | |
|---|---|
| `lib/money.ts` | Integer minor-unit primitives and largest-remainder apportionment |
| `lib/currencies.ts` | The currency list, and how many decimal places each one has |
| `lib/splits.ts` | Claude's item→person mapping → exact per-person amounts, and who paid |
| `lib/assign.ts` | Text-only re-split of "who had what, who paid" across every receipt |
| `lib/balances.ts` | Net positions and greedy debt simplification |
| `lib/categories.ts` | The fixed category vocabulary and keyword fallback |
| `lib/classify.ts` | Batched Claude categorization of expense descriptions |
| `lib/insights.ts` | Spend aggregation for the insights panel |
| `lib/parseReceipt.ts` | The Claude vision + Structured Outputs call |
| `lib/db.ts` | The data layer as pure state transitions, shaped 1:1 to `supabase/schema.sql` |
| `components/StoreProvider.tsx` | Holds that state in the browser and persists it to localStorage |
| `components/ThinkingTrace.tsx` | The itemised account of what reading a receipt is doing |
| `lib/http.ts` | Request-body parsing and the upload size ceiling |
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

The organising idea is **print, not glass**: this is an app about bills, so it
is set like one. It used to be a peach gradient wash under frosted-glass cards,
which is the house style of roughly every app shipped since 2022 — and which
cost real scroll performance on a phone, since six stacked `backdrop-filter`
panels over two fixed gradient layers means the compositor re-rasterises six
blurs per frame.

- **Type** — three faces, three jobs. **Fraunces** carries the one headline per
  screen (`.display`). **DM Mono** carries every figure (`.money`, tabular by
  construction) and every small label (`.card-title`, `.label`, `.eyebrow`),
  because money set in a proportional face reads as marketing and money set in
  a monospace reads as a ledger. **Instrument Sans** does the ordinary talking.
  All three are loaded through `next/font`; the stack previously *named*
  Nunito and Quicksand without ever fetching them, so the app fell through to
  whatever each device happened to have — the iOS system rounded face on a
  phone, something else on a laptop — and had no typeface of its own.
- **Surface** — flat warm paper with a faint grid that fades out before
  mid-screen, so it is never behind a column of figures. One compositor layer.
- **Cards** — opaque stock, 14px radius, a 1.5px rule and a hard blurless
  offset shadow. A blurred shadow says decoration; a hard one says object.
  `.card-data` sits a little more firmly for any panel carrying money.
- **The receipt** — balances are literally a bill, so `.receipt` gives them
  torn top and bottom edges and `.leader` rows carry the eye from a name,
  along a dotted leader, to a right-aligned monospaced figure.
- **Buttons** — squared to 13px rather than a full pill, 52px tall, with a 2px
  hard shadow that collapses under the press. `.btn-sm` is the inline variant.
  Primary is ink; that keeps ginger meaningful as an accent instead of the
  loudest thing on every screen.
- **Folds** — members and activity are `<details>`, not cards. They were
  panels of the same weight as the balances, which made the group screen six
  near-identical blocks with no hierarchy.

### Built for a phone first

- **Inputs are 16px.** Not taste: Safari zooms the whole page in when a field
  under 16px takes focus and never zooms back out. Every field was 15px, so
  every text entry threw the layout sideways.
- **Safe areas.** `viewport-fit: cover` lets the page paint under the notch and
  the home indicator; `.safe-top` / `.safe-bottom` / `.safe-x` keep content
  clear of both. Without the first, the insets are always zero.
- **No tap highlight.** The grey box iOS flashes over a tapped link is the
  loudest signal that something is a web page; buttons have their own
  `:active` state instead.
- **`overscroll-behavior: none`** — rubber-banding past the top used to expose
  plain white behind the fixed gradient.
- **`NavBar` puts back in the corner a thumb reaches for**, on every screen
  below the root, and derives the parent from the route rather than calling
  `router.back()` — history is whatever the browser holds, so on a deep link
  back leaves the app. Each screen used to print its own `← Group name` inside
  the content, which moved the control around and scrolled it away.

`/welcome` is a four-step onboarding flow in the hero genre — one idea per
screen, a small preview of the real interface, and a single dark CTA. It's also
where a first-run user lands when they have no groups yet.

## Where the data lives

In the browser, under one localStorage key, written on every change.

It used to live in a module-scope variable on the server, which survives
exactly as long as a single Node process. Deployed to a serverless host that is
not long: each request can land on a different instance, so a group created by
one request was missing from the next and its page 404'd — the user hitting
"Scan a receipt" on a group they had just made. A cold start or a deploy wiped
everything. The old README noted this ruled out serverless; it needed to be a
blocker rather than a footnote.

The browser is also the right place for it while there are no accounts. The
server copy was one global dataset, so every visitor saw and edited the same
groups. Now `lib/db.ts` is pure — `(Db, input) => Db`, no ambient state, which
is what makes it straightforward to test — and `StoreProvider` owns the single
instance and persists it. Anything unrecognised coming out of storage is
discarded rather than repaired: a half-understood expense is a wrong balance.

The API routes are stateless. They take the member names with the request
instead of looking a group up, so they run correctly on any instance and hold
nothing about anyone between calls.

The trade is that a group lives on the device that made it. Multi-device and
sharing need Supabase plus auth, which is what `supabase/schema.sql` is for.

## An outing, not a bill

A night out bills more than once — a ride there, dinner, a ride back — so the
receipt flow takes several photos at a time and keeps each as its own expense.
That matters for more than tidiness: each bill carries **its own payer**, which
is the only way "I got the Grab there, Sarah got the way back" ends up as two
different debts instead of one averaged one. Receipts are read in parallel as
they arrive, so the review screen fills in while you're still describing who
had what.

Photos are downscaled to a 1600px JPEG in the browser before upload. A phone
photo is 3–8 MB and base64 adds a third on top, which is past the 4.5 MB body
limit Vercel enforces *at the edge* — it answers with a 413 and an empty body,
so there is nothing for `response.json()` to parse and the failure used to
reach the user as the browser's own "The string did not match the expected
pattern". Re-encoding lands a legible receipt around 300 KB, normalises the
iPhone's HEIC into something the API accepts, and drops the EXIF payload.

Editing the description doesn't re-read the photos. `lib/assign.ts` is a
text-only pass over the already-extracted line items, which is both cheaper and
the only way an instruction spanning receipts can work — "I paid the Grab
there, Sarah paid the way back" is meaningless to a call that can only see one
of the two rides.

**Not every bill has a receipt worth photographing.** A fare is a description
and a number, split evenly, so one can be typed straight into the outing.
Making someone photograph a cab receipt to get it into the same split was
asking for a ritual rather than an answer — and going through the separate
manual form instead would have cost the thing that matters, which is that the
ride carries its own payer and the same sentence covers it.

**Several of one thing rarely went round evenly.** Three pints on one line, two
for one person and one for another, is an ordinary bar tab and the case tapping
names cannot express — names alone can only say "these people shared this
equally". Any line whose quantity is more than one gets a count per person
instead, which becomes the weighting: 2 and 1 bills $14 and $7 of a $21 round.
Describing it in words has always worked (the model returns those weights); the
counters are for fixing it by hand. Counts that don't add up to the quantity
still split proportionally, and the hint says so rather than blocking on it.

**Who paid is asked separately from who owes**, and is never guessed. If the
description doesn't name a payer, the receipt is flagged and won't save until
someone is picked. A payer who isn't in the group, or amounts that don't add up
to the bill, are warnings rather than silent adjustments — a payment recorded
against nobody drops out of balances while the debts stay, and a group that
doesn't sum to zero makes debt simplification refuse to run.

## Correcting an expense

Tap any expense to edit or delete it. What happens to the split is decided by
what actually moved, because rebuilding one costs something:

- **Description, category or payer** — the split is left exactly as it is. This
  matters most for a scanned receipt, whose split is itemized and could not be
  reconstructed from the numbers that survive. Fixing whose card came out
  shouldn't cost the itemization.
- **A different total, or a different set of people** — the split is rebuilt as
  an even one and the stored line items are dropped. They summed to the old
  total, and a breakdown that contradicts the expense above it is worse than no
  breakdown. The form says so before you save, and only when it applies.

Deleting takes two taps and names the amount, since it silently moves everyone
else's balance. Both edits and deletions land in the activity log.

## Currency

A group is created in one currency and every expense in it is denominated that
way. A bill can be entered in some *other* currency — a euro sandwich at the airport
on a trip priced in dong — and is converted at today's rate. Two things about
that are worth stating plainly, because both are the sort of bug that stays
invisible until it is expensive.

**Not every currency has cents.** The yen, the won and the dong have no minor
unit at all, so ¥1000 is a thousand yen, not ten. Everything in `lib/money.ts`
scales by the currency's own exponent rather than a hardcoded 100, and that
exponent comes from `Intl` (that is, from CLDR) rather than a table typed out
by hand that would be one more thing to keep correct. A yen bill split three
ways is 333/333/334 yen, and it still sums back exactly.

**The rate is frozen onto the expense and never recalculated.** If balances
were recomputed against today's rate, a group that squared up last week would
quietly come apart because the euro moved overnight. `Expense.exchangeRate` and
`originalAmount` are written once, at entry, and an edit that only fixes a typo
reuses them rather than re-rating the bill.

**Only one conversion ever happens, and it happens at the door.** `readAmount`
in `lib/db.ts` converts into the group's currency before anything else sees the
figure, so splits, payers, balances and settling up only ever handle a single
denomination. All of the currency risk is spent in one function.

Rates come from `app/api/rates`, proxied server-side so the app doesn't depend
on a third party's CORS headers and one cached answer serves everybody. The
source is `open.er-api.com` — free, no key, ~166 currencies. The obvious
alternative, Frankfurter, is European Central Bank data and carries no dong, no
new Taiwan dollar and no dirham, which rules it out for exactly the trips this
is for. If rates can't be reached the form says so and stays in the group's
currency; it never invents a number.

The one place a currency changes behaviour rather than formatting is the home
screen, which used to add every group's net into a single figure. Euros and
dollars do not add. Totals are now kept per currency: a phone holding groups in
one currency still shows a single headline number, and a phone holding several
shows one line each rather than a confident, meaningless sum.

## Waiting for a receipt

Reading a photo takes a few seconds, and a few seconds of nothing reads as a
broken app — people assume it has hung and leave. A spinner is barely better,
because it says only "wait" and never "wait for what".

So the wait is itemised. `ThinkingTrace` lists the real phases of the real
pipeline — shrinking the photo, reading it, working out the split — and each
one flips to done when that phase actually finishes. Nothing is on a timer, and
no step appears that did not happen. Where a step learns something concrete on
the way past it says so: *44 KB*, *5 items*, *3 people*. A number is the
difference between a progress bar and evidence.

It opens the opposite way round to the traces this borrows from, which collapse
by default and expand on demand. That is right for something you read after the
fact; here it is open while it works and folded away once it is finished, since
the entire reason it exists is to be seen mid-flight.

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

## Not done yet

- **Editing a receipt's itemization.** An expense can be corrected or deleted
  (see *Correcting an expense*), but reassigning individual line items after
  saving means reopening the review screen, and the assignments that screen
  works from aren't stored — only the amounts they produced.
- **Auth.** There is no login; `lib/store.ts` holds one stubbed user id and
  every group carries a `group_members` row pointing at it. Supabase auth is
  the next step, and `supabase/schema.sql` already carries the RLS policies it
  needs — swapping `currentUserId()` for `auth.uid()` is most of the job.
- **Multi-device and sharing.** Data lives in one browser (see *Where the data
  lives*). Opening a group on your laptop that you made on your phone shows the
  "not on this device" screen, and there's no way to hand a group to someone
  else. Supabase plus auth is the fix, and `supabase/schema.sql` is already
  written for it.
- **A scanned receipt in another currency.** Typing a bill in a currency other
  than its group's works (see *Currency*), but a *photographed* one is still
  assumed to be in the group's currency. The conversion machinery is all there;
  it is the per-receipt picker in the outing flow that isn't.
- **Multi-payer manual entry.** The receipt flow reads several payers per bill
  and splits what they each put in; the manual add-expense form still offers
  only one payer.
- **Prototype drift.** `docs/prototype.html` re-implements the money logic so it
  can run as a static page. Nothing asserts the two agree; treat `lib/` as the
  source of truth and re-port when the maths changes.
- **Dependency advisories.** `npm audit` reports three high-severity issues in
  `postcss` and `sharp`, both reached only through Next's own dependency tree.
  16.2.12 is the current release, so there is nothing to upgrade to yet —
  `npm audit fix --force` "resolves" them by downgrading to Next 9.
