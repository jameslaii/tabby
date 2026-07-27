# Tabby — Test Coverage Analysis & Proposed Priorities

## Current state

The repository contains `README.md` and nothing else. There is no application
code, no test framework, no CI. Measured coverage is 0% of 0 lines.

So this document does the useful version of the question instead: it audits the
only real logic that exists today — `computeFinalSplits()` in the handover's
`parseReceiptAndSplit.ts` — and proposes what to test, in priority order, as the
app gets built.

The audit is not theoretical. Every failure below was reproduced by running the
function verbatim (script at the end of this doc).

---

## Why this code deserves tests before it ships

The handover's central architectural decision is right: *the LLM does semantic
mapping, app code does the arithmetic — "you never want an LLM rounding your
friends' money."* But the arithmetic half currently has a design flaw that
undermines the guarantee.

`computeFinalSplits()` ends with a penny-drift correction:

```ts
const driftCents = targetCents - sumCents;
if (driftCents !== 0 && splits.length > 0) {
  const biggest = splits.reduce((a, b) => (b.amountOwed > a.amountOwed ? b : a));
  biggest.amountOwed = ... + driftCents / 100;
}
```

The intent is to absorb sub-cent rounding — a drift of 1–2 cents. But `driftCents`
is **unbounded** and every upstream inconsistency funnels into it. An unmatched
name, a missing assignment, an OCR misread of the total: each silently becomes a
large adjustment applied to one arbitrary person, with no error and no flag.

The function's one enforced invariant — "splits always sum to `grand_total`" — is
exactly what hides the bugs. It is always *self-consistent* and can still be
wildly *wrong*.

### Reproduced failures

Members: Sarah, John, Alex (in that array order).

| # | Scenario | Result | Expected |
|---|---|---|---|
| A | `WHOLE_BILL` assignment, no line items | `Sarah=110, John=0, Alex=0` | ~36.67 each |
| B | One item assigned to `"Sara"` (typo of `"Sarah"`) | `Sarah=83.34, John=3.33, Alex=3.33` | error or flag |
| C | `split_type: "shares"` with `shares: [0, 0]` | `Sarah=NaN, John=NaN` | error |
| D | Two members both named `"John"` | `John=0, John=30` | error or ID-based match |
| E | `$10.00` split 3 ways | `3.34 / 3.33 / 3.33` | ✅ correct |
| F | Receipt totals `$100`, `grand_total` OCR'd as `$1000` | `Sarah=933.34, ...` | error or flag |

Only case E is correct. The others are silent — no throw, no warning, nothing in
`unresolved_items`.

### The specific defects

1. **`"WHOLE_BILL"` is never handled.** `ParsedReceipt.assignments[].line_item_temp_id`
   is documented as `"matches a line_items.temp_id, or \"WHOLE_BILL\""`, and the
   system prompt invites it ("split the rest evenly"). But `computeFinalSplits`
   only iterates `parsed.line_items` and looks assignments up *by item*. A
   `WHOLE_BILL` assignment matches no item and is dropped. Nobody is charged,
   drift becomes the entire bill, and it all lands on one person (case A). This is
   the declared interface silently not implemented — the highest-severity bug here.

2. **Unmatched names delete money.** `ids.filter((id) => !!id)` drops names not in
   the group, and `if (ids.length === 0) continue` skips the item entirely. The
   cost doesn't vanish, though — drift re-adds it to one person (case B). The
   handover promises unresolved items are "surfaced, never silently guessed away";
   here they are silently *reassigned*.

3. **Name-based joins are the wrong key.** `nameToId` is keyed on `displayName`, so
   duplicate names collapse (case D — the first John is unreachable and pays $0),
   and matching is exact: case, whitespace, and accents all break it. Friend groups
   have two Jameses. `group_members.display_name` has no uniqueness constraint in
   `schema.sql`, so the DB permits exactly what breaks this map.

4. **Division by zero → `NaN` propagation.** `totalShares` of 0 yields `NaN`, which
   survives `Math.round` and reaches `amountOwed` (case C). `numeric(12,2)` will
   reject that at insert time, so the user gets a 500 rather than a clear error.

5. **Shares silently degrade to equal.** The guard is
   `assignment.shares.length === ids.length`, comparing against the *filtered* ids.
   Any unmatched name makes the lengths differ and the explicit weighting is
   discarded in favour of an equal split — no signal. (It also means `shares[i]`
   indexes the filtered array while the values were parallel to the unfiltered
   `member_names`, so a mismatched-length response from the model can misalign
   weights onto the wrong people.)

6. **`parsed.subtotal` is trusted as the tax/tip denominator.** `share =
   memberSubtotal / parsed.subtotal` assumes the line items sum to the subtotal.
   When OCR disagrees, tax/tip is over- or under-distributed and the remainder
   again becomes drift. Nothing validates
   `subtotal + tax + tip + other_charges ≈ grand_total` (case F).

7. **Arbitrary tie-break.** `reduce` with `>` keeps the first maximum, so when
   amounts tie the adjustment lands on whoever appears first in the `members`
   array. Results depend on member ordering — the same receipt can bill different
   people. Worth pinning in a test regardless of which rule you pick.

8. **Duplicate assignments are ignored.** `.find()` takes the first match only. If
   the model emits two entries for one item ("Sarah had the salmon" *and* "we
   split the salmon"), the second is dropped silently.

### The fix these tests should drive

Split the final step in two: distribute genuine sub-cent remainder deterministically
(largest-remainder, or round-robin by member id for stability), then assert that any
residual is within `±splits.length` cents. Anything larger is an upstream data fault
— throw, or return it as an unresolved item for the review screen. That single
change turns all six failures above from silent to visible, and it is only testable
if the tests assert the *bound*, not just the sum.

---

## Proposed priorities

### P0 — `computeFinalSplits()` unit tests

The only real code, and it decides what people owe. Pure and dependency-free, so
this is cheap. Cases: the table above; single member; member with zero items;
zero-value bill; tax/tip with `subtotal = 0`; negative line totals (coupons);
duplicate `temp_id`s; empty `members`; `unresolved_items` surviving to the caller.

Plus property-based tests (fast-check) over generated receipts, asserting:

- splits sum to `grand_total` **and** total drift ≤ `members.length` cents
- no `NaN`, no `undefined`
- all-non-negative inputs produce non-negative outputs
- **permutation invariance** — reordering `members` must not change who owes what
  (currently violated by defect 7)

### P0 — Balance calculation and debt simplification

Both are listed as unwritten in the handover. Write the tests with the code, not
after — greedy settlement is deceptively easy to get wrong.

- Balances derive from `expense_splits` + `settlements` and must sum to zero
  across a group, always. Multi-payer expenses (`expense_payers`) mean a person
  can be both creditor and debtor on one expense.
- Debt simplification: conserves every cent; terminates (assert an iteration
  bound — a float-comparison bug loops forever on residual epsilon); never emits
  a self-payment or a zero/negative transfer; produces ≤ n−1 transfers; handles
  the already-settled group, the single-debtor-many-creditors star, and cyclic
  debt (A→B→C→A collapses to nothing).
- Use integer cents internally. The `numeric(12,2)` columns arrive as strings via
  the Supabase JS client; a test should cover that boundary specifically, because
  `"10.00" + "5.00"` is `"10.005.00"` in JavaScript.

### P1 — Schema constraints and RLS

`schema.sql` has **no row-level security policies at all**. On Supabase the anon
key is public by design, so without RLS every group's expenses are readable by
anyone. This is the single largest risk in the design and needs integration tests
that authenticate as user A and assert user B's group is invisible across every
table — plus a test that fails loudly if RLS is ever disabled on a table.

Integrity gaps worth constraining and then testing:

- `expense_payers.amount_paid` should sum to `expenses.total_amount`; nothing enforces it
- `expense_splits.amount_owed` should sum to `expenses.total_amount`; nothing enforces it
- `settlements` permits `from_member = to_member` (paying yourself)
- Nothing keeps `settlements.from_member`/`to_member`, `expense_payers.member_id`, or
  `expense_splits.member_id` in the *same group* as the parent row — the FKs point
  at `group_members(id)` globally, so a cross-group reference inserts cleanly and
  silently corrupts two groups' balances
- `unique (group_id, user_id)` doesn't constrain ghosts: `NULL` is never equal to
  `NULL` in Postgres, so unlimited duplicate ghost rows are allowed
- Ghost-to-real linking on signup needs its own tests: balances must be preserved
  exactly across the merge, and the merge must be idempotent

### P1 — `parseReceiptAndSplit()` boundary (mocked SDK)

Test the wrapper, not the model. Mock `@anthropic-ai/sdk` and cover: a normal
response parses to `ParsedReceipt`; no text block throws the documented error;
API error propagates cleanly; the member-name substitution into `{{MEMBER_NAMES}}`
is correct (including names containing commas, which currently make the
comma-joined list ambiguous).

One real gap: the handover states Structured Outputs mean "no manual JSON-parsing
error handling needed," but `max_tokens: 4096` can truncate a long receipt
mid-object, and `JSON.parse` then throws an unhandled `SyntaxError`. Check
`stop_reason === "max_tokens"` and test it.

### P2 — LLM output quality (eval suite, not CI)

Non-deterministic, so keep it out of the unit-test gate — a separate suite run on
changes to the prompt or model. Fixture receipts (faded thermal print, handwritten
tip, foreign currency, two columns, a photo at an angle) plus host instructions,
scored on: line items extracted, `subtotal + tax + tip ≈ grand_total`, every
`temp_id` in `assignments` existing in `line_items`, ambiguity landing in
`unresolved_items`, and no dollar amounts invented in the mapping. Track pass rate
over time rather than asserting exact equality.

### P2 — Review/edit screen (E2E)

The handover calls this "the make-or-break UX moment." Worth Playwright coverage
once it exists: unresolved items are visibly flagged; editing an assignment
recomputes totals; the recomputed split still sums to the receipt total; a
receipt can't be saved while it doesn't balance.

---

## Suggested tooling

Vitest (unit + property, via fast-check), a Supabase local instance for the RLS
and constraint tests, Playwright for E2E. Gate CI on P0 and P1; run evals on
demand. Coverage thresholds are not very meaningful on a codebase this small —
the money paths are what matter, and they should be at 100%.

---

## Appendix — reproduction script

Zero dependencies. Copy `computeFinalSplits` verbatim from
`parseReceiptAndSplit.ts` (strip the type annotations) into a `.mjs` file and
append:

```js
const M = [
  { id: "m1", displayName: "Sarah" },
  { id: "m2", displayName: "John" },
  { id: "m3", displayName: "Alex" },
];
const show = (l, r) => console.log(l, JSON.stringify(r.map(s => `${s.memberName}=${s.amountOwed}`)));

// A: WHOLE_BILL assignment — entire bill lands on one member
show("A", computeFinalSplits({
  line_items: [], subtotal: 90, tax: 8, tip: 12, other_charges: 0, grand_total: 110,
  assignments: [{ line_item_temp_id: "WHOLE_BILL", member_names: ["Sarah","John","Alex"], split_type: "equal", shares: [] }],
  unresolved_items: [],
}, M));

// B: unmatched name "Sara" — $80 item silently re-billed via drift
show("B", computeFinalSplits({
  line_items: [
    { temp_id: "i1", description: "Salmon", quantity: 1, unit_price: 80, line_total: 80 },
    { temp_id: "i2", description: "Fries",  quantity: 1, unit_price: 10, line_total: 10 },
  ],
  subtotal: 90, tax: 0, tip: 0, other_charges: 0, grand_total: 90,
  assignments: [
    { line_item_temp_id: "i1", member_names: ["Sara"], split_type: "equal", shares: [] },
    { line_item_temp_id: "i2", member_names: ["Sarah","John","Alex"], split_type: "equal", shares: [] },
  ],
  unresolved_items: [],
}, M));

// C: zero shares — NaN
show("C", computeFinalSplits({
  line_items: [{ temp_id: "i1", description: "Wine", quantity: 1, unit_price: 60, line_total: 60 }],
  subtotal: 60, tax: 0, tip: 0, other_charges: 0, grand_total: 60,
  assignments: [{ line_item_temp_id: "i1", member_names: ["Sarah","John"], split_type: "shares", shares: [0,0] }],
  unresolved_items: [],
}, M));

// D: duplicate display names — first John pays nothing
show("D", computeFinalSplits({
  line_items: [{ temp_id: "i1", description: "Pizza", quantity: 1, unit_price: 30, line_total: 30 }],
  subtotal: 30, tax: 0, tip: 0, other_charges: 0, grand_total: 30,
  assignments: [{ line_item_temp_id: "i1", member_names: ["John"], split_type: "equal", shares: [] }],
  unresolved_items: [],
}, [{ id: "m1", displayName: "John" }, { id: "m2", displayName: "John" }]));

// F: OCR misreads grand_total as 1000 — $933 billed to one person
show("F", computeFinalSplits({
  line_items: [{ temp_id: "i1", description: "Dinner", quantity: 1, unit_price: 90, line_total: 90 }],
  subtotal: 90, tax: 10, tip: 0, other_charges: 0, grand_total: 1000,
  assignments: [{ line_item_temp_id: "i1", member_names: ["Sarah","John","Alex"], split_type: "equal", shares: [] }],
  unresolved_items: [],
}, M));
```

Output:

```
A ["Sarah=110","John=0","Alex=0"]
B ["Sarah=83.34","John=3.33","Alex=3.33"]
C ["Sarah=NaN","John=NaN","Alex=0"]
D ["John=0","John=30"]
F ["Sarah=933.34","John=33.33","Alex=33.33"]
```
