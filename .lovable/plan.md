

## Safety net: fetch missing eBay order on shipping confirmation

### Problem

The webhook for `ITEM_MARKED_SHIPPED` arrived for order `22-14511-75136`, but the original `ORDER_CONFIRMATION` webhook was never received. Today this is silently tolerated — the polling job (`ebay-sync`) eventually catches it ~hours later. We want immediate self-healing: if a shipping/tracking notification arrives for an order we've never seen, fetch it from eBay's Fulfillment API right then and process it before applying the tracking update.

### Where the fix lives

`supabase/functions/ebay-notifications/index.ts` is the receiver. Currently it lands the raw notification and (for shipping topics) calls existing tracking-update logic that assumes the `sales_order` row exists. We add a pre-step.

### Behaviour change

When the notification topic is `ITEM_MARKED_SHIPPED` (or any tracking-bearing topic — `FIXED_PRICE_TRANSACTION`, `ITEM_SOLD`, where shipping info may also appear):

```text
1. Extract eBay orderId from payload
2. SELECT id FROM sales_order WHERE origin_channel='ebay' AND origin_reference=<orderId>
3. If row exists  → existing tracking-update path (unchanged)
4. If row missing → call ebay-process-order with { orderId, source: 'shipping-notification-recovery' }
                    wait for completion
                    re-check for sales_order row
                    if now exists → apply tracking update
                    if still missing → mark notification status='error',
                                       record error_message, do NOT 200 (let eBay retry)
```

Order recovery reuses `ebay-process-order` (which already does: fetch order from `/sell/fulfillment/v1/order/{orderId}` → land in `landing_raw_ebay_order` → create customer + sales_order + lines → trigger QBO sync). No duplication.

### Idempotency & safety

- `ebay-process-order` already checks `landing_raw_ebay_order.external_id` and `sales_order.origin_reference` before inserting — re-invocation is a no-op if the order was created concurrently by `ebay-sync`.
- Recovery path runs synchronously (await response) so the tracking update only fires after the order exists.
- If `ebay-process-order` fails (eBay 404, auth error, etc.), the notification stays `pending`/`error` in `ebay_notification` table; eBay will retry per its policy and we log the failure for the operator.
- Add a structured log line `ebay-notifications: order-recovery-triggered orderId=… reason=missing-on-shipping` so we can grep how often this fires.

### Counter / observability

Add a single counter: increment a row in `ebay_notification` (or log only — no schema change) so we can answer "how many times did the safety net save us?" by querying `ebay_notification` payloads with `recovery_triggered=true` recorded into the existing `payload` jsonb under a top-level `_recovery` key.

### Files

- `supabase/functions/ebay-notifications/index.ts` — add pre-tracking-update existence check + call to `ebay-process-order` + re-check loop; tag the stored notification payload with `_recovery: { triggered: true, succeeded: bool, orderId }`

### Explicitly NOT changed

- `ebay-process-order` — already idempotent and correct, reused as-is
- `ebay-sync` polling job — kept as the slower belt-and-braces safety net
- Signature verification — separate concern, not touched
- No new tables, no schema migration, no new admin UI
- `ORDER_CONFIRMATION` handling — unchanged (still the primary path)

### Verification after deploy

1. Find a known eBay orderId that exists in eBay but **not** in our `sales_order` table.
2. Manually POST a synthetic `ITEM_MARKED_SHIPPED` notification for it to the function (or wait for the next real occurrence).
3. Check: `sales_order` row appears, tracking fields populated, `ebay_notification.payload._recovery.triggered=true`, edge logs show `order-recovery-triggered`.

Re-run the original investigation query for `22-14511-75136`-class events going forward — expect zero "polling caught it hours later" cases.

