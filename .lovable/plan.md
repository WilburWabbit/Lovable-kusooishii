

## Why eBay order 05-14355-58903 is missing

### Root cause

The `ebay-notifications` edge function has **never been called by eBay**. Evidence:

1. **Zero edge function logs** for `ebay-notifications` -- no boot events, no requests
2. **Zero real notifications** in the `ebay_notification` table -- the only two rows are synthetic test payloads (`test-notif-001`, `test-notif-002`) from the subscription test utility
3. **Zero landing rows** in `landing_raw_ebay_order` -- no raw order data has ever landed
4. The most recent real eBay order (`KO-0000749`, origin_reference `15-14333-73419`) was created on March 10 via a manual sync, not via notification

### Why eBay isn't sending notifications

The "Test Subscriptions" button calls eBay's `POST /subscription/{id}/test` endpoint, which only verifies that eBay **can reach** the destination URL. It does **not** confirm that eBay will actually fire real notifications for marketplace events. The test likely passed because eBay could hit the URL and get a 200 back.

The probable reason eBay isn't delivering real notifications is one of:

1. **Destination URL uses `SUPABASE_URL`** (line 475: `` `${Deno.env.get("SUPABASE_URL")}/functions/v1/ebay-notifications` ``). The test subscription call from the edge function uses the **internal** Supabase URL, but the destination registered with eBay needs to be the **publicly reachable** URL. If `SUPABASE_URL` resolves to a non-public or differently-routed address, eBay's infrastructure may not be able to deliver to it in production despite the test passing.

2. **Missing `MARKETPLACE_ACCOUNT_DELETION` topic** -- eBay requires this subscription for marketplace compliance. Without it, eBay may silently disable notification delivery.

3. **The subscriptions were created but the eBay application hasn't completed marketplace onboarding** -- eBay sometimes requires additional steps in the Developer Portal (e.g., enabling the Notifications API scope on the application keyset).

### Diagnosis plan

Before making code changes, I recommend a quick diagnostic:

**Step 1: Verify the registered destination URL**
- Call `get_subscriptions` and check the destination endpoint URL that eBay has on file
- Compare it against the publicly accessible function URL

**Step 2: Check eBay's subscription status in detail**
- The `get_subscriptions` action should return whether subscriptions are `ENABLED` or `DISABLED`
- Check if eBay silently disabled any

**Step 3: Trigger a manual order sync to confirm the order exists on eBay**
- Use `ebay-sync` with `action: sync_orders` to pull recent orders and verify 05-14355-58903 appears

### Proposed code changes (after diagnosis)

| File | Change |
|------|--------|
| `supabase/functions/ebay-sync/index.ts` | In `setup_notifications`, add `MARKETPLACE_ACCOUNT_DELETION` to the topics array (eBay compliance requirement) |
| `supabase/functions/ebay-sync/index.ts` | In `get_subscriptions`, return the full destination URL so the admin UI can display it for verification |
| `src/pages/admin/EbaySettingsPanel.tsx` | Show the registered destination URL in the subscription status display |
| `supabase/functions/ebay-sync/index.ts` | Add a `diagnose_notifications` action that: fetches the destination, fetches all subscriptions with their statuses, and returns a structured diagnostic report |

### Immediate action

Would you like me to:
- **A)** Run the manual order sync now (via `curl_edge_functions`) to pull that order in, then implement the diagnostic improvements above
- **B)** Just implement the code changes and let you trigger the sync manually

