

## VAT Rates from QBO — Plan

### Summary
Create a `vat_rate` table synced from QBO's TaxRate entity, a new edge function to pull them, a read-only settings sub-page to display them, and a "Refresh from QBO" button.

### 1. Database Migration — `vat_rate` table

```sql
CREATE TABLE public.vat_rate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qbo_tax_rate_id text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  rate_percent numeric NOT NULL,
  agency_ref text,
  active boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE vat_rate ENABLE ROW LEVEL SECURITY;

CREATE POLICY "VAT rates readable by staff" ON vat_rate FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

CREATE POLICY "VAT rates managed by staff" ON vat_rate FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- Public read so storefront can use rates for display
CREATE POLICY "VAT rates public read" ON vat_rate FOR SELECT TO public
  USING (true);
```

### 2. Edge Function — `qbo-sync-tax-rates`

New function at `supabase/functions/qbo-sync-tax-rates/index.ts`:
- Reuses the same auth pattern (verify JWT, check admin role) and `ensureValidToken` logic from existing QBO functions
- Queries QBO: `SELECT * FROM TaxRate` via the QBO Query API
- Upserts into `vat_rate` keyed on `qbo_tax_rate_id`
- Returns count of synced rates
- Register in `config.toml` with `verify_jwt = false`

### 3. UI — `VatRatesSettingsPage.tsx`

New page at `src/pages/admin/VatRatesSettingsPage.tsx`:
- Uses `BackOfficeLayout` with title "VAT Rates"
- Fetches rates from `vat_rate` table via Supabase client
- Displays a read-only table: Name, Rate %, Description, Active, Last Synced
- "Refresh from QBO" button at top calling the edge function, with loading state and toast feedback

### 4. Routing & Navigation

- Add route `/admin/settings/vat-rates` in `App.tsx`
- Add nav item in `BackOfficeSidebar.tsx` settings group: "VAT Rates" with `Percent` icon
- Link from settings page or sidebar directly

### Data Flow
```text
QBO TaxRate query → qbo-sync-tax-rates edge function → vat_rate table
                                                          ↓
                              VatRatesSettingsPage (read-only table + refresh button)
```

