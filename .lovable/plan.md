

## Problem: Auth Token Not Reaching Database Queries

### Root Cause (confirmed via network logs)

The network requests from the Intake page show the `authorization` header contains the **anon key**, not the user's JWT. This means `auth.uid()` is null in RLS evaluation, so `has_role(null, 'admin')` returns false, and all 85 receipts are filtered out.

The `enabled: !!user` guard fires the query, meaning `useAuth` reports a user object — but the Supabase client's internal auth state hasn't been updated with the session token. This is a known race condition: `onAuthStateChange` sets `user` in React state, but the Supabase client may not have finished restoring the session token internally before the query fires.

### Fix: Route Admin Data Through Edge Functions

The user's principle is correct — integration data (receipts, stock units) is service-level and should not depend on the browser's session token reaching the REST API. The fix is to query this data through **edge functions using the service role key**, with caller authorization via JWT validation in the function.

#### 1. New edge function: `admin-data`

A single edge function that serves admin read queries. It:
- Validates the caller's JWT via `getClaims()`
- Checks admin/staff role via service-role query on `user_roles`
- Executes the requested query with service role client (bypasses RLS)
- Supports actions: `list-receipts`, `receipt-lines`, `list-stock-units`

```
POST /functions/v1/admin-data
{ "action": "list-receipts" }
→ returns all inbound_receipt rows ordered by created_at desc

{ "action": "receipt-lines", "receipt_id": "..." }
→ returns lines for a receipt

{ "action": "list-stock-units" }
→ returns stock_unit with sku + catalog_product joins
```

#### 2. Update IntakePage.tsx

Replace direct `supabase.from("inbound_receipt")` queries with `supabase.functions.invoke("admin-data", { body: { action: "list-receipts" } })`. Same for receipt lines.

#### 3. Update InventoryPage.tsx

Replace direct `supabase.from("stock_unit")` query with `supabase.functions.invoke("admin-data", { body: { action: "list-stock-units" } })`.

#### 4. Update config.toml

Add `[functions.admin-data]` with `verify_jwt = false`.

### Files Changed
- **Create** `supabase/functions/admin-data/index.ts`
- **Edit** `src/pages/admin/IntakePage.tsx` — swap query functions
- **Edit** `src/pages/admin/InventoryPage.tsx` — swap query functions
- **Edit** `supabase/config.toml` — add new function entry

### Why This Approach
- Decouples admin data access from browser session token reliability
- Single reusable endpoint for all admin reads
- Authorization is explicit (JWT claim check + role lookup), not implicit (RLS)
- Service-level data stays service-level — no dependency on user session state in the client

