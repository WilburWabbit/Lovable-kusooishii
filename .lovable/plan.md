

## Problem: Duplicate Variable Declaration in `admin-data` Edge Function

The edge function logs show a clear boot failure:

```
Identifier 'admin' has already been declared at line 45
```

Looking at the code, `const admin = createClient(...)` is declared twice — on line 28 and again on line 40. This is a syntax error that prevents the function from even starting, which is why all `admin-data` requests fail with "Load failed".

The QBO sync works fine (confirmed by `{"success":true,"total":622,"created":85}`), so the 85 receipts are in the database. They just can't be read because the `admin-data` function crashes on boot.

## Fix

**File:** `supabase/functions/admin-data/index.ts`

Remove the duplicate `const admin = createClient(supabaseUrl, serviceRoleKey);` on line 40. The client created on line 28 is already sufficient and is reused throughout the function.

Single line change — delete line 40.

