

## End-to-End eBay Order Processing Pipeline

### Overview

When an eBay ORDER_CONFIRMATION notification arrives, the system will execute a multi-step pipeline: fetch the order from eBay, upsert the customer in QBO, create a SalesReceipt in QBO (using TaxExcluded to avoid the QBO API tax bug), record the order locally, deplete stock via FIFO, and push updated stock counts to all other channels with active listings.

### Current State

- `ebay-notifications` receives webhooks and triggers `ebay-sync` with `action: "sync_orders"` for order topics
- `ebay-sync` `sync_orders` fetches eBay orders and either enriches existing QBO-imported records or creates new local `sales_order` records, but does **not**: create QBO SalesReceipts, upsert QBO Customers, deplete stock, or push stock changes to other channels
- The Kuso Hub reference (`qbo-push-sales`) has the exact pattern needed for QBO SalesReceipt creation with TaxExcluded

### Architecture Decision

Rather than a queue-based system (like Kuso Hub's `qbo_outbound_queue`), this project processes inline since there's a single connection. The `ebay-sync` function's `sync_orders` action will be extended to handle the full pipeline in one pass for notification-triggered orders.

### Implementation Plan

#### 1. New Edge Function: `ebay-process-order/index.ts`

A dedicated function that handles the full pipeline for a single eBay order. Called by `ebay-notifications` instead of the generic `sync_orders`. This keeps the existing bulk sync clean.

**Steps executed in sequence:**

1. **Fetch order from eBay** — GET `/sell/fulfillment/v1/order/{orderId}` using the order ID from the notification payload
2. **Idempotency check** — Skip if `sales_order` with `origin_reference = orderId` already exists
3. **Upsert QBO Customer** — Find or create by buyer display name, with email + shipping address (ported from Kuso Hub's `findOrCreateCustomer`)
4. **Resolve tax info** — Look up the standard 20% VAT tax code from local `tax_code` + `vat_rate` tables
5. **Find QBO Items by SKU** — For each line item, query QBO `Item WHERE Sku = 'MPN.Grade'` to get ItemRef
6. **Create QBO SalesReceipt** — Using `GlobalTaxCalculation: "TaxExcluded"` (critical: QBO's API miscalculates tax on SalesReceipts when using TaxInclusive). Compute net from gross by dividing by (1 + rate/100), set tax as remainder. Use eBay order ID as DocNumber.
7. **Insert local `sales_order`** — With `origin_channel: "ebay"`, `origin_reference: orderId`, `doc_number: orderId`, `status: "complete"`
8. **Insert `sales_order_line` records** — Linked to matched SKUs
9. **FIFO stock depletion** — For each SKU, mark oldest `available` `stock_unit` records as `closed`
10. **Push stock to other channels** — For each affected SKU, count remaining `available` stock units, find `channel_listing` records for that SKU, and update eBay inventory quantities via the Inventory API

**Key code pattern (from Kuso Hub, adapted):**

```text
SalesReceipt body:
  GlobalTaxCalculation: "TaxExcluded"
  Line amounts: net (gross / 1.2)
  TxnTaxDetail.TotalTax: gross - net
  TaxLineDetail.TaxRateRef: resolved from local vat_rate table
```

#### 2. Update `ebay-notifications/index.ts`

Change the ORDER_CONFIRMATION handler to call `ebay-process-order` instead of `ebay-sync` with `sync_orders`. Pass the eBay order ID from the notification payload so the new function can fetch just that order.

```text
Before: POST ebay-sync { action: "sync_orders" }
After:  POST ebay-process-order { order_id: payload.resource.orderId }
        Fallback to ebay-sync if order_id not extractable
```

#### 3. Update `supabase/config.toml`

Add `[functions.ebay-process-order]` with `verify_jwt = false` (internal service-role calls only).

#### 4. No Database Changes Required

All tables already exist: `sales_order`, `sales_order_line`, `stock_unit`, `channel_listing`, `customer`, `tax_code`, `vat_rate`, `ebay_connection`, `qbo_connection`.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/ebay-process-order/index.ts` | **New** — full pipeline: fetch order → upsert QBO customer → create SalesReceipt (TaxExcluded) → insert sales_order → FIFO stock depletion → push stock to channels |
| `supabase/functions/ebay-notifications/index.ts` | Route ORDER_CONFIRMATION to `ebay-process-order` with extracted order ID |
| `supabase/config.toml` | Add `[functions.ebay-process-order]` entry |

### QBO Tax Handling Detail

eBay UK prices are VAT-inclusive. The QBO SalesReceipt API has a bug where `TaxInclusive` mode miscalculates tax on SalesReceipts created via API. The solution (proven in Kuso Hub):

1. Take the eBay gross price per line
2. Compute net: `Math.round((gross / 1.2) * 100) / 100`
3. Compute tax: `gross - net` (ensures gross is preserved exactly)
4. Send with `GlobalTaxCalculation: "TaxExcluded"`, line amounts as net, explicit `TxnTaxDetail` with computed tax total

### Stock Push Scope

After FIFO depletion, the function will push updated stock counts to eBay for all `channel_listing` records linked to affected SKUs. This reuses the existing `updateInventoryQuantity` helper from `ebay-sync`. Future channels (BrickLink, BrickOwl) would be added here when their integrations are built.

