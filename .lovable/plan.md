

## BrickEconomy Collection Sync Integration

### Summary
Create an edge function and settings UI to pull your BrickEconomy collection (sets and minifigs) via `GET /api/v1/collection/sets?currency=GBP` and `GET /api/v1/collection/minifigs?currency=GBP`, storing the results in a new landing table for valuation data and enriching `catalog_product` with `brickeconomy_id` where MPNs match.

### API Details
- **Auth**: `x-apikey` header + `User-Agent` header (both required)
- **Rate limit**: 100 requests/day — this sync uses only 2 requests (one for sets, one for minifigs)
- **Endpoints**: `GET /api/v1/collection/sets?currency=GBP` and `GET /api/v1/collection/minifigs?currency=GBP`

### Changes

**1. Secret: `BRICKECONOMY_API_KEY`**
- Use `add_secret` tool to request the user's BrickEconomy API key before implementation

**2. Database migration — new `brickeconomy_collection` table**
```sql
CREATE TABLE public.brickeconomy_collection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type text NOT NULL,          -- 'set' or 'minifig'
  item_number text NOT NULL,        -- set_number or minifig_number
  name text,
  theme text,
  subtheme text,
  year integer,
  pieces_count integer,
  minifigs_count integer,
  condition text,
  collection_name text,
  acquired_date date,
  paid_price numeric,
  current_value numeric,
  growth numeric,
  retail_price numeric,
  released_date text,
  retired_date text,
  currency text NOT NULL DEFAULT 'GBP',
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_type, item_number, paid_price, acquired_date)
);
ALTER TABLE brickeconomy_collection ENABLE ROW LEVEL SECURITY;
-- Staff-only access
CREATE POLICY "BE collection managed by staff" ON brickeconomy_collection FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));
```

Also store portfolio-level summary snapshots:
```sql
CREATE TABLE public.brickeconomy_portfolio_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_type text NOT NULL,  -- 'sets' or 'minifigs'
  total_count integer,
  unique_count integer,
  current_value numeric,
  currency text NOT NULL DEFAULT 'GBP',
  period_data jsonb,            -- the periods array
  synced_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE brickeconomy_portfolio_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY "BE snapshots managed by staff" ON brickeconomy_portfolio_snapshot FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));
```

**3. Edge function: `supabase/functions/brickeconomy-sync/index.ts`**
- Auth pattern: same as other admin functions (verify JWT, check admin/staff role)
- Calls both collection endpoints with `currency=GBP`
- Deletes existing rows in `brickeconomy_collection` and re-inserts (full replace per sync — collection is small)
- Upserts `brickeconomy_portfolio_snapshot` with header stats and periods
- Enriches `catalog_product.brickeconomy_id` where `set_number` matches an existing `mpn`
- Returns summary counts
- Register in `config.toml` with `verify_jwt = false`

**4. UI: `src/pages/admin/BrickEconomySettingsPanel.tsx`**
- Card component following `QboSettingsPanel` pattern
- "Sync Collection" button that calls `brickeconomy-sync`
- Toast with summary (sets synced, minifigs synced, catalog matches)

**5. `src/pages/admin/SettingsPageFull.tsx`** — add `BrickEconomySettingsPanel` below QBO panel

### Data Flow
```text
BrickEconomy API /collection/sets
  → brickeconomy_collection (item_type='set')
  → brickeconomy_portfolio_snapshot (snapshot_type='sets')
  → catalog_product.brickeconomy_id enrichment

BrickEconomy API /collection/minifigs
  → brickeconomy_collection (item_type='minifig')
  → brickeconomy_portfolio_snapshot (snapshot_type='minifigs')
```

