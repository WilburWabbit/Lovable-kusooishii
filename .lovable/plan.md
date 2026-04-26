# Clean up per-category attributes & auto-bootstrap new category aspects

## What's wrong today

I inspected the registry, mappings, and resolver. Three structural problems are causing the symptom you're seeing:

### 1. The Specifications tab shows **every** canonical attribute, regardless of category
`resolveAllForProduct` in `supabase/functions/_shared/canonical-resolver.ts` selects all `active = true` rows from `canonical_attribute` with no scoping. So your KitchenAid Food Chopper is shown LEGO-only fields (Theme, Subtheme, Pieces, Minifigures, Set Number, Released, Retired, Version, …) and a LEGO product would be shown food-processor fields once we add them.

### 2. The `canonical_attribute` registry has accumulated duplicates
Two parallel naming styles were seeded over previous iterations:

| Concept | Duplicate keys present |
|---|---|
| Set Number | `setNumber` + `set_number` |
| Pieces | `pieceCount` + `piece_count` |
| Minifigs | `minifigsCount` + `minifig_count` |
| Release year | `releaseYear` + `release_year` (+ `releasedDate`) |
| Retired | `retiredDate` + `retired_flag` |
| Weight | `weightG` |
| Dimensions | `dimensionsCm` + `dimensions_cm` |
| Age mark | `ageMark` (in `physical`) + `age_mark` (in `marketing`) |
| Set name | `name` + `product_name` |
| Product type | `productType` + `product_type` |

The Specifications tab therefore shows things twice.

### 3. New aspects from a freshly-fetched eBay category never become canonical
When **Food Processors (20673)** was added, 32 aspects were inserted into `channel_category_attribute` (Capacity, Power, Voltage, Cable Length, Colour, Material, Number of Blades, …) but:
- No matching `canonical_attribute` rows were created
- No `channel_attribute_mapping` rows were created
- No DB columns were added to `product`

So they sit as "unmapped" forever and the Specifications tab has no field to capture them.

### 4. Mappings aren't scoped where they should be
All current `channel_attribute_mapping` rows have `category_id = NULL` (global). Some of them are genuinely universal (`EAN → ean`, `MPN → mpn`) but `LEGO Set Number`, `LEGO Theme`, `LEGO Subtheme`, `Number of Pieces`, `Packaging = "Box"`, **`Brand = "LEGO"` (constant)** are LEGO-specific and shouldn't apply when the category is Food Processors. That's why your KitchenAid still says **Brand: LEGO**.

---

## The fix — four coordinated changes

### Change A — Add scoping metadata to `canonical_attribute`
Migration adds two nullable columns:

- `applies_to_product_types text[]` — when set, only show this attribute for products with one of these `product_type` values (e.g. `{set, minifigure}` for LEGO‑only fields). NULL = applies to everything (universal fields like name, brand, weight, dimensions, EAN, UPC).
- `applies_to_ebay_categories text[]` — when set, only show this attribute when the resolved eBay category is one of these IDs. NULL = no category restriction. (Used for category-specific fields like Capacity, Power, etc.)

The two filters are AND-ed with the current `active = true` filter.

### Change B — Dedupe and re-key the canonical registry
One idempotent migration:

1. **Delete the camelCase duplicates** (`setNumber`, `pieceCount`, `minifigsCount`, `releaseYear`, `releasedDate`, `retiredDate`, `weightG`, `dimensionsCm`, `ageMark`, `productType`, `retailPrice`, `name`) **after** repointing any `channel_attribute_mapping.canonical_key` rows that still reference them to the snake_case survivors.
2. Keep the snake_case canonical set as the single source of truth: `mpn`, `set_number`, `product_name`, `theme`, `subtheme`, `piece_count`, `minifig_count`, `release_year`, `retired_flag`, `version_descriptor`, `product_type`, `weight_g`, `length_cm`, `width_cm`, `height_cm`, `dimensions_cm`, `age_mark`, `condition`, `age_range`, `packaging`, `brand`, `ean`, `upc`, `isbn`.
3. Set `applies_to_product_types` on the LEGO‑only attributes (`set_number`, `theme`, `subtheme`, `piece_count`, `minifig_count`, `release_year`, `retired_flag`, `version_descriptor`).
4. Make `brand` editable + product‑sourced (column `brand` already exists on `product`) — no longer a hard-coded constant.

### Change C — Auto-create canonical attributes & DB columns when a new eBay category schema is fetched
Inside `ebay-taxonomy/index.ts`'s `category-aspects` action (right after the category schema is upserted), for every aspect that does **not** already have a canonical attribute or a channel mapping:

1. Generate a slug key from the aspect name (e.g. `Cable Length` → `cable_length`, `Number of Speeds` → `number_of_speeds`).
2. If no `canonical_attribute` row with that key exists, insert one with:
   - `attribute_group = 'physical'` (or `'marketing'` if it looks like a tag/feature)
   - `editor` mapped from eBay's `aspectDataType` (`STRING` → text, `NUMBER` → number, `DATE` → date)
   - `data_type` matching
   - `db_column = <slug>` and call the existing `ensure_product_column` RPC to add it to `product`
   - `provider_chain = [{provider:'product', field:'<slug>'}]`
   - `applies_to_ebay_categories = ARRAY[<categoryId>]` (so it only shows on products in that category)
   - `editable = true`, `active = true`
3. Insert a `channel_attribute_mapping` row scoped to that exact `(channel='ebay', marketplace, category_id, aspect_key)` pointing at the new canonical key.

If the canonical attribute already exists but doesn't list this category yet, append the `categoryId` to its `applies_to_ebay_categories` array.

This means: **the next time you fetch any new eBay category, its aspects are immediately visible & editable on the Specifications tab for products in that category, with no manual setup.**

### Change D — Resolver respects scope
Update `resolveAllForProduct` to accept `productType` and `effectiveCategoryId`, then filter:

```ts
.eq("active", true)
.or(`applies_to_product_types.is.null,applies_to_product_types.cs.{${productType}}`)
.or(`applies_to_ebay_categories.is.null,applies_to_ebay_categories.cs.{${effectiveCategoryId}}`)
```

The existing `resolve-aspects` action already knows both values, so it just passes them through.

---

## What you'll see after this lands

- KitchenAid product → Specifications tab shows: Brand, Product Name, MPN, Product Type, EAN/UPC/ISBN, Weight, Dimensions, Age Mark, Condition, Packaging, **plus** Capacity, Power, Voltage, Cable Length, Colour, Material, Number of Blades, Number of Speeds, etc. (all editable, all writing to real DB columns). **No** Theme/Subtheme/Pieces/Minifigures/Set Number/Released.
- LEGO 75367-1 → Specifications tab shows the LEGO fields it always had (deduped — one Set Number, one Pieces, one Age Mark). **No** food-processor fields.
- eBay Mappings page for **Food Processors** → all 32 aspects are pre-mapped to the new auto-created canonical keys, scoped to category 20673; you only manually map the few that need a constant.
- eBay Mappings page for **LEGO Complete Sets** → unchanged, still shows LEGO Set Number / Theme / Pieces mapped.

## Files that will change

- `supabase/migrations/<timestamp>_canonical_attribute_scoping.sql` — adds 2 columns + dedupe + scope seeding (idempotent)
- `supabase/functions/_shared/canonical-resolver.ts` — accept `productType` + `effectiveCategoryId`, filter rows
- `supabase/functions/ebay-taxonomy/index.ts` — bootstrap canonical attributes + DB columns + mappings during `category-aspects` fetch; pass through scope params on `resolve-aspects`
- `src/integrations/supabase/types.ts` — auto-regenerated for the new columns

No frontend changes required — the Specifications tab and Channel Mappings panel both already render whatever the edge function returns.
