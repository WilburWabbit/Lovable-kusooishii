# Cross-Channel Item Specifics — Unified Specifications Tab

## Goals

1. Manage **eBay item specifics** (aspects) per product, including category selection and dynamic aspect schema fetched from eBay Taxonomy API.
2. Build the data model so **Google Merchant Center (GMC)** and **Meta Catalog** product attributes can plug into the same per-product key/value store later, with channel-specific projection on push.
3. Surface and edit everything inside the **existing `SpecificationsTab`** — no new top-level tab.
4. Auto-prefill from BrickEconomy / `lego_catalog` for LEGO items; allow free-text overrides for non-LEGO items (this works for any category, not just LEGO).

## Architecture: one canonical attribute store, projected per channel

The current Specifications tab manages **product-intrinsic facts** (set number, pieces, EAN, weight, dimensions, etc.) stored as columns on `product`. Channels (eBay aspects, GMC attributes, Meta product fields) all consume *subsets* of these facts plus channel-specific extras (e.g. eBay-only "Character Family", GMC-only `google_product_category`).

The cleanest model — and the one that scales to GMC/Meta later — is:

```
product (intrinsic facts: set_number, piece_count, ean, weight_g, …)
   │
   └─ product_attribute (id, product_id, namespace, key, value, source)
                        namespace: 'core' | 'ebay' | 'gmc' | 'meta'
                        key: 'Brand', 'Character Family', 'gtin', 'age_group', …
                        value: text (multi-value handled via JSON array or repeat rows)
                        source: 'manual' | 'brickeconomy' | 'catalog' | 'inferred'

channel_category_schema (id, channel, category_id, category_name,
                         leaf, parent_id, schema_fetched_at)

channel_category_attribute (id, schema_id, key, label, required,
                            cardinality, allowed_values jsonb,
                            allows_custom, data_type, help_text)
```

Per-product selected category lives on `product`:
- `ebay_category_id text`
- `gmc_product_category text` (Google taxonomy string, later)
- `meta_category text` (later)

This gives us:
- **One editor UI** in Specifications: render a section per channel that has a category set, driven by `channel_category_attribute` schema.
- **One push pipeline**: each channel's push function reads `product` columns + `product_attribute` rows scoped to its namespace + the cross-channel `core` namespace.
- **Easy mapping**: a small `channel_attribute_map` (or just code-level mapping module) turns `core.brand` → eBay `Brand`, GMC `brand`, Meta `brand` automatically.

## Database migration

```sql
-- Per-product attribute store (channel-aware, free-form key/value)
create table public.product_attribute (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.product(id) on delete cascade,
  namespace text not null check (namespace in ('core','ebay','gmc','meta')),
  key text not null,
  value text,                     -- single value; arrays stored as JSON text
  value_json jsonb,               -- optional structured value (multi-select)
  source text not null default 'manual'
    check (source in ('manual','brickeconomy','catalog','inferred')),
  updated_at timestamptz not null default now(),
  unique (product_id, namespace, key)
);
alter table public.product_attribute enable row level security;
create policy "Product attributes managed by staff"
  on public.product_attribute for all to authenticated
  using (has_role(auth.uid(),'admin') or has_role(auth.uid(),'staff'))
  with check (has_role(auth.uid(),'admin') or has_role(auth.uid(),'staff'));
create policy "Product attributes readable by all"
  on public.product_attribute for select to public using (true);

-- Cached category schemas per channel
create table public.channel_category_schema (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('ebay','gmc','meta')),
  marketplace text not null default 'EBAY_GB',  -- channel-specific scope
  category_id text not null,
  category_name text not null,
  parent_id text,
  leaf boolean not null default true,
  raw_payload jsonb,
  schema_fetched_at timestamptz,
  unique (channel, marketplace, category_id)
);
alter table public.channel_category_schema enable row level security;
create policy "Schemas managed by staff"
  on public.channel_category_schema for all to authenticated
  using (has_role(auth.uid(),'admin') or has_role(auth.uid(),'staff'))
  with check (has_role(auth.uid(),'admin') or has_role(auth.uid(),'staff'));
create policy "Schemas readable by all" on public.channel_category_schema
  for select to public using (true);

create table public.channel_category_attribute (
  id uuid primary key default gen_random_uuid(),
  schema_id uuid not null references public.channel_category_schema(id) on delete cascade,
  key text not null,                -- aspect/attribute name as channel calls it
  label text,
  required boolean not null default false,
  cardinality text not null default 'single' check (cardinality in ('single','multi')),
  data_type text not null default 'string',
  allowed_values jsonb,             -- null = free text; array = enum
  allows_custom boolean not null default true,
  help_text text,
  unique (schema_id, key)
);
alter table public.channel_category_attribute enable row level security;
create policy "Schema attrs managed by staff"
  on public.channel_category_attribute for all to authenticated
  using (has_role(auth.uid(),'admin') or has_role(auth.uid(),'staff'))
  with check (has_role(auth.uid(),'admin') or has_role(auth.uid(),'staff'));
create policy "Schema attrs readable by all" on public.channel_category_attribute
  for select to public using (true);

-- Product-level category selection (additive columns)
alter table public.product
  add column if not exists ebay_category_id text,
  add column if not exists ebay_marketplace text default 'EBAY_GB',
  add column if not exists gmc_product_category text,
  add column if not exists meta_category text;
```

Migration is **additive only**. Existing `product` columns stay as the source of truth for intrinsic facts.

## New edge function: `ebay-taxonomy`

Single function with three actions (matches the codebase pattern of action-routed functions):

| action | calls | purpose |
|---|---|---|
| `suggest` | `GET /commerce/taxonomy/v1/category_tree/{tree_id}/get_category_suggestions?q=…` | autocomplete on title/keywords |
| `subtree` | `GET /commerce/taxonomy/v1/category_tree/{tree_id}/get_category_subtree?category_id=…` | browse drilldown |
| `aspects` | `GET /commerce/taxonomy/v1/category_tree/{tree_id}/get_item_aspects_for_category?category_id=…` | fetch + cache aspect schema into `channel_category_schema` + `channel_category_attribute` |

Tree id is fixed per marketplace (EBAY_GB → tree id `3`). Cache aspect schemas with a 30-day TTL; serve from DB on subsequent reads (avoids eBay API rate cost). Uses existing `getEbayAccessToken()` from `_shared/ebay-auth.ts`.

A later sibling function `gmc-taxonomy` (and `meta-taxonomy`) follows the same shape — they populate the same two cache tables under different `channel` values.

## ebay-push-listing — read aspects from DB

Replace the hardcoded block:
```ts
aspects: { "Brand": ["LEGO"], "MPN": [product?.mpn ?? ""] }
categoryId: "19006"
```
with:
1. Read `product.ebay_category_id` (fail with clear error if null and no fallback).
2. Read all `product_attribute` rows where `namespace = 'ebay'` for the product.
3. Read `core` namespace rows + intrinsic columns and apply the `core → ebay` mapping (Brand, MPN, EAN, MfrPartNo, etc.).
4. Build `aspects` as `{ [key]: string[] }` (eBay always wants arrays).
5. Use `categoryId: product.ebay_category_id`.

Validation step before PUT: cross-check required aspects from `channel_category_attribute` and refuse to publish (with actionable error listing missing keys) if any required aspect is empty. This kills another class of silent eBay 25xxx errors.

## Specifications tab — structure

Restructure the existing tab into **three stacked sections** in one tab; no new top-level tab:

1. **Product Specifications** (existing) — intrinsic facts on `product`. Unchanged save logic. These are the "facts" all channels draw from.
2. **eBay Listing Details** (new) — category picker + dynamic aspects form.
3. **Google Merchant attributes** (placeholder section, hidden until GMC schema is selected — wired to the same `product_attribute` model under namespace `gmc`).

Section 2 layout:

```
┌─ eBay Listing Details ─────────────────────────────┐
│ Marketplace: EBAY_GB  ▼                            │
│ Category:    [LEGO Building Toys (19006)]   Change │
│                                                    │
│ ── Required ─────────────────────────────────────  │
│  Brand *           [LEGO              ]            │
│  MPN *             [75367-1           ]            │
│  Type *            [Set         ▼]                 │
│                                                    │
│ ── Recommended ──────────────────────────────────  │
│  Character Family  [Star Wars   ▼] (BrickEconomy)  │
│  Theme             [Star Wars     ]                │
│  Number of Pieces  [1212          ]                │
│  Age Level         [9-11 Years ▼]                  │
│  ...                                               │
│                                                    │
│ [ Save eBay aspects ]  [ Refresh schema from eBay ]│
└────────────────────────────────────────────────────┘
```

### Components

- `EbayCategoryPicker.tsx` — modal with search + browse drilldown, calls `ebay-taxonomy` (`suggest` / `subtree`). On select, writes `product.ebay_category_id` and triggers `aspects` fetch to ensure schema is cached.
- `ChannelAspectsForm.tsx` — generic, channel-agnostic. Props: `productId`, `channel`, `categoryId`. Reads `channel_category_attribute` for the schema and `product_attribute` for current values. Renders inputs by `data_type` + `allowed_values` + `cardinality`:
  - `allowed_values` null → free text input
  - `allowed_values` array + `allows_custom` true → combobox (select or type)
  - `allowed_values` array + `allows_custom` false → strict select
  - `cardinality = 'multi'` → tag-input
  - Shows `(BrickEconomy)` / `(Catalog)` source hint and "revert" affordance, matching the existing override pattern.
- `lib/admin/aspect-prefill.ts` — pure function `prefillAspects(product, channel, schema) → Partial<Record<key,string|string[]>>`. For LEGO + eBay maps `lego_catalog.theme → Theme`, `piece_count → Number of Pieces`, `subtheme_name → Character Family` heuristic, `released_date year → Year Manufactured`, etc. Reused later for GMC.

### Hook layer

Add to `src/hooks/admin/`:
- `use-ebay-taxonomy.ts` — `useCategorySuggestions(query)`, `useCategorySubtree(parentId)`, `useEnsureCategoryAspects(categoryId)`.
- `use-product-attributes.ts` — `useProductAttributes(productId, namespace)` + `useSaveProductAttributes()` mutation that bulk-upserts `product_attribute` rows for a given namespace via `admin-data` action.

### `admin-data` actions to add

- `get-channel-schema` → `{ channel, categoryId }` returns schema + attributes
- `save-product-attributes` → `{ product_id, namespace, attributes: Record<string,string|string[]> }` bulk-upserts and removes rows with empty values
- `set-product-channel-category` → `{ product_id, channel, category_id, marketplace? }`

## Cross-channel mapping later (foundation laid now)

Once `product_attribute` exists, the GMC and Meta integrations get a clean home:

- `gmc-sync` reads `product_attribute` namespace `core` + `gmc`, projects to GMC API field names (`brand`, `gtin`, `mpn`, `google_product_category`, `age_group`, `condition`, `product_type`, etc.). Today it hardcodes `brand: 'LEGO'` and `condition` from grade — those will become `core` namespace entries with sensible LEGO defaults.
- A `meta-sync` function (future) does the same for Meta Catalog.

A small `lib/integrations/attribute-mapping.ts` table-of-truth lists which `core` keys feed which channel keys, so adding a new channel never requires re-asking the user the same fact twice.

## File changes

### Migrations
- New: `supabase/migrations/<ts>_product_attributes_and_channel_schemas.sql`

### Edge functions
- New: `supabase/functions/ebay-taxonomy/index.ts`
- Edit: `supabase/functions/ebay-push-listing/index.ts` — read category + aspects from DB, validate required aspects
- Edit: `supabase/functions/admin-data/index.ts` — new actions listed above
- Edit later (not in this change): `supabase/functions/gmc-sync/index.ts` — switch to attribute-driven projection

### Frontend
- Edit: `src/components/admin-v2/SpecificationsTab.tsx` — add eBay Listing Details section (and stub for GMC)
- New: `src/components/admin-v2/EbayCategoryPicker.tsx`
- New: `src/components/admin-v2/ChannelAspectsForm.tsx`
- New: `src/hooks/admin/use-ebay-taxonomy.ts`
- New: `src/hooks/admin/use-product-attributes.ts`
- New: `src/lib/admin/aspect-prefill.ts`
- New: `src/lib/integrations/attribute-mapping.ts`

### Types
- After migration runs, `src/integrations/supabase/types.ts` regenerates automatically; new tables become typed.

## Out of scope for this change (called out for the roadmap)

- Bulk back-fill of categories for existing products (one-off admin action, separate task once UI is proven).
- GMC and Meta UI sections (model is ready; UI and push-side wiring done in a follow-up).
- eBay Compatibility (vehicle/parts) aspects — different API, only needed if we ever sell non-LEGO automotive parts.

## Acceptance criteria

1. On a product detail page, in the existing **Specifications** tab, I can pick an eBay category via search-or-browse.
2. After picking, an aspects form appears showing all required + recommended aspects for that category, prefilled where possible from `lego_catalog` / BrickEconomy / `product` columns, with `(source)` hints.
3. I can edit, add custom values where allowed, save — values persist to `product_attribute`.
4. Hitting **List on eBay** uses my chosen category and saved aspects; required-aspect validation fires *before* the API call with a clear error if anything is missing.
5. Schema is fetched from eBay only when a category is first used or older than 30 days; subsequent loads are instant from DB cache.
6. The same `product_attribute` table and `ChannelAspectsForm` component will power GMC and Meta sections in a later change with no schema changes.