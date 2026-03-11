

## Fix eBay Notification Subscription Destination Binding

### Problem

The diagnostic shows:
- `ORDER_CONFIRMATION` and `ITEM_MARKED_SHIPPED` point to old destination `5e3b1bb5...` instead of current `e2104090...`
- `MARKETPLACE_ACCOUNT_DELETION` subscription is missing entirely
- The endpoint URLs match, so the destination itself is correct — but subscriptions are orphaned on a stale destination

### Root cause

In `setup_notifications` (line 546), when an existing subscription is found, the code only checks if it's `ENABLED` — it never checks whether the subscription's `destinationId` matches the current one. If a previous destination was deleted and recreated, subscriptions remain bound to the old ID.

### Fix

**`supabase/functions/ebay-sync/index.ts`** — In the Step 3 subscription loop (lines 539-575):

When an existing subscription is found (`existingSub`), add a check: if `existingSub.destinationId !== destinationId`, delete the old subscription and recreate it with the correct destination. This handles the stale binding case.

```
if (existingSub) {
  if (existingSub.destinationId !== destinationId) {
    // Wrong destination — delete and recreate
    await ebayFetch(accessToken, `${NOTIF_API}/subscription/${existingSub.subscriptionId}`, { method: "DELETE" });
    await ebayFetch(accessToken, `${NOTIF_API}/subscription`, {
      method: "POST",
      body: JSON.stringify({ topicId, status: "ENABLED", destinationId, payload: { format: "JSON", ... } }),
    });
    subResults.push({ topic: topicId, status: "rebound" });
  } else if (existingSub.status !== "ENABLED") {
    // Right destination, just enable
    ...enable...
  } else {
    // Already correct
    ...already_active...
  }
}
```

This single change fixes all three issues:
- Rebinds ORDER_CONFIRMATION to the correct destination
- Rebinds ITEM_MARKED_SHIPPED to the correct destination
- MARKETPLACE_ACCOUNT_DELETION (already in the topics array) will be created fresh since it has no existing subscription

| File | Change |
|------|--------|
| `supabase/functions/ebay-sync/index.ts` | Add destination mismatch check in subscription loop (~8 lines changed) |

After deploying, clicking **Setup Notifications** will rebind the subscriptions. Then **Test Subscriptions** should confirm all three pass.

