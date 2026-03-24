# CSV Sync Tool — Implementation Plan

> Full round-trip: **Export → Edit → Re-upload → Diff → Preview → Apply → Audit**

## Overview

A generic CSV sync engine that works across all 12 v2 tables. Users export current data, edit in a spreadsheet, re-upload, preview a diff of inserts/updates/deletes, then apply changes — all with full audit trail and rollback capability.

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌───────────────────┐     ┌──────────────┐
│  Export CSV  │────▸│  User edits  │────▸│  Upload & Diff    │────▸│  Preview UI  │
│  (frontend)  │     │  (offline)   │     │  (Edge Function)  │     │  (frontend)  │
└─────────────┘     └──────────────┘     └───────────────────┘     └──────┬───────┘
                                                                          │ approve
                                                                          ▼
                                         ┌───────────────────┐     ┌──────────────┐
                                         │  Canonical tables  │◂───│  Apply sync  │
                                         └───────────────────┘     │  (Edge Fn)   │
                                                                   └──────┬───────┘
                                                                          │
                                                                          ▼
                                                                   ┌──────────────┐
                                                                   │  Audit log   │
                                                                   │  + snapshot  │
                                                                   └──────────────┘
```

---

## Phase 1: Database — Staging & Audit Tables

### New tables

```sql
-- Stores each sync session (one per upload)
CREATE TABLE csv_sync_session (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | previewed | applied | rolled_back | failed
  uploaded_by   UUID REFERENCES auth.users(id),
  row_count     INTEGER NOT NULL DEFAULT 0,
  insert_count  INTEGER NOT NULL DEFAULT 0,
  update_count  INTEGER NOT NULL DEFAULT 0,
  delete_count  INTEGER NOT NULL DEFAULT 0,
  error_count   INTEGER NOT NULL DEFAULT 0,
  errors        JSONB DEFAULT '[]'::jsonb,
  options       JSONB DEFAULT '{}'::jsonb,        -- { "delete_missing": false, "dry_run": false }
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at    TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ
);

-- Stores the computed diff for preview & apply
CREATE TABLE csv_sync_diff (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES csv_sync_session(id) ON DELETE CASCADE,
  operation     TEXT NOT NULL,  -- INSERT | UPDATE | DELETE
  row_index     INTEGER NOT NULL,
  match_key     TEXT,                              -- the id or natural key used to match
  old_values    JSONB,                             -- current DB row (NULL for inserts)
  new_values    JSONB,                             -- CSV row (NULL for deletes)
  changed_fields TEXT[],                           -- list of column names that changed (updates only)
  validation_errors TEXT[],                        -- per-row errors
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | applied | skipped | failed
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_csv_sync_diff_session ON csv_sync_diff(session_id);

-- Immutable audit log — one row per applied change
CREATE TABLE csv_sync_audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES csv_sync_session(id),
  diff_id       UUID NOT NULL REFERENCES csv_sync_diff(id),
  table_name    TEXT NOT NULL,
  record_id     TEXT NOT NULL,                     -- PK of affected row
  operation     TEXT NOT NULL,
  old_values    JSONB,
  new_values    JSONB,
  applied_by    UUID REFERENCES auth.users(id),
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_csv_sync_audit_session ON csv_sync_audit(session_id);
CREATE INDEX idx_csv_sync_audit_record ON csv_sync_audit(table_name, record_id);
```

### Migration file

`supabase/migrations/YYYYMMDDHHMMSS_csv_sync_tables.sql`

---

## Phase 2: Table Registry — Column Metadata

A static config (not a DB table) that defines per-table rules for the sync engine.

### File: `src/lib/csv-sync/table-registry.ts`

```typescript
export interface TableConfig {
  tableName: string;
  displayName: string;
  primaryKey: string;                      // column name of PK
  naturalKeys?: string[];                  // alternative match columns (e.g., ["mpn"] for product)
  generatedColumns: string[];              // skip on import (carrying_value, girth_cm, id, created_at, etc.)
  requiredColumns: string[];               // must be non-empty
  foreignKeys: ForeignKeyConfig[];         // for validation & resolution
  columnOrder: string[];                   // defines CSV column order
  columnTypes: Record<string, ColumnType>; // for parsing & validation
  immutableColumns?: string[];             // cannot be changed via CSV (e.g., id, created_at)
}

export interface ForeignKeyConfig {
  column: string;          // local column name
  referencedTable: string; // target table
  referencedColumn: string; // target PK
  lookupColumn?: string;   // human-readable alternative (e.g., "sku_code" instead of sku.id)
}

export type ColumnType =
  | 'uuid' | 'text' | 'integer' | 'numeric' | 'boolean'
  | 'date' | 'timestamptz' | 'jsonb' | 'text[]';
```

Each of the 12 tables gets a config entry. Example:

```typescript
export const TABLE_CONFIGS: Record<string, TableConfig> = {
  stock_unit: {
    tableName: 'stock_unit',
    displayName: 'Stock Units',
    primaryKey: 'id',
    naturalKeys: ['uid'],
    generatedColumns: ['id', 'carrying_value', 'created_at', 'updated_at'],
    requiredColumns: ['mpn', 'condition_grade'],
    foreignKeys: [
      { column: 'sku_id', referencedTable: 'sku', referencedColumn: 'id', lookupColumn: 'sku_code' },
      { column: 'batch_id', referencedTable: 'purchase_batches', referencedColumn: 'id' },
      { column: 'order_id', referencedTable: 'sales_order', referencedColumn: 'id' },
      { column: 'payout_id', referencedTable: 'payouts', referencedColumn: 'id' },
    ],
    columnOrder: [/* all 29 columns */],
    columnTypes: { id: 'uuid', mpn: 'text', condition_grade: 'text', landed_cost: 'numeric', /* ... */ },
  },
  // ... 11 more
};
```

---

## Phase 3: Edge Functions

### 3a. `csv-sync-export` — Export table data as CSV

**File:** `supabase/functions/csv-sync-export/index.ts`

```
POST /csv-sync-export
Auth: admin/staff role required
Body: { table: string, filters?: Record<string, any>, columns?: string[] }
Returns: CSV as text/csv with Content-Disposition header
```

Logic:
1. Validate `table` against registry
2. Query table with optional filters (WHERE clauses from `filters`)
3. If `columns` provided, select only those; otherwise all non-generated columns
4. Stream rows as CSV with header row matching `columnOrder`
5. For FK columns, optionally include a `_lookup` suffix column with the human-readable value (e.g., `sku_id` + `sku_id_lookup` = sku_code)

### 3b. `csv-sync-upload` — Parse CSV, compute diff, store in staging

**File:** `supabase/functions/csv-sync-upload/index.ts`

```
POST /csv-sync-upload
Auth: admin/staff role required
Body: FormData with:
  - file: CSV file
  - table: string
  - options: JSON string { delete_missing?: boolean }
Returns: { session_id, summary: { inserts, updates, deletes, errors } }
```

Logic:
1. Parse CSV (handle quoted fields, commas in JSON values, BOM, line endings)
2. Validate headers against registry `columnOrder`
3. Strip generated columns from input
4. **Row matching strategy:**
   - If row has a non-empty `id` → match by PK (UPDATE candidate)
   - If row has no `id` but has populated `naturalKeys` → match by natural key (UPDATE candidate)
   - If no match found → INSERT
   - If `delete_missing: true` — any DB row not present in CSV → DELETE candidate
5. **FK resolution:** If a `_lookup` column is present (e.g., `sku_id_lookup`), resolve to the actual FK UUID
6. **Validation per row:**
   - Required columns present
   - Type checking (numeric, boolean, UUID format, date format)
   - FK references exist in target tables
   - Enum values valid
7. **Diff computation:** For updates, compare each field; only flag actually-changed fields
8. Write `csv_sync_session` + all `csv_sync_diff` rows
9. Return session summary

### 3c. `csv-sync-apply` — Execute the diff

**File:** `supabase/functions/csv-sync-apply/index.ts`

```
POST /csv-sync-apply
Auth: admin/staff role required
Body: { session_id: string, skip_rows?: number[] }
Returns: { applied: number, skipped: number, failed: number }
```

Logic:
1. Load session + diff rows (excluding `skip_rows` if provided)
2. Wrap in a **single transaction**:
   - Process in dependency order (purchases before stock_units, products before SKUs, etc.)
   - INSERTs: insert row, capture returned `id`
   - UPDATEs: update only `changed_fields`
   - DELETEs: soft-delete where possible (set `status` or `active` flag), hard-delete only for staging tables
3. For each applied row, write to `csv_sync_audit` with old/new values
4. Update `csv_sync_session.status = 'applied'`
5. If any row fails, **roll back entire transaction** (all-or-nothing)

### 3d. `csv-sync-rollback` — Undo a sync

**File:** `supabase/functions/csv-sync-rollback/index.ts`

```
POST /csv-sync-rollback
Auth: admin/staff role required
Body: { session_id: string }
Returns: { rolled_back: number }
```

Logic:
1. Load audit rows for session (most recent first)
2. Wrap in transaction:
   - For each INSERT audit → DELETE the inserted row
   - For each UPDATE audit → restore `old_values`
   - For each DELETE audit → re-insert from `old_values`
3. Update session `status = 'rolled_back'`

---

## Phase 4: Frontend — CSV Sync UI

### File structure

```
src/components/admin-v2/csv-sync/
  CsvSyncPage.tsx           # Main page wrapper at /admin/v2/csv-sync
  TableSelector.tsx         # Dropdown to pick target table
  ExportButton.tsx          # Triggers export with optional filters
  UploadDropzone.tsx        # Drag-and-drop CSV upload area
  DiffPreview.tsx           # Shows tabular diff with color-coded changes
  DiffRow.tsx               # Single diff row (expandable for field-level changes)
  DiffSummaryBar.tsx        # Counts: X inserts, Y updates, Z deletes, N errors
  DiffFilterBar.tsx         # Filter by operation type, toggle error-only view
  ApplyConfirmDialog.tsx    # Confirmation modal before applying
  SyncHistoryPanel.tsx      # Lists past sync sessions with status & rollback option
  RollbackConfirmDialog.tsx # Confirmation modal before rollback

src/hooks/admin/
  use-csv-sync.ts           # TanStack Query hooks for all sync operations

src/pages/admin-v2/
  CsvSyncPage.tsx           # Route page (thin wrapper)

src/lib/csv-sync/
  table-registry.ts         # Table configs (Phase 2)
  csv-parser.ts             # Client-side CSV parser for preview
  csv-generator.ts          # Client-side CSV generator for export
```

### Route

Add to router: `/admin/v2/csv-sync` → `CsvSyncPage`

### UI Flow

```
┌─────────────────────────────────────────────────────────┐
│  CSV Sync                                    [History]  │
│                                                         │
│  ┌─ Table ──────────────┐  ┌──────────────────────────┐ │
│  │ Stock Units        ▼ │  │  ⬇ Export Current Data   │ │
│  └──────────────────────┘  └──────────────────────────┘ │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │                                                  │   │
│  │         Drop CSV here or click to browse         │   │
│  │                                                  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ☐ Delete rows not in CSV (marks as deleted)            │
│                                                         │
│  ─── After upload ───────────────────────────────────── │
│                                                         │
│  Summary: 3 inserts · 12 updates · 1 delete · 0 errors  │
│                                                         │
│  [All] [Inserts] [Updates] [Deletes] [Errors]           │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │ ● INSERT  row 4   75367-1  Grade 3  £50.17       │   │
│  │ ◐ UPDATE  row 7   42151-1  price: 199→209        │   │
│  │ ◐ UPDATE  row 12  10312-1  status: graded→listed │   │
│  │ ○ DELETE  row —    21322-1  (not in CSV)          │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  [ Cancel ]                        [ Apply N changes ]  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Diff color coding

| Operation | Row color | Badge |
|---|---|---|
| INSERT | Green-50 bg | Green badge |
| UPDATE | Amber-50 bg | Amber badge |
| DELETE | Red-50 bg | Red badge |
| ERROR | Red-100 bg + red border | Red error badge |

For UPDATE rows, expand to show field-level diff:

```
  ◐ UPDATE  row 7   42151-1
    ├─ price:       199.99 → 209.99
    ├─ sale_price:  199.99 → 209.99
    └─ floor_price: 150.00 → 160.00
```

---

## Phase 5: Hooks — `use-csv-sync.ts`

```typescript
// Export current table data as CSV download
export function useExportCsv() { ... }

// Upload CSV and get diff session
export function useUploadCsv() { ... }

// Fetch diff rows for a session
export function useSyncSession(sessionId: string) { ... }
export function useSyncDiff(sessionId: string, filters?: DiffFilters) { ... }

// Apply sync changes
export function useApplySync() { ... }

// Rollback a sync
export function useRollbackSync() { ... }

// List past sync sessions
export function useSyncHistory(tableName?: string) { ... }
```

All mutations invalidate the relevant table's query cache on success.

---

## Design Decisions

### Row matching strategy

1. **Primary key (`id`)** — If the CSV row has a non-empty UUID in the `id` column, match by PK. This is the most reliable method.
2. **Natural key fallback** — If `id` is empty, try the table's `naturalKeys` (e.g., `uid` for stock_unit, `mpn` for product, `sku_code` for sku, `channel+external_sku` for channel_listing, `qbo_customer_id` for customer).
3. **No match** → treat as INSERT.
4. **Delete detection** — Only when `delete_missing: true` option is set. DB rows whose PK/natural key doesn't appear anywhere in the CSV are flagged as deletes.

### Generated/computed columns

These columns are **included in exports** (for reference) but **ignored on import**:
- `id` — auto-generated UUID (unless provided for matching)
- `created_at`, `updated_at` — managed by triggers
- `carrying_value` — computed from `landed_cost - accumulated_impairment`
- `girth_cm` — computed from dimensions
- `order_number` — auto-generated sequence

If the CSV includes them, they're used for matching only, never written.

### Foreign key references in CSV

Two approaches, both supported:

1. **Raw UUID** — The FK column contains the actual UUID (e.g., `sku_id = "a1b2c3..."`)
2. **Lookup column** — A companion `_lookup` column contains a human-friendly value (e.g., `sku_id_lookup = "75367-1.3"`). The engine resolves this to the UUID.

On **export**, both columns are included. On **import**, if `_lookup` is present and `id` column is empty, the lookup takes precedence.

### Validation — all-or-nothing

The apply step is wrapped in a single database transaction. If any row fails validation or insert/update/delete:
- The entire transaction rolls back
- Session status → `failed`
- Per-row errors populated in `csv_sync_diff.validation_errors`
- User sees exactly which rows failed and why

Users can fix the CSV and re-upload, or use `skip_rows` to exclude problem rows.

### Dependency ordering for multi-table sync

If a user uploads CSVs for related tables (e.g., purchase_batches + purchase_line_items), they must be processed in dependency order:

```
1. product           (no deps)
2. customer          (no deps)
3. sku               (→ product)
4. purchase_batches  (no deps)
5. purchase_line_items (→ purchase_batches)
6. stock_unit        (→ sku, purchase_batches, purchase_line_items)
7. channel_listing   (→ sku)
8. sales_order       (→ customer)
9. sales_order_line  (→ sales_order, sku, stock_unit)
10. payouts          (no deps)
11. payout_orders    (→ payouts, sales_order)
12. landing_raw_ebay_payout (no deps)
```

For Phase 1, the tool handles **one table per session**. Multi-table batch sync is a future enhancement.

---

## Edge Cases

| Case | Handling |
|---|---|
| Empty CSV (headers only) | If `delete_missing: true`, all rows flagged as deletes. Otherwise, no-op with warning. |
| Duplicate rows in CSV | Flag as validation error — duplicate natural key or PK within the same file. |
| CSV row matches multiple DB rows | Flag as error — natural key must be unique. |
| JSONB columns (e.g., `shared_costs`, `fee_breakdown`) | Parse as JSON string in CSV. Validate JSON syntax before diff. |
| Array columns (e.g., `condition_flags`, `changed_fields`) | Parse as JSON array string. |
| Boolean columns | Accept: `true/false`, `yes/no`, `1/0`, `t/f` (case-insensitive). |
| Numeric precision | Respect column precision (e.g., `NUMERIC(12,2)` rounds to 2 decimals). |
| Enum values | Validate against known enum values from registry. |
| Large files (>10k rows) | Stream parsing, paginated diff preview (50 rows per page). |
| Concurrent syncs on same table | Lock: only one active session per table at a time. |
| BOM in CSV | Strip UTF-8 BOM from first byte if present. |
| Excel-exported CSV quirks | Handle `\r\n` line endings, quoted fields with embedded newlines. |

---

## Implementation Order

| Phase | What | Files | Depends on |
|---|---|---|---|
| **1** | DB migration (3 tables) | `supabase/migrations/` | — |
| **2** | Table registry | `src/lib/csv-sync/table-registry.ts` | — |
| **3a** | Export Edge Function | `supabase/functions/csv-sync-export/` | Phase 2 |
| **3b** | Upload/Diff Edge Function | `supabase/functions/csv-sync-upload/` | Phase 1, 2 |
| **3c** | Apply Edge Function | `supabase/functions/csv-sync-apply/` | Phase 1, 2 |
| **3d** | Rollback Edge Function | `supabase/functions/csv-sync-rollback/` | Phase 1, 2 |
| **4** | Frontend hooks | `src/hooks/admin/use-csv-sync.ts` | Phase 3 |
| **5** | UI components + page | `src/components/admin-v2/csv-sync/`, `src/pages/admin-v2/` | Phase 4 |
| **6** | Sync history panel + rollback UI | Part of Phase 5 | Phase 3d, 5 |

---

## Security

- All Edge Functions require `admin` or `staff` role (checked via JWT)
- RLS on sync tables: only `service_role` can write; authenticated admins can read their own sessions
- CSV uploads are processed in-memory (not stored in Supabase Storage) — no persistent file artifacts
- Audit log is append-only — no UPDATE or DELETE allowed on `csv_sync_audit`
- Rollback creates new audit entries (doesn't delete existing ones)
