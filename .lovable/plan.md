

# Fix eBay Automatic Order Processing Pipeline

## Root Causes

### 1. Order ID extraction path is wrong
The eBay notification payload structure is:
```
notification.data.order.orderId  ← actual path
```
But the code checks:
```
resource.orderId     ← never matches
data.orderId         ← never matches  
orderId              ← never matches
```
This means even when notifications arrive, the order ID is never extracted, and the function falls back to a debounced bulk sync instead of processing the specific order.

### 2. Notification ID extraction is wrong
The payload has `notification.notificationId`, but the code checks `payload.notificationId` and `metadata.notificationId`. All stored notifications have `notification_id: null`, breaking idempotency.

### 3. No notifications received since March 12
Zero edge function logs for `ebay-notifications` means eBay stopped calling. The previous 412 signature failures likely caused eBay to disable delivery. The subscriptions need to be re-registered.

### 4. Signature verification may still be failing
The current verification logic was patched iteratively. If eBay is still sending and getting 412s, notifications are silently rejected.

## Fix Plan

### Step 1: Fix payload extraction paths in `ebay-notifications`

In `supabase/functions/ebay-notifications/index.ts`, update:

**Order ID extraction** (around line 275-279):
```typescript
// Current (wrong):
payload?.resource?.orderId
payload?.data?.orderId
payload?.orderId

// Fixed — add the correct nested path first:
payload?.notification?.data?.order?.orderId
payload?.resource?.orderId
payload?.data?.orderId
payload?.orderId
```

**Notification ID extraction** (around line 221-223):
```typescript
// Current (wrong):
payload?.notificationId
payload?.metadata?.notificationId

// Fixed — add the correct nested path first:
payload?.notification?.notificationId
payload?.notificationId
payload?.metadata?.notificationId
```

### Step 2: Add bypass mode for signature verification

Add a temporary diagnostic mode: if signature verification fails, log the full error details but still process the notification (log a warning). This prevents eBay from disabling delivery while we debug the exact signature algorithm. Once confirmed working, re-enable strict verification.

Alternatively, add a `try/catch` around verification that logs but does not reject, controlled by an environment variable flag.

### Step 3: Redeploy `ebay-notifications`

Deploy the updated function so eBay's next delivery attempt succeeds.

### Step 4: Re-register eBay notification subscriptions

The user must trigger "Setup Notifications" from the admin UI (Settings → eBay) to re-register the destination and subscriptions, since this requires a user JWT for the eBay connection token.

## Technical Details

| File | Change |
|---|---|
| `supabase/functions/ebay-notifications/index.ts` | Fix order ID extraction to check `notification.data.order.orderId`; fix notification ID extraction to check `notification.notificationId`; add signature verification fallback logging |
| Deploy | `ebay-notifications` |
| Manual action | User triggers "Setup Notifications" in admin UI |

## What this fixes in the pipeline

Once notifications arrive and the order ID is correctly extracted:
1. `ebay-notifications` stores the notification and calls `ebay-process-order` with the correct order ID
2. `ebay-process-order` fetches the order from eBay, creates local `sales_order` + `sales_order_line`, allocates stock, pushes to QBO, and updates channel inventory — all in one pipeline (already implemented and working)

