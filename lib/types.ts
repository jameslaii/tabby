import type { Cents } from "./money";
import type { Category } from "./categories";

export interface GroupMember {
  id: string;
  displayName: string;
  /**
   * The account behind this member, or null for a ghost.
   *
   * Mirrors `group_members.user_id`. Member ids are per-group; the user id is
   * what identifies the same person across groups, which is why "me" resolves
   * through this rather than being held as a single member id.
   */
  userId: string | null;
  isGhost: boolean;
}

export interface Group {
  id: string;
  name: string;
  emoji: string;
  defaultCurrency: string;
  members: GroupMember[];
}

export type SplitType = "equal" | "exact" | "percentage" | "shares";

export interface ExpenseSplit {
  memberId: string;
  lineItemId: string | null;
  splitType: SplitType;
  shareValue: number | null;
  amountOwed: Cents;
}

export interface ExpensePayer {
  memberId: string;
  amountPaid: Cents;
}

export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: Cents;
  lineTotal: Cents;
}

export interface Expense {
  id: string;
  groupId: string;
  description: string;
  category: Category | null;
  /** Where the category came from — an AI guess must never overwrite a human choice. */
  categorySource: "ai" | "manual" | null;
  /** Always in the group's currency, so balances never mix denominations. */
  totalAmount: Cents;
  currency: string;
  /**
   * What the bill actually said, when it was in some other currency.
   *
   * The rate is frozen here at the moment the expense is entered and never
   * recomputed. Recomputing it would mean a group that squared up last week
   * quietly comes unsettled because the euro moved overnight.
   */
  originalAmount?: Cents;
  originalCurrency?: string;
  /** Whole units of `currency` per one whole unit of `originalCurrency`. */
  exchangeRate?: number;
  expenseDate: string;
  sourceType: "manual" | "receipt_ai";
  receiptImageUrl: string | null;
  rawComment: string | null;
  rawTranscript: string | null;
  lineItems: LineItem[];
  payers: ExpensePayer[];
  splits: ExpenseSplit[];
  createdAt: string;
}

export interface Settlement {
  id: string;
  groupId: string;
  fromMember: string;
  toMember: string;
  amount: Cents;
  currency: string;
  note: string | null;
  settledAt: string;
}

export interface ActivityEntry {
  id: string;
  groupId: string;
  action:
    | "expense_created"
    | "expense_updated"
    | "expense_deleted"
    | "settled_up"
    | "member_added"
    | "group_created";
  summary: string;
  entityId: string | null;
  createdAt: string;
}

// ---- AI receipt parsing ------------------------------------------------

/** Raw shape returned by Claude. Dollar amounts, because that's what a
 *  receipt says — converted to cents at the boundary in `splits.ts`. */
export interface ParsedReceipt {
  line_items: {
    temp_id: string;
    description: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }[];
  subtotal: number;
  tax: number;
  tip: number;
  other_charges: number;
  grand_total: number;
  assignments: {
    line_item_temp_id: string; // a line_items.temp_id, or "WHOLE_BILL"
    member_names: string[];
    split_type: "equal" | "shares";
    shares: number[];
  }[];
  /**
   * Who settled this bill at the counter, read from the host's description.
   *
   * Optional because it arrived after the first version of this shape — an
   * older payload without it is still valid, and means "nobody said".
   * `amount` is dollars; 0 means "the host named them but not their share",
   * which `resolvePayers` divides evenly.
   */
  payers?: {
    member_name: string;
    amount: number;
  }[];
  unresolved_items: {
    line_item_temp_id: string;
    reason: string;
  }[];
}

export const WHOLE_BILL = "WHOLE_BILL";

/**
 * How many receipts one split can cover — a dinner plus the rides either side
 * of it, with room to spare. The ceiling exists because every receipt costs a
 * vision call, and those are the expensive part.
 */
export const MAX_RECEIPTS_PER_SPLIT = 8;

export interface FinalSplit {
  memberId: string;
  memberName: string;
  amountOwed: Cents;
}

/**
 * Anything the math could not resolve cleanly. The handover's rule is that
 * unresolved items are *surfaced, never silently guessed away* — so every
 * fallback the split logic takes emits one of these for the review screen.
 */
export interface SplitWarning {
  code:
    | "unknown_member_name"
    | "ambiguous_member_name"
    | "unassigned_item"
    | "duplicate_assignment"
    | "invalid_shares"
    | "subtotal_mismatch"
    | "total_mismatch"
    | "model_flagged"
    | "no_payer"
    | "unknown_payer_name"
    | "payer_total_mismatch";
  message: string;
  /** temp_id of the offending line item, when it maps to one. */
  lineItemTempId?: string;
}

export interface SplitResult {
  splits: FinalSplit[];
  warnings: SplitWarning[];
  /** Sum of all splits. Always equals the reconciled bill total. */
  totalCents: Cents;
}
