

## ITEM_MARKED_SHIPPED Processing Pipeline

When eBay sends an `ITEM_MARKED_SHIPPED` notification, the system will fetch the order's fulfillment details from eBay, update the matching QBO SalesReceipt with shipping metadata, and update the local `sales_order` record.

---

### 1. Database Migration

Add three columns to `sales_order`:

| Column | Type | Default |
|--------|------|---------|
| `shipped_via` | text | null |
| `shipped_date` | date | null |
| `tracking_number` | text | null |

### 2. Update `ebay-notifications/index.ts`

Add `ITEM_MARKED_SHIPPED` to a new `SHIPMENT_TOPICS` list that routes to `ebay-process-order` with `{ action: "process_shipment", order_id }` instead of the default `{ order_id }` used for order confirmation.

### 3. Add `process_shipment` Action to `ebay-process-order/index.ts`

New handler alongside the existing order creation flow:

1. **Extract order ID** from the request body
2. **Fetch order from eBay** — GET `/sell/fulfillment/v1/order/{orderId}` to get `fulfillmentHrefs`
3. **Fetch fulfillments** — GET each fulfillment href to get `shippingCarrierCode`, `trackingNumber`, and `shippedDate`
4. **Find local `sales_order`** — by `origin_channel = 'ebay'` and `origin_reference = orderId`
5. **Update local record** — set `shipped_via`, `tracking_number`, `shipped_date`, and `status = 'shipped'`
6. **Update QBO SalesReceipt** — sparse update with `ShipDate`, `ShipMethodRef`, `TrackingNum` (QBO custom field), and `ShipVia` fields. Fetch the existing receipt by DocNumber first to get `Id` and `SyncToken`.
7. **Audit event** — log the shipment update

### Files Changed

| File | Change |
|------|--------|
| Database migration | Add `shipped_via`, `shipped_date`, `tracking_number` to `sales_order` |
| `supabase/functions/ebay-notifications/index.ts` | Route `ITEM_MARKED_SHIPPED` to `ebay-process-order` with `action: "process_shipment"` |
| `supabase/functions/ebay-process-order/index.ts` | Add `process_shipment` handler that fetches eBay fulfillment data, updates local order + QBO SalesReceipt |

