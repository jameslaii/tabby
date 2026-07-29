/**
 * The fixed category vocabulary.
 *
 * Fixed, not free-form, and deliberately so: if the model can invent labels
 * you end up with "Dining", "Restaurants" and "Food" as three separate rows
 * and the insights panel becomes noise. The enum below is what the JSON
 * Schema constrains the model to, so every expense lands in exactly one of
 * these buckets.
 */

export const CATEGORIES = [
  "Dining",
  "Groceries",
  "Transport",
  "Accommodation",
  "Attractions",
  "Shopping",
  "Nightlife",
  "Utilities",
  "Health",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_EMOJI: Record<Category, string> = {
  Dining: "🍽️",
  Groceries: "🛒",
  Transport: "🚕",
  Accommodation: "🏨",
  Attractions: "🎟️",
  Shopping: "🛍️",
  Nightlife: "🍸",
  Utilities: "💡",
  Health: "💊",
  Other: "🧾",
};

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

/**
 * Keyword fallback, used when no API key is configured and as the seed guess
 * before classification runs. It is intentionally shallow — it exists so the
 * panel is never empty, not to compete with the model.
 *
 * Order matters: the first matching rule wins, so narrower vocabularies
 * ("pharmacy") sit above broader ones ("market").
 */
/**
 * Each entry's vocabulary is joined into `\b(?:…)(?:e?s)?\b`, so a stem also
 * matches its plural — "cocktail" catches "Cocktails", "bus" catches "buses".
 * Writing `\bcocktail\b` by hand does *not* match "Cocktails": there's no word
 * boundary between "l" and "s".
 */
const VOCABULARY: [Category, string[]][] = [
  [
    "Nightlife",
    ["bar", "pub", "club", "cocktail", "beer", "nightcap", "brewery", "wine bar", "tapas bar"],
  ],
  [
    "Groceries",
    ["grocer", "groceries", "supermarket", "market", "mercado", "deli", "bakery", "butcher", "corner shop"],
  ],
  [
    // Venue words, then dish words. The dish list matters more than it looks:
    // receipts often carry a generic title ("Receipt") and all the real signal
    // is in the line items.
    "Dining",
    ["restaurant", "dinner", "lunch", "breakfast", "brunch", "cafe", "café", "coffee",
     "tasca", "taqueria", "bistro", "diner", "takeaway", "food",
     "pizza", "sushi", "steak", "salmon", "chicken", "pasta", "burger", "salad",
     "soup", "sandwich", "fries", "tapas", "dessert", "appetizer", "entree",
     "risotto", "curry", "noodle", "burrata", "toast"],
  ],
  [
    "Transport",
    ["taxi", "uber", "lyft", "cab", "train", "metro", "bus", "tram", "flight",
     "airline", "airport", "fuel", "petrol", "gas", "parking", "toll",
     "car hire", "rental car", "ferry", "fare"],
  ],
  [
    "Accommodation",
    ["hotel", "hostel", "airbnb", "guesthouse", "lodge", "motel", "apartment",
     "stay", "accommodation", "resort"],
  ],
  [
    "Attractions",
    ["museum", "gallery", "tour", "ticket", "entry", "entrance", "park", "zoo",
     "aquarium", "castle", "cathedral", "show", "concert", "cinema", "theatre",
     "theater", "excursion", "sightseeing"],
  ],
  [
    "Health",
    ["pharmacy", "chemist", "doctor", "clinic", "hospital", "medicine", "dentist", "insurance"],
  ],
  [
    "Shopping",
    ["shop", "store", "clothes", "clothing", "souvenir", "gift", "electronics", "book", "mall"],
  ],
  [
    "Utilities",
    ["wifi", "internet", "phone", "sim", "data", "electricity", "water bill", "laundry", "utilities"],
  ],
];

const RULES: [Category, RegExp][] = VOCABULARY.map(([category, words]) => [
  category,
  new RegExp(
    `\\b(?:${words.map((w) => w.replace(/ /g, " ?")).join("|")})(?:e?s)?\\b`,
    "i",
  ),
]);

export function classifyLocally(text: string): Category {
  for (const [category, pattern] of RULES) {
    if (pattern.test(text)) return category;
  }
  return "Other";
}
