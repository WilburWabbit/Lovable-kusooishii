

## eBay Notification Subscriptions

No, this project does not have eBay notification subscriptions built yet. The current `ebay-sync` function only handles `sync_orders`, `sync_inventory`, and `push_stock`. There is no `ebay-notifications` webhook function either.

Here is the plan to port the Kuso Hub pattern, adapted for this project's singleton connection model (no per-user connections).

---

### 1. Create `ebay-notifications` Edge Function

A new function at `supabase/functions/ebay-notifications/index.ts` that handles:

- **GET** — eBay challenge verification (SHA-256 hash of `challenge_code + verification_token + endpoint`)
- **POST** — Receives notification payloads, logs them to an `ebay_notification` table, and triggers reactive order syncs for order-related topics

Key differences from Kuso Hub:
- No per-user connection lookup — this project uses a singleton `ebay_connection` table
- The endpoint URL will be `${SUPABASE_URL}/functions/v1/ebay-notifications`
- Order sync trigger calls the existing `ebay-sync` function with `action: "sync_orders"`

Add `verify_jwt = false` to `supabase/config.toml` (eBay sends unauthenticated webhooks).

### 2. Create `ebay_notification` Table

A simple log table:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| topic | text | e.g. ORDER_CONFIRMATION |
| notification_id | text | eBay's notification ID |
| payload | jsonb | Full payload |
| read | boolean | Default false |
| received_at | timestamptz | Default now() |
| created_at | timestamptz | Default now() |

RLS: staff/admin managed. Enable realtime for live notification feed.

### 3. Add `setup_notifications` and `get_subscriptions` Actions to `ebay-sync`

Port the two action handlers from Kuso Hub into the existing `ebay-sync/index.ts`:

- **`setup_notifications`**: Creates a destination pointing to `${SUPABASE_URL}/functions/v1/ebay-notifications`, then subscribes to topics: `FEEDBACK_LEFT`, `FEEDBACK_RECEIVED`, `ITEM_MARKED_SHIPPED`, `ORDER_CONFIRMATION`
- **`get_subscriptions`**: Returns current subscription list from eBay's Notification API

### 4. Add OAuth Scope for Notifications

Update the `EBAY_SCOPES` in `ebay-auth/index.ts` to include `https://api.ebay.com/oauth/api_scope/commerce.notification.subscription`. Also update the scope list in `ebay-sync/index.ts` token refresh.

### 5. Add UI Controls to `EbaySettingsPanel`

Add two buttons when connected:
- **Setup Notifications** — calls `ebay-sync` with `action: "setup_notifications"`
- **View Subscriptions** — calls `ebay-sync` with `action: "get_subscriptions"` and displays active/inactive status

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/ebay-notifications/index.ts` | New — webhook receiver |
| `supabase/functions/ebay-sync/index.ts` | Add `setup_notifications` + `get_subscriptions` actions |
| `supabase/functions/ebay-auth/index.ts` | Add notification scope to `EBAY_SCOPES` |
| `supabase/config.toml` | Add `[functions.ebay-notifications]` with `verify_jwt = false` |
| Database migration | Create `ebay_notification` table + RLS + realtime |
| `src/pages/admin/EbaySettingsPanel.tsx` | Add notification setup/status UI |

