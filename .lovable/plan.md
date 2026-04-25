## Goal

Stop duplicating attributes between the app's Specifications tab and the eBay aspects form. The Specifications tab becomes the **single source of canonical product attributes** — sourced from product columns and BrickEconomy where possible, extensible by appending new attributes. eBay's category and item specifics are derived automatically on the backend by mapping canonical attributes → channel-specific schemas. The user can override the auto-resolved eBay category but should never manually retype Brand, Theme, Pieces, Year, Set Number, EAN, Age, etc.

## Current problem

`SpecificationsTab.tsx` shows 10 fields (Set Number, Theme, Subtheme, Pieces, Age Mark, EAN, Released, Retired, Dimensions, Weight). `EbayAspectsForm.tsx` immediately under it asks for the *same* values again under eBay aspect names (Brand, LEGO Theme, Number of Pieces, Year Manufactured, Recommended Age Range, EAN, Model, MPN, Set Name) plus a manual category picker — even though `lego-aspects-prefill.ts` already knows how to derive every one of those from canonical data.

## Target architecture

### 1. Canonical attribute model (frontend = read-only summary; data lives in DB)

The Specifications tab renders a single list of canonical attributes drawn from two sources:

| Source | Examples |
|---|---|
| `product` columns | `mpn`, `name`, `set_number`, `theme`, `subtheme_name`, `piece_count`, `age_mark`, `ean`, `released_date`, `retired_date`, `dimensions_cm`, `weight_g` |
| `brickeconomyData` | `subtheme`, `piecesCount`, `year`, `releasedDate`, `retiredDate`, `minifigsCount`, `retailPrice` |

Each row shows: label, current value, source badge (`Product` / `BrickEconomy` / `Override`), and an inline edit affordance. Editing writes to the product column and records a `field_overrides` entry when overriding a BrickEconomy-sourced value (existing behaviour preserved).

**New attributes auto-append**: the tab iterates over a `CANONICAL_ATTRIBUTE_REGISTRY` (`src/lib/utils/canonical-attributes.ts`) instead of a hard-coded `SPEC_FIELDS` array. Adding a new entry to that registry — by giving it a label, a resolver (product column or BE field), and an editor type — is the only change needed to surface a new attribute. No eBay-side change is required.

### 2. Backend channel mapping (no UI duplication)

Move the `lego-aspects-prefill.ts` logic from the client to the `ebay-taxonomy` edge function as a new action `resolve-aspects`:

```
POST ebay-taxonomy { action: "resolve-aspects", product_id, categoryId, marketplace }
→ { resolved: Record<aspectKey, { value, source }>, missing: aspectKey[] }
```

The function:
1. Loads the product, its BrickEconomy row, and any saved `product_attribute` rows.
2. Loads the cached aspect schema for the category.
3. Maps canonical fields → eBay aspect keys via a backend mapping table (initially the same constants from `lego-aspects-prefill.ts`, moved into `supabase/functions/_shared/channel-aspect-map.ts`).
4. Returns a fully-resolved aspect set, flagging only the aspects that need genuine human input (e.g. eBay-only fields like "Features" or marketplace-specific compliance flags).

The resolved aspects are persisted to `product_attribute` (namespace `ebay`) on save with `source = "auto:canonical"`. These rows are recomputed whenever canonical product data changes (handled via a follow-up `resolve-aspects` call from the product save path) — no manual re-entry.

### 3. Auto category resolution

eBay category should be **auto-determined** from the product's theme/product_type, with manual override still available.

Add to `ebay-taxonomy` a new action `auto-resolve-category`:

```
POST ebay-taxonomy { action: "auto-resolve-category", product_id, marketplace }
→ { categoryId, categoryName, confidence: "high"|"medium"|"low", basis: string }
```

Heuristic (initial, simple):
- Build query string from `product.name + " " + theme + " " + (product_type === "minifig" ? "minifigure" : "set") + " lego"`.
- Call eBay `get_category_suggestions`, take the top result whose ancestor path contains a LEGO-relevant node (e.g. category 19006 for LEGO Sets, 49019 for Minifigures on EBAY_GB).
- If found and `category.ebay_category_id` is null on the product, write it with `source = "auto"`. If already set with `source = "manual"`, leave it alone.
- Track resolution metadata in `product_attribute` namespace `core`, key `ebay_category_resolution` (basis + confidence + resolved_at).

Trigger points:
- On product creation / first save (already in product save path).
- On-demand from a "Re-detect category" button in the Specifications tab.

The existing `EbayCategoryPicker` is repurposed as a compact override widget: shows current category + confidence badge + "Override" button (which opens the existing search dropdown). No category search is required for the common case.

### 4. UI changes to Specifications tab

Replace the current two-card layout (Specifications + eBay Listing Details) with one card flow:

```
┌── Product Specifications ─────────────────────────────────┐
│  All canonical attributes (product + BE), inline editable │
│  Source badges, override revert affordances               │
│  [+ Add custom attribute]   ← writes to product_attribute │
│                              namespace=core               │
└──────────────────────────────────────────────────────────┘

┌── Channel Mapping ────────────────────────────────────────┐
│  eBay category: 19006 — LEGO Sets  [auto · high]  [Override]│
│  ▸ 14 of 18 required aspects resolved automatically        │
│  ▸ 4 aspects need attention:                               │
│      • Features  [—] (free text)                          │
│      • Country/Region of Manufacture  [Denmark ▼]         │
│      ...                                                  │
│  Google Merchant: auto-resolved · 6 attrs                 │
│  Meta Catalog:    coming soon                             │
└──────────────────────────────────────────────────────────┘
```

The "needs attention" list shows **only** aspects that cannot be derived from canonical data — never Brand, Theme, MPN, Pieces, Year, EAN, Age, Set Number, Model, Set Name, Type, Packaging.

### 5. Remove duplication explicitly

`EbayAspectsForm.tsx` is replaced by a much smaller `ChannelAttentionList.tsx` that only renders the `missing` aspects returned by `resolve-aspects`. The "Prefill from LEGO data" button is removed entirely — prefill is automatic and server-side.

`lego-aspects-prefill.ts` is moved into the edge function shared folder and deleted from `src/lib/utils/`.

## Files affected

**New**
- `src/lib/utils/canonical-attributes.ts` — canonical attribute registry, resolvers, source labels.
- `src/components/admin-v2/CanonicalSpecsCard.tsx` — replaces the spec-grid in `SpecificationsTab`.
- `src/components/admin-v2/ChannelMappingCard.tsx` — auto-category badge + override + missing-aspects list.
- `src/components/admin-v2/ChannelAttentionList.tsx` — renders only un-resolvable aspects.
- `supabase/functions/_shared/channel-aspect-map.ts` — backend port of `lego-aspects-prefill.ts`.

**Edited**
- `src/components/admin-v2/SpecificationsTab.tsx` — composed of the two new cards above; old grid + eBay form removed.
- `src/components/admin-v2/EbayCategoryPicker.tsx` — slimmed to "current + override" widget; expand-on-click search retained for override.
- `src/hooks/admin/use-channel-taxonomy.ts` — add `useAutoResolveCategory`, `useResolveChannelAspects`.
- `supabase/functions/ebay-taxonomy/index.ts` — add `auto-resolve-category` and `resolve-aspects` actions.
- `supabase/functions/admin-data/index.ts` — on `update-product`, enqueue/perform `resolve-aspects` so persisted eBay attrs stay in sync.

**Deleted**
- `src/components/admin-v2/EbayAspectsForm.tsx`
- `src/lib/utils/lego-aspects-prefill.ts`

## Database

No schema changes required. Existing `product_attribute (product_id, namespace, key, value, value_json, source)` covers everything; we just write more rows with `source = "auto:canonical"`.

## Out of scope (explicitly)

- No re-introduction of age marks, dimensions, weight, or any other field already covered by canonical sources, into a channel-specific form.
- No GMC/Meta UI yet — backend hook is ready but the UI just shows "auto · N attrs" until a future iteration.
- No bulk re-resolve job for the existing catalogue (one-time backfill can be added later if needed).

## Acceptance

1. Opening a product with theme/name set: eBay category appears as `auto · high/medium` with no manual search needed.
2. Specifications tab shows one unified attribute list — no duplicate Brand / Pieces / Year / EAN inputs anywhere on the page.
3. Editing `piece_count` in Specifications immediately reflects in the resolved eBay aspect "Number of Pieces" (no second save).
4. The "needs attention" list contains zero overlap with canonical attributes.
5. Adding a new entry to `CANONICAL_ATTRIBUTE_REGISTRY` is the only code change needed to surface a new product attribute on the tab.