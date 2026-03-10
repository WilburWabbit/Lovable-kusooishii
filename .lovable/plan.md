

## QBO Customer Sync

### Overview

Sync QBO Customer records as the master source for customer data. Create a `customer` table, a sync edge function, backfill existing orders, and build an admin Customers page.

### 1. Database: `customer` table

```sql
CREATE TABLE public.customer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qbo_customer_id text NOT NULL UNIQUE,
  display_name text NOT NULL,
  email text,
  phone text,
  mobile text,
  billing_line_1 text,
  billing_line_2 text,
  billing_city text,
  billing_county text,
  billing_postcode text,
  billing_country text DEFAULT 'GB',
  notes text,
  active boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer ENABLE ROW LEVEL SECURITY;

-- Staff/admin full access
CREATE POLICY "Customers managed by staff" ON public.customer
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- Public read for storefront order lookups
CREATE POLICY "Customers readable by all" ON public.customer
  FOR SELECT TO public USING (true);
```

Add `customer_id` FK to `sales_order`:

```sql
ALTER TABLE public.sales_order ADD COLUMN customer_id uuid REFERENCES public.customer(id);
```

### 2. Edge Function: `qbo-sync-customers`

- Query all QBO Customers via `SELECT * FROM Customer MAXRESULTS 1000`
- Upsert into `customer` table matching on `qbo_customer_id`
- Extract: `DisplayName`, `PrimaryEmailAddr.Address`, `PrimaryPhone.FreeFormNumber`, `Mobile.FreeFormNumber`, `BillAddr` fields
- Mark `active` based on QBO's `Active` flag

### 3. Backfill: Link existing orders to customers

After syncing customers, the edge function performs a second pass:
- For orders with `origin_channel = 'qbo'` or `'qbo_refund'` and `customer_id IS NULL`:
  - Parse the `CustomerRef.value` from the original QBO receipt (stored in sales_order's origin_reference maps to the QBO transaction, not the customer)
  - Since we don't store the raw sales payload, re-query QBO SalesReceipts/RefundReceipts and match by `origin_reference` to get `CustomerRef.value`
  - Look up `customer` by `qbo_customer_id` and set `sales_order.customer_id`

Alternative (simpler): Match by `guest_name` against `customer.display_name`. This avoids re-querying QBO but is less precise. Given the data volume is small (< 1000 orders), re-querying QBO is fine.

### 4. Update `qbo-sync-sales` (forward fix)

When creating new `sales_order` records, resolve `CustomerRef.value` → `customer.id` and set `customer_id` on the order.

### 5. Admin Customers Page (`/admin/customers`)

Standard admin table with:
- **Columns**: Display Name, Email, Phone, Mobile, City, Postcode, Country, Active, Last Synced
- **Filters**: Search (name/email), Active status
- **Sortable, configurable columns** using the existing `useTablePreferences` infrastructure
- Add to sidebar under Operations

### 6. Update Orders Page

- Add a "Customer" column to the orders table showing `customer.display_name`
- Update `admin-data` `list-orders` action to join `customer:customer_id(display_name, email)`

### 7. QBO Settings Panel

Add a "Sync Customers" button alongside existing Sync Purchases and Sync Sales buttons.

### Files

| Action | File |
|--------|------|
| Create | `supabase/functions/qbo-sync-customers/index.ts` |
| Create | `src/pages/admin/CustomersPage.tsx` |
| Modify | `supabase/functions/qbo-sync-sales/index.ts` — set `customer_id` on new orders |
| Modify | `supabase/functions/admin-data/index.ts` — add `list-customers` action, update `list-orders` join |
| Modify | `src/pages/admin/QboSettingsPanel.tsx` — add Sync Customers button |
| Modify | `src/pages/admin/OrdersPage.tsx` — add Customer column |
| Modify | `src/components/BackOfficeSidebar.tsx` — add Customers nav item |
| Modify | `src/App.tsx` — add `/admin/customers` route |
| Modify | `supabase/config.toml` — register new edge function |
| Migration | Create `customer` table + add `customer_id` to `sales_order` |

