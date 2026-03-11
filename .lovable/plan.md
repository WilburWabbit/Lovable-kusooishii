

## Enhance eBay Subscription Testing with Configuration Verification

### What it does

Extends the `test_subscriptions` action to perform three verification steps instead of just calling eBay's test endpoint:

1. **GET destination** — verify the registered webhook URL matches the expected endpoint
2. **GET subscription** — verify all intended topics exist and are ENABLED, and that each subscription points to the correct destination
3. **POST test** — call eBay's test endpoint per subscription (existing behavior)

Results are returned as a unified report so the UI can show configuration issues alongside delivery test results.

### Changes

**1. `supabase/functions/ebay-sync/index.ts`** — Enhance `test_subscriptions` action (lines 833–878)

Before running the per-subscription test loop, add:

- **Destination check**: `GET /commerce/notification/v1/destination` → compare each destination's `deliveryConfig.endpoint` against expected `SUPABASE_URL + /functions/v1/ebay-notifications`. Flag mismatches or missing destinations.
- **Subscription check**: Verify all required topics (`ORDER_CONFIRMATION`, `ITEM_MARKED_SHIPPED`, `MARKETPLACE_ACCOUNT_DELETION`) are present and `ENABLED`. Check each subscription's `destinationId` matches the active destination. Flag missing topics or wrong destination bindings.
- Return a `configIssues` array alongside `results`, plus `destination` info (registered URL, status).

**2. `src/pages/admin/EbaySettingsPanel.tsx`** — Display config issues from test results

- After calling `test_subscriptions`, check for `configIssues` in the response
- Display config issues as destructive badges/messages above the per-subscription test results
- Show the registered destination URL when returned from the test

### Files changed

| File | Change |
|------|--------|
| `supabase/functions/ebay-sync/index.ts` | Add destination + subscription verification to `test_subscriptions` (~25 lines) |
| `src/pages/admin/EbaySettingsPanel.tsx` | Display `configIssues` and destination info from test results |

