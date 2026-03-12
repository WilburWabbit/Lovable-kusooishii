

## Security Fix: Remove Public READ Access on `customer` Table

### Problem
The `customer` table has a permissive SELECT policy `"Customers readable by all"` on the `public` role with `USING: true`. This exposes 309 customer records (emails, phone numbers, addresses) to unauthenticated users.

### Solution
Drop the `"Customers readable by all"` policy. The existing `"Customers managed by staff"` ALL policy already grants SELECT to authenticated staff/admin users, which is the only access path used by the app (via the `admin-data` edge function).

### Migration SQL
```sql
DROP POLICY "Customers readable by all" ON public.customer;
```

### Impact
- No frontend code queries the `customer` table directly — the admin CustomersPage fetches via an authenticated edge function
- No public-facing feature depends on reading customer data
- Zero risk of breaking existing functionality

