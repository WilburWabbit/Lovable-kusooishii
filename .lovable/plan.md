

## Two Issues Found

### 1. Build Error in `admin-data/index.ts`

The `.select("id", { count: "exact", head: true })` syntax is not supported by the Supabase JS client used in edge functions (v2.47.x). The second argument to `.select()` is not accepted in the chained form after `.update()`.

**Fix (lines 1711-1734):** Replace each `.select("id", { count: "exact", head: true })` with `.select("id")`, then use `.data?.length ?? 0` for the count instead of destructuring `{ count }`.

There are 5 occurrences (purchases, sales, refunds, items, customers).

**File:** `supabase/functions/admin-data/index.ts`

### 2. eBay Webhook Endpoint Not Deployed

The `ebay-notifications` edge function returns **404 Not Found**. The code exists in the repo at `supabase/functions/ebay-notifications/index.ts` but is not deployed.

This explains why no notifications have been received since March 12 — eBay's delivery attempts fail, and after enough failures eBay disables the destination.

**Fix:** Deploy the `ebay-notifications` edge function, then re-run `setup_notifications` from the eBay settings panel to re-register and re-enable the destination with eBay.

### Files Modified

1. `supabase/functions/admin-data/index.ts` — fix `.select()` call signature (5 occurrences)
2. Deploy `ebay-notifications` edge function

