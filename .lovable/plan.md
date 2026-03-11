

## Add eBay Subscription Testing to Settings

### What it does
Adds a "Test Subscriptions" button that calls eBay's notification test endpoint for each active subscription, then reports which ones passed or failed verification.

### Changes

**1. `supabase/functions/ebay-sync/index.ts`** — New `test_subscriptions` action

- After `get_subscriptions`, add a `test_subscriptions` handler
- Fetches all subscriptions via `GET /commerce/notification/v1/subscription`
- For each ENABLED subscription, calls `POST /commerce/notification/v1/subscription/{subscriptionId}/test`
- eBay sends a test notification to the webhook endpoint; the test API returns a 200 if the destination responded correctly
- Collects results per topic: `{ topicId, subscriptionId, status: "passed" | "failed", error? }`
- Returns the array to the frontend

**2. `src/pages/admin/EbaySettingsPanel.tsx`** — UI changes

- Add `testingSubs` loading state
- Add a `testSubscriptions` async function that calls `invokeWithAuth("ebay-sync", { action: "test_subscriptions" })`
- On success, update `subscriptions` state with test results merged in (badge shows green "passed" or red "failed")
- On error, show destructive toast
- Add a "Test Subscriptions" button (with `ShieldCheck` icon) in the button row, next to "View Subscriptions"
- In the subscription badge display, show test result status when available (e.g. `ORDER_CONFIRMATION: ENABLED ✓` or `FEEDBACK_LEFT: ENABLED ✗ verification failed`)

### Files changed

| File | Change |
|------|--------|
| `supabase/functions/ebay-sync/index.ts` | Add `test_subscriptions` action (~30 lines, after `get_subscriptions` block) |
| `src/pages/admin/EbaySettingsPanel.tsx` | Add test button + result display |

