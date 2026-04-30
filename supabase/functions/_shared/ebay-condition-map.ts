// ============================================================
// Grade → eBay Condition mapping
//
// Internal condition grades 1-5 (5 is non-saleable, never published).
//
// eBay's condition vocabulary varies per category. The Taxonomy API
// `get_item_condition_policies` endpoint reports which `conditionId`s
// are accepted for a given category, and whether free-text
// `conditionDescription` is permitted.
//
// We keep an ordered list of fallback conditionIds per grade so that
// when a category does not accept our preferred condition we can
// degrade gracefully rather than failing the publish.
// ============================================================

// eBay condition IDs (numeric) and their Inventory-API enum equivalents.
//
// Sources:
//   • developer.ebay.com Sell Inventory API → ConditionEnum
//   • developer.ebay.com Taxonomy API → get_item_condition_policies
//
// Only the values we actually use are listed here.
export const EBAY_CONDITION_ENUM: Record<string, string> = {
  "1000": "NEW",
  "1500": "NEW_OTHER",
  "1750": "NEW_WITH_DEFECTS",
  "2000": "CERTIFIED_REFURBISHED",
  "2010": "EXCELLENT_REFURBISHED",
  "2020": "VERY_GOOD_REFURBISHED",
  "2030": "GOOD_REFURBISHED",
  "2500": "SELLER_REFURBISHED",
  "2750": "LIKE_NEW",
  "3000": "USED_EXCELLENT",
  "4000": "USED_VERY_GOOD",
  "5000": "USED_GOOD",
  "6000": "USED_ACCEPTABLE",
  "7000": "FOR_PARTS_OR_NOT_WORKING",
};

// Ordered preference list per internal grade. First entry is the
// preferred conditionId; subsequent entries are progressive fallbacks
// used only when the category does not allow the preferred value.
//
// Grade 5 is non-saleable so it's never resolved — included only as a
// safety net.
const GRADE_PREFERENCES: Record<string, string[]> = {
  // 1 = New / sealed
  "1": ["1000", "1500", "2750", "3000"],
  // 2 = Excellent / open-box, complete
  "2": ["1500", "2750", "3000", "4000", "5000"],
  // 3 = Good / used, complete
  "3": ["3000", "4000", "5000", "6000"],
  // 4 = Acceptable / used with notable wear
  "4": ["5000", "6000", "4000", "3000"],
  // 5 = Non-saleable. Should never publish but pick the lowest if it does.
  "5": ["7000", "6000", "5000"],
};

export interface CategoryConditionPolicy {
  itemConditionRequired?: boolean;
  itemConditionDescriptionEnabled?: boolean;
  // Each entry has at minimum a conditionId; we keep the raw shape too.
  itemConditions?: Array<{ conditionId: string; conditionDescription?: string }>;
}

export interface ResolvedEbayCondition {
  conditionId: string;
  condition: string; // ConditionEnum string for the Inventory API
  fallbackUsed: boolean; // true when we couldn't use the preferred ID
  allowsConditionDescription: boolean;
}

/**
 * Resolve an internal grade to an eBay condition for a specific
 * category, honouring the category's allow-list when one is cached.
 * If no policy is cached we fall back to the preferred mapping
 * (so existing behaviour is preserved for un-synced categories).
 */
export function resolveEbayCondition(
  grade: string | null | undefined,
  policy: CategoryConditionPolicy | null | undefined,
): ResolvedEbayCondition {
  const g = (grade ?? "").trim() || "3";
  const prefs = GRADE_PREFERENCES[g] ?? GRADE_PREFERENCES["3"];

  const allowed = (policy?.itemConditions ?? [])
    .map((c) => String(c.conditionId))
    .filter(Boolean);
  const allowsDesc = policy?.itemConditionDescriptionEnabled !== false;

  // No policy cached → trust the preferred mapping (legacy behaviour).
  if (allowed.length === 0) {
    const id = prefs[0];
    return {
      conditionId: id,
      condition: EBAY_CONDITION_ENUM[id] ?? "USED_GOOD",
      fallbackUsed: false,
      allowsConditionDescription: allowsDesc,
    };
  }

  // Pick the first preferred ID the category accepts.
  for (let i = 0; i < prefs.length; i++) {
    if (allowed.includes(prefs[i])) {
      return {
        conditionId: prefs[i],
        condition: EBAY_CONDITION_ENUM[prefs[i]] ?? "USED_GOOD",
        fallbackUsed: i > 0,
        allowsConditionDescription: allowsDesc,
      };
    }
  }

  // None of our preferences fit → use whatever the category does allow,
  // preferring the lowest "used" tier so we don't oversell condition.
  const lastResort = allowed.find((id) => id === "5000")
    ?? allowed.find((id) => id === "6000")
    ?? allowed[allowed.length - 1];
  return {
    conditionId: lastResort,
    condition: EBAY_CONDITION_ENUM[lastResort] ?? "USED_GOOD",
    fallbackUsed: true,
    allowsConditionDescription: allowsDesc,
  };
}

/**
 * Trim/clean a free-text condition description for eBay.
 * eBay's max length is 1000 characters.
 */
export function sanitiseConditionDescription(
  notes: string | null | undefined,
): string | null {
  if (!notes) return null;
  const trimmed = notes.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > 1000 ? trimmed.slice(0, 997) + "..." : trimmed;
}
