# Admin Workflows — Data Flow Reference

> **Version:** 1.0
> **Date:** 13 April 2026
> **Status:** Baseline from live codebase audit
> **Audience:** Will (sole operator), AI agents, future contributors

This document maps every admin workflow in the Kusooishii platform, showing how data moves between external systems, Edge Functions, staging tables, and canonical tables. Each workflow section starts with a high-level overview, then drills into technical detail.

For the design principles and architectural rules behind these flows, see `docs/design-specification.md` and `CLAUDE.md`.

---

## Contents

1. [Architecture overview](#1-architecture-overview)
2. [Inventory and goods-in](#2-inventory-and-goods-in)
3. [Catalogue and product data](#3-catalogue-and-product-data)
4. [Pricing engine](#4-pricing-engine)
5. [Listing and channel management](#5-listing-and-channel-management)
6. [Order processing — eBay](#6-order-processing--ebay)
7. [Order processing — website (Stripe)](#7-order-processing--website-stripe)
8. [Order fulfilment and delivery](#8-order-fulfilment-and-delivery)
9. [Payout import and reconciliation](#9-payout-import-and-reconciliation)
10. [QBO financial sync](#10-qbo-financial-sync)
11. [Google Merchant Center sync](#11-google-merchant-center-sync)
12. [Email pipeline](#12-email-pipeline)
13. [Customer acquisition (welcome codes)](#13-customer-acquisition-welcome-codes)
14. [CSV bulk operations](#14-csv-bulk-operations)
15. [Content generation (AI)](#15-content-generation-ai)
16. [Retry and error handling](#16-retry-and-error-handling)
17. [Cross-cutting patterns](#17-cross-cutting-patterns)

---

## 1. Architecture overview

Every data flow in the platform follows one governing rule:

> **No external system may write directly into canonical app tables.** All inbound data lands in staging, is validated and transformed, then promoted to canonical tables under app control.

The system has three layers that data passes through:

```
┌─────────────────────────────────────────────────────────┐
│  EXPERIENCE LAYER — React/Tailwind admin UI             │
│  (triggers workflows, displays state)                   │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│  DOMAIN LAYER — Supabase Edge Functions (Deno)          │
│  (business logic, lifecycle rules, orchestration)       │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Receivers │  │Processors│  │ Senders  │              │
│  │ (land)    │→ │ (promote)│→ │ (push)   │              │
│  └──────────┘  └──────────┘  └──────────┘              │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│  DATA LAYER — PostgreSQL                                │
│                                                         │
│  landing_raw_*  →  canonical tables  →  audit_event     │
│  (staging)         (operational)        (immutable log)  │
└─────────────────────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│  EXTERNAL SYSTEMS                                       │
│  eBay · QBO · Stripe · GMC · Rebrickable · BrickEconomy │
│  BrickLink · BrickOwl · SendGrid/Resend · OpenAI        │
└─────────────────────────────────────────────────────────┘
```

### System-of-record boundaries

| Domain | Master system | What it owns |
|--------|--------------|-------------|
| Accounting, posted transactions, chart of accounts | QBO | Financial truth |
| Unit-level stock, content, media, pricing, listings, audit | App | Operational truth |
| Payment execution, refunds | Stripe | Payment state |
| Channel listings, orders, payouts, fees | eBay | Channel state |
| Catalogue data, set specs | Rebrickable | Reference data |
| Market valuations | BrickEconomy | Valuation baseline |
| Product feeds | GMC | Shopping channel |

### Landing table pattern

All `landing_raw_*` tables share this structure:

| Column | Purpose |
|--------|---------|
| `external_id` | Source system unique key (idempotency) |
| `raw_payload` | Full JSONB response as received |
| `status` | `pending` → `processing` → `committed` / `error` |
| `correlation_id` | Trace all downstream changes |
| `error_message` | Populated on failure |
| `retry_count` | Attempts so far |
| `last_retry_at` | Timestamp of last retry |
| `received_at` | When the payload arrived |
| `processed_at` | When promotion completed |

---

## 2. Inventory and goods-in

### Overview

Stock enters the system through purchase batches. The admin creates a batch, adds line items (MPN + quantity + cost), and the system generates individual stock units with apportioned landed costs.

```
Admin UI                 PostgreSQL
  │                        │
  ├─ Create batch ───────→ purchase_batches (status=draft)
  ├─ Add line items ─────→ purchase_line_items
  ├─ Record shared costs → purchase_batches.shared_costs (JSONB)
  ├─ Confirm receipt ────→ purchase_batches (status=recorded)
  │                        │
  │  [System generates]    ├→ stock_unit (one per unit per line)
  │                        │   uid = "PO{n}-{seq}"
  │                        │   v2_status = purchased
  │                        │   landed_cost = unit_cost + apportioned shared
  │                        │
  │                        ├→ vendor (auto-upsert via trigger)
  │                        │   sync_purchase_batch_supplier trigger
  │                        │   normalises supplier_name → vendor.id
  │                        │
  │                        └→ sku (created if not exists)
```

### Technical detail

**Tables involved:**

- `purchase_batches` — parent record; auto-incrementing ID format `PO-001`; holds `shared_costs` JSONB (freight, duty, etc.) and `total_shared_costs`; `unit_counter` increments for UID generation
- `purchase_line_items` — FK to `purchase_batches.id`; stores `mpn`, `quantity`, `unit_cost`, `apportioned_cost`, `landed_cost_per_unit`
- `stock_unit` — one row per physical item; `batch_id` and `line_item_id` FKs back to purchase; `uid` format `PO{n}-{seq}`; initial `v2_status=purchased`
- `vendor` — auto-populated via `sync_purchase_batch_supplier` trigger; normalises `supplier_name` to `normalized_name` (lowercase, trimmed)

**Cost apportionment:** Shared costs are split proportionally across line items by `unit_cost`. When a unit is later graded, its `landed_cost` can be reallocated based on expected revenue (market price from SKU or default grade ratios).

---

## 3. Catalogue and product data

### Overview

Product catalogue data flows in from multiple external sources. The admin triggers bulk imports or per-product enrichment, and data lands in staging before promoting to canonical tables.

```
Rebrickable CSV ──→ import-sets ──→ theme + lego_catalog (upsert)
                                      │
Rebrickable API ──→ rebrickable-sync → lego_catalog (upsert)
                                      │
                                      ▼
                                  landing_raw_rebrickable (staging)

BrickEconomy API ─→ brickeconomy-sync → brickeconomy_collection (cache)
                                         │
                                   [100 req/day hard limit]

Rebrickable + BrickEconomy + BrickLink
         │
         └──→ fetch-product-data ──→ product (upsert on mpn)
                                  → brickeconomy_collection (upsert)

CSV (products-export.csv) → import-product-data → product (null fields only)
```

### Technical detail — `import-sets`

- **Trigger:** Admin manual call (HTTP POST, staff auth)
- **Source:** `media/imports/sets.csv` from Supabase Storage
- **Writes to:** `theme` (upsert on `slug`, batched 200/batch), `lego_catalog` (upsert on `mpn`, batched 500/batch)
- **Dedup:** Keeps last occurrence of each MPN in the CSV

### Technical detail — `fetch-product-data`

- **Trigger:** Admin call with `mpn` parameter
- **External calls:**
  - Rebrickable API — set details by `set_number-variant`
  - BrickEconomy API — `current_value`, `retail_price` (quota enforced via `audit_event` count: 100/day)
  - BrickLink API — `avg_price` (OAuth 1.0a)
- **Reads from:** `product`, `brickeconomy_collection`, `audit_event` (quota tracking)
- **Writes to:** `product` (upsert on `mpn`), `brickeconomy_collection` (upsert on `item_number`)
- **Fallback:** Returns cached data on rate limit or 404

### Technical detail — `import-product-data`

- **Source:** `media/imports/products-export.csv` (semicolon-delimited)
- **Conservative:** Only fills `NULL` fields on existing `product` rows — never overwrites existing data
- **Fields updated (if null):** `name`, `description`, `piece_count`, `year_released`, `dimensions`, `weights`

### Technical detail — `rebrickable-sync`

- **Trigger:** Admin manual call
- **External:** Rebrickable API (paginated catalogue fetch)
- **Writes to:** `lego_catalog` (upsert on `mpn`, batched 500/batch)
- **Staging:** `landing_raw_rebrickable` (entity_type `sets` or `themes`)
- **Checkpoint:** `rebrickable_sync_state` tracks last sync position for incremental runs

---

## 4. Pricing engine

### Overview

Pricing follows a rule-driven markdown system with floor/ceiling guards. The `auto-markdown-prices` function runs daily (cron) to age stale listings through two markdown windows.

```
                    ┌─────────────────────────────┐
                    │  pricing_settings (config)   │
                    │  first_markdown_days: 30     │
                    │  first_markdown_pct: X%      │
                    │  clearance_markdown_days: 45  │
                    │  clearance_markdown_pct: Y%   │
                    │  minimum_margin_target: Z%    │
                    └──────────────┬──────────────┘
                                   │
  auto-markdown-prices ◄───────────┘ (cron daily)
         │
         ├─ Reads: stock_unit (v2_status=listed), sku, channel_listing (live)
         │
         ├─ Rule: Day 30 → first markdown
         ├─ Rule: Day 45 → clearance markdown
         ├─ Guard: Never below floor = highest_landed_cost × 1.25
         │
         ├─ Writes: sku (price, v2_markdown_applied)
         ├─ Writes: channel_listing (listed_price, fee_adjusted_price)
         │
         └─ Fire-and-forget → ebay-push-listing (update eBay price)
```

### Technical detail

- **Trigger:** Cron (daily) or admin manual call
- **Reads:** `pricing_settings` (configurable thresholds), `stock_unit` where `v2_status=listed`, `sku`, `channel_listing` where status is live
- **Floor price guard:** `highest_landed_cost × 1.25` — never sells below this
- **Writes:** `sku.price`, `sku.v2_markdown_applied`; `channel_listing.listed_price`, `channel_listing.fee_adjusted_price`
- **Side-effect:** Calls `ebay-push-listing` (fire-and-forget) for any eBay channel listings whose price changed

---

## 5. Listing and channel management

### Overview

Listings are mastered in the app and projected outward to channels. The admin prepares a listing (content, media, price), then pushes it to eBay or other channels. Inbound syncs pull current eBay state back into the app.

```
Admin UI → Prepare listing → channel_listing (draft)
                                  │
          ebay-push-listing ◄─────┘
                │
                ├─ Reads: channel_listing, sku, product, stock_unit
                ├─ Calls: eBay Inventory API (create/update item, offer, publish)
                ├─ Writes: channel_listing (external_id, external_url, v2_status=live)
                └─ Writes: stock_unit (v2_status=listed for graded units)

          ebay-sync (cron/manual) ─→ eBay Inventory API (fetch all)
                │
                └─ Writes: channel_listing (upsert from eBay state)

          gmc-sync (publish_all) ─→ Google Merchant API
                │
                ├─ Reads: sku, product, channel_listing (web), stock_unit
                └─ Writes: channel_listing (channel=google_shopping, upsert)
```

### Technical detail — `ebay-push-listing`

- **Trigger:** Admin action or automated (from `auto-markdown-prices`)
- **External calls:** eBay Inventory API (`/sell/inventory/v1`) — create/update inventory item, create/update offer, publish offer
- **Reads:** `channel_listing`, `sku`, `product`, `stock_unit`
- **Writes:** `channel_listing` (sets `external_id` to eBay offer ID, `external_url` to listing URL, `v2_status=live`, `listed_at`)
- **Writes:** `stock_unit` (`v2_status=listed` for units associated with the listing)
- **Error handling:** Handles 409 Conflict (already published); verifies stock count before push

### Technical detail — `ebay-sync`

- **Trigger:** Cron or manual admin call
- **External:** eBay Inventory API — fetches all inventory items (paginated with offset)
- **Token:** Auto-refreshes from `ebay_connection` table
- **Writes:** `channel_listing` (upsert — updates local state to match eBay)

---

## 6. Order processing — eBay

### Overview

eBay orders reach the app through two paths: push (webhook notifications) and pull (polling). Both land raw payloads in staging before creating canonical order records.

```
eBay webhook ──→ ebay-notifications
                      │
                      ├─ Signature: HMAC-SHA256 (public key, 15-min cache)
                      ├─ Idempotency: checks ebay_notification table
                      ├─ Writes: ebay_notification (staging)
                      └─ Fire-and-forget → ebay-process-order
                                               │
eBay Fulfillment API ←── ebay-poll-orders      │
  (every 15 min)              │                │
                              └────────────────┤
                                               │
                              ebay-process-order
                                    │
                    ┌───────────────┤
                    ▼               ▼
          landing_raw_ebay_order   Canonical tables:
          (external_id, payload,   ├─ sales_order
           status=retrying)        ├─ sales_order_line
                    │              ├─ stock_unit (FIFO consume)
                    │              ├─ customer (upsert)
                    │              │
                    └─ status=committed
                                   │
                    Fire-and-forget:
                    ├─→ qbo-sync-sales-receipt
                    ├─→ v2-process-order
                    └─→ generate-welcome-code
```

### Technical detail — `ebay-notifications`

- **Trigger:** eBay webhook (GET for challenge verification, POST for payload delivery)
- **Signature:** HMAC-SHA256 with public key caching (15-min TTL)
- **Writes:** `ebay_notification` (idempotency check + staging)
- **Routes to:** `ebay-process-order` (if order event), `ebay-sync` (if inventory event), `ebay-retry-order` (if processing fails — creates `landing_raw_ebay_order` row for retry)

### Technical detail — `ebay-poll-orders`

- **Trigger:** Cron (every 15 minutes) or manual admin call
- **External:** eBay Fulfillment API (`/sell/fulfillment/v1/order`) — paginated, limit 50
- **Reads:** `ebay_connection`, `sales_order` (duplicate check on `external_order_id`), `customer`, `sku`, `lego_catalog`
- **Writes:** `landing_raw_ebay_order` (land first), then `sales_order`, `sales_order_line`, `stock_unit` (FIFO consume via `v2_consume_fifo_unit` RPC), `customer` (upsert)
- **Side-effects:** Fire-and-forget calls to `qbo-sync-sales-receipt` and `v2-process-order`

### Technical detail — `ebay-process-order`

- **Trigger:** Called by `ebay-notifications` or `ebay-retry-order`
- **Flow:** Lands raw order → validates → creates `sales_order` + `sales_order_line` → FIFO stock consumption → customer upsert → marks landing row as `committed`
- **FIFO:** Consumes oldest available `stock_unit` for each SKU in the order
- **Idempotency:** Checks `external_id` on `landing_raw_ebay_order` to prevent duplicate processing
- **Side-effects:** Fire-and-forget to `qbo-sync-sales-receipt`, `v2-process-order`, `generate-welcome-code`

---

## 7. Order processing — website (Stripe)

### Overview

Website orders go through Stripe Checkout. The frontend creates a session, Stripe handles payment, then a webhook triggers order creation in the app.

```
Frontend (cart) ──→ create-checkout
                        │
                        ├─ Reads: sku (server-side price lookup), product, customer
                        ├─ Calls: Stripe API (create Checkout Session)
                        ├─ Metadata: encodes sku_items as "skuId:qty,..."
                        ├─ Club discount: 5% coupon if collection method
                        └─ Returns: session URL → redirect to Stripe

Stripe ──webhook──→ stripe-webhook
                        │
                        ├─ Signature: X-Stripe-Signature verification
                        ├─ Writes: landing_raw_stripe_event (staging)
                        └─ Fire-and-forget → process-receipt
                                                │
                              process-receipt ◄──┘
                                    │
                                    ├─ Reads: app_settings, sku, product, stock_unit, customer
                                    ├─ Decodes sku_items from session metadata
                                    ├─ FIFO: v2_consume_fifo_unit RPC
                                    ├─ Writes: sales_order, sales_order_line, stock_unit, customer
                                    │
                                    ├─→ qbo-sync-sales-receipt (fire-and-forget)
                                    └─→ v2-process-order (fire-and-forget)
```

### Technical detail — `create-checkout`

- **Trigger:** Frontend checkout request (HTTP POST)
- **Auth:** Optional — supports guest + authenticated checkout
- **Reads:** `app_settings` (Stripe test mode flag), `sku`, `product`, `customer` (if authenticated)
- **External:** Stripe API — creates Checkout Session with encoded metadata
- **Club handling:** If `shippingMethod` is collection, applies Blue Bell club coupon (5% off)
- **Writes:** `customer.stripe_customer_id` (optional, for authenticated users)

### Technical detail — `stripe-webhook`

- **Trigger:** Stripe webhook events (`payment_intent.succeeded`, `charge.refunded`, etc.)
- **Writes:** `landing_raw_stripe_event` (landing table)
- **Routes to:** `process-receipt` for successful payments

### Technical detail — `process-receipt`

- **Trigger:** Called by `stripe-webhook` or manual admin call
- **Flow:** Decodes `sku_items` from Stripe session metadata → creates `sales_order` + `sales_order_line` → FIFO stock consumption → customer upsert
- **FIFO:** Calls `v2_consume_fifo_unit` RPC for each line item
- **Side-effects:** Fire-and-forget to `qbo-sync-sales-receipt` and `v2-process-order`

---

## 8. Order fulfilment and delivery

### Overview

After an order is created, the admin ships it through the UI. A daily cron job automatically progresses shipped orders to delivered status.

```
Admin UI ──→ Mark as shipped ──→ sales_order (v2_status=shipped, shipped_at)
                                  stock_unit (v2_status=shipped, shipped_at)

auto-progress-orders (cron daily)
       │
       ├─ Reads: sales_order (status=shipped, shipped_at > 7 days ago)
       ├─ Writes: sales_order (v2_status=delivered, delivered_at)
       └─ Writes: stock_unit (v2_status=delivered, delivered_at)
```

### Technical detail — `auto-progress-orders`

- **Trigger:** Cron (daily) or manual admin call
- **Rule:** Orders with `status=shipped` where `shipped_at` is more than 7 days ago are auto-progressed to `delivered`
- **Writes:** Both `sales_order` and associated `stock_unit` rows are updated with `delivered` status and timestamp

---

## 9. Payout import and reconciliation

### Overview

Payouts (money received from channels) are imported from eBay's Finances API, broken down into per-order fee attributions, and reconciled against orders. This closes the financial loop.

```
Admin trigger ──→ ebay-import-payouts
                       │
                       ├─ Calls: eBay Finances API (/sell/finances/v1)
                       ├─ Writes: landing_raw_ebay_payout (staging)
                       ├─ Writes: payouts (payout record)
                       ├─ Writes: ebay_payout_transactions (per-txn detail)
                       ├─ Writes: payout_orders (order ↔ payout link)
                       ├─ Writes: payout_fee + payout_fee_line (fee attribution)
                       │
                       └─ Fire-and-forget → v2-reconcile-payout
                                                  │
                       v2-reconcile-payout ◄──────┘
                              │
                              ├─ Matches payout → orders
                              ├─ Writes: payout_orders (order_fees, order_net)
                              ├─ Writes: stock_unit (v2_status=payout_received, payout_id)
                              ├─ Writes: payouts (order_count, unit_count, reconciliation_status)
                              │
                              └─ Fire-and-forget → qbo-sync-payout
                                                        │
                              qbo-sync-payout ◄─────────┘
                                    │
                                    ├─ Creates: QBO Deposit (from payout)
                                    ├─ Creates: QBO Journal Entry (for fees)
                                    └─ Writes: payouts (qbo_deposit_id, qbo_sync_status=synced)
```

### Technical detail — `ebay-import-payouts`

- **Trigger:** Admin manual call (HTTP POST)
- **External:** eBay Finances API (`/sell/finances/v1`) — fetches payouts and their transactions
- **Landing:** `landing_raw_ebay_payout` (external_id=payoutId, status=pending→committed)
- **Fee attribution:** Groups raw eBay fees by category (`selling_fee`, `advertising`, `shipping_label`, `payment_processing`, `other`) into `payout_fee` + `payout_fee_line`
- **Order matching:** Matches transactions to `sales_order` via `external_order_id`

### Technical detail — `v2-reconcile-payout`

- **Trigger:** Called by `ebay-import-payouts`, Stripe webhook, or manual
- **Flow:** Matches payout to orders → populates `payout_orders` fee totals → transitions `stock_unit.v2_status` to `payout_received` → updates payout counts
- **Late-matching:** Links `payout_fee` rows to orders that arrived after payout import (handles timing gaps)
- **Writes:** `payout_orders`, `stock_unit` (payout_id, status), `payouts` (reconciliation_status)

### Technical detail — `qbo-sync-payout`

- **Trigger:** Fire-and-forget from `v2-reconcile-payout`
- **External:** QBO API — creates Deposit (for payout amount) and Journal Entry (for fee expenses)
- **Writes:** `payouts.qbo_deposit_id`, `payouts.qbo_sync_status`

### Fee attribution tables

| Table | Purpose |
|-------|---------|
| `payout_fee` | One row per order per fee category (selling_fee, shipping_label, etc.). FK to `payouts`, `sales_order`, `vendor` |
| `payout_fee_line` | Raw eBay fee lines — audit trail preserving original granularity. FK to `payout_fee` |

### Profit analysis

The `unit_profit_view` joins stock_unit landed costs with sales_order_line revenue and payout_fee channel fees to compute per-unit profit:

- `gross_revenue` — sale price
- `landed_cost` — purchase cost + apportioned fees
- `selling_fee`, `shipping_fee`, `processing_fee`, `advertising_fee` — from payout_fee
- `net_profit` = gross_revenue − landed_cost − total_fees
- `net_margin_pct`, `gross_margin_pct`, `fee_pct`

---

## 10. QBO financial sync

### Overview

QBO is the financial master. Data flows in both directions: inbound (QBO → app) via webhooks and manual syncs, and outbound (app → QBO) when orders or payouts are created. All inbound data lands in `landing_raw_qbo_*` tables before a central processor promotes it.

```
                          INBOUND (QBO → App)
                          ═══════════════════

QBO webhook ──→ qbo-webhook
                    │
                    ├─ Signature: HMAC-SHA256 (QBO_WEBHOOK_VERIFIER)
                    ├─ ACK: Returns 200 immediately
                    ├─ Background: EdgeRuntime.waitUntil(...)
                    │     ├─ Fetches full entity from QBO API
                    │     └─ Lands in landing_raw_qbo_* tables
                    │
                    ▼
         ┌──────────────────────────────────┐
         │  Landing tables (all status=pending) │
         │  landing_raw_qbo_purchase        │
         │  landing_raw_qbo_sales_receipt   │
         │  landing_raw_qbo_refund_receipt  │
         │  landing_raw_qbo_customer        │
         │  landing_raw_qbo_item            │
         │  landing_raw_qbo_vendor          │
         └───────────────┬──────────────────┘
                         │
         qbo-process-pending (cron)
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    supplier         stock_receipt    customer
    (from vendor)    stock_receipt_   (upsert)
                     line
                     (from purchase)
                                     sales_order
                                     (link refunds)

                                     sku
                                     (link qbo_item_id)


                    Manual sync functions:
                    ├─ qbo-sync-items → landing_raw_qbo_item
                    ├─ qbo-sync-customers → landing_raw_qbo_customer
                    ├─ qbo-sync-purchases → landing_raw_qbo_purchase + landing_raw_qbo_item
                    ├─ qbo-sync-sales → landing_raw_qbo_sales_receipt + landing_raw_qbo_refund_receipt
                    ├─ qbo-sync-tax-rates → landing_raw_qbo_tax_entity → vat_rate + tax_code
                    └─ qbo-sync-vendors → landing_raw_qbo_vendor


                          OUTBOUND (App → QBO)
                          ════════════════════

Order created ──→ qbo-sync-sales-receipt
                       │
                       ├─ Creates QBO SalesReceipt
                       ├─ VAT handling: strips inclusive VAT for QBO
                       ├─ Writes: sales_order (qbo_sales_receipt_id, qbo_sync_status)
                       └─ Writes: landing_raw_qbo_sales_receipt (status=committed)

Refund ──→ qbo-sync-refund-receipt
                │
                ├─ Creates QBO RefundReceipt
                └─ Writes: sales_order (qbo_refund_receipt_id)

New customer ──→ qbo-upsert-customer
                      │
                      ├─ Creates/updates QBO Customer
                      ├─ Writes: customer (qbo_customer_id)
                      └─ Writes: landing_raw_qbo_customer (status=committed)

New SKU ──→ qbo-sync-item
                 │
                 ├─ Creates/updates QBO Item
                 ├─ Writes: sku (qbo_item_id)
                 └─ Writes: landing_raw_qbo_item (status=committed)

Payout ──→ qbo-sync-payout
                │
                ├─ Creates QBO Deposit + Journal Entry (fees)
                └─ Writes: payouts (qbo_deposit_id, qbo_sync_status)
```

### Technical detail — `qbo-webhook`

- **Trigger:** QBO webhook POST
- **Signature:** HMAC-SHA256 with `QBO_WEBHOOK_VERIFIER`
- **Critical pattern:** Returns 200 immediately, processes in background via `EdgeRuntime.waitUntil`
- **Background work:** Fetches full entity from QBO API (webhooks only contain entity type + ID), lands raw payload in appropriate `landing_raw_qbo_*` table

### Technical detail — `qbo-process-pending`

- **Trigger:** Cron (periodic) or manual admin call
- **Size:** ~1,243 lines — the central ETL processor
- **Flow:** Iterates all `landing_raw_qbo_*` tables where `status=pending`, marks as `processing`, transforms to canonical records, marks as `committed`
- **Dependency order:** Items → SKUs → Stock → Orders (parents before children)
- **Error handling:** Per-row try/catch; failures marked as `error` with `error_message`; creates `admin_alert` for persistent failures
- **Audit:** Writes `audit_event` for each row transformation

### Technical detail — `qbo-sync-sales-receipt`

- **Trigger:** Fire-and-forget from `ebay-poll-orders`, `process-receipt`
- **External:** QBO SalesReceipt API
- **VAT:** Strips inclusive VAT from unit prices using `adjustLineVATRounding` (UK VAT is inclusive; QBO expects exclusive)
- **Payment method:** Maps `sales_order.origin_channel` to QBO payment method
- **Tracking:** `sales_order.qbo_sync_status` = `pending` → `synced` / `error`; `qbo_retry_count`, `qbo_last_error`, `qbo_last_attempt_at`

### Technical detail — manual sync functions

| Function | What it fetches | Landing table | Notes |
|----------|----------------|---------------|-------|
| `qbo-sync-items` | All Inventory + NonInventory items | `landing_raw_qbo_item` | Also deactivates stale SKUs (`active_flag=false`) |
| `qbo-sync-customers` | All customers | `landing_raw_qbo_customer` | Land only — no customer writes |
| `qbo-sync-purchases` | Purchases for a month | `landing_raw_qbo_purchase` + `landing_raw_qbo_item` | Pre-fetches referenced items in batches of 5, 250ms delay |
| `qbo-sync-sales` | SalesReceipts + RefundReceipts for a month | `landing_raw_qbo_sales_receipt` + `landing_raw_qbo_refund_receipt` | Resets status to pending if record changed |
| `qbo-sync-tax-rates` | TaxRate + TaxCode entities | `landing_raw_qbo_tax_entity` | Promotes directly to `vat_rate` and `tax_code` (exception to processor pattern) |
| `qbo-sync-vendors` | All vendors | `landing_raw_qbo_vendor` | Land only |

---

## 11. Google Merchant Center sync

### Overview

Products are published to Google Shopping via the Merchant API. The admin authenticates via OAuth, then publishes eligible SKUs.

```
Admin UI ──→ gmc-auth (OAuth2 flow)
                  │
                  └─→ google_merchant_connection (singleton)

Admin UI ──→ gmc-sync (action=publish_all)
                  │
                  ├─ Reads: sku, product, channel_listing (web), stock_unit
                  ├─ Queues: outbound_command (target_system=google_shopping)
                  └─ Writes: channel_listing (channel=google_shopping, upsert)

listing-command-process ──→ Google Merchant API (/products/v1)
                  │
                  ├─ Reads: outbound_command, channel_listing, sku, product, stock_unit
                  └─ Writes: channel_listing, outbound_command, reconciliation_case

Admin UI ──→ gmc-sync (action=sync_status)
                  │
                  ├─ Calls: Google Merchant API (get product status)
                  └─ Writes: channel_listing (offer_status: published|suppressed|pending)
```

### Technical detail

- **Auth:** `gmc-auth` handles OAuth2 flow; stores credentials in `google_merchant_connection` (singleton)
- **Actions:**
  - `publish_all` — publishes all eligible SKUs (with active web listings and stock) to GMC
  - `unpublish` — removes a product from GMC
  - `sync_status` — fetches status from GMC, maps `APPROVED` → `published`, `DISAPPROVED` → `suppressed`, `PENDING` → `pending`
- **Writes:** `channel_listing` with `channel=google_shopping`, `external_sku`, `offer_status`, `synced_at`

---

## 12. Email pipeline

### Overview

Transactional emails flow through a queue-based pipeline with priority routing, suppression checking, and dead-letter handling.

```
Trigger (order, signup, contact form, etc.)
       │
       ├─→ auth-email-hook (Supabase Auth events)
       │        │
       │        └─→ pgmq: auth_emails queue (high priority)
       │
       └─→ send-transactional-email (called by Edge Functions)
                │
                └─→ pgmq: transactional_emails queue (normal priority)

process-email-queue (cron, every 5 min)
       │
       ├─ Reads: pgmq queues (auth_emails first, then transactional_emails)
       ├─ Checks: email_send_log (dedup) + email_send_state (rate limit)
       ├─ Sends: via SendGrid/Resend
       ├─ Writes: email_send_log (status: sent/failed)
       │
       ├─ On failure → retry with backoff
       └─ On max retries → dead-letter queue (auth_emails_dlq / transactional_emails_dlq)

                 Suppression management:
                 ├─ handle-email-suppression (webhook) → suppressed_emails
                 └─ handle-email-unsubscribe (link click) → email_unsubscribe_tokens
                                                          → suppressed_emails
```

### Technical detail

**Queue infrastructure:** Uses `pgmq` (PostgreSQL Message Queue extension) with four queues:

| Queue | Priority | Purpose |
|-------|----------|---------|
| `auth_emails` | High | Password resets, email confirmations |
| `transactional_emails` | Normal | Order confirmations, shipping notifications, welcome emails |
| `auth_emails_dlq` | Dead letter | Failed auth emails after max retries |
| `transactional_emails_dlq` | Dead letter | Failed transactional emails after max retries |

**Rate control:** `email_send_state` (singleton row) manages `retry_after_until` (cooldown), `batch_size`, `send_delay_ms`, and TTL settings per queue type.

**Suppression:** `suppressed_emails` table (append-only, unique on email) is populated by the `handle-email-suppression` and `handle-email-unsubscribe` functions. Suppression checks are handled at the send layer (SendGrid/Resend) rather than inline in `process-email-queue`.

**Templates:** `send-transactional-email` supports templates including `order-confirmation`, `shipment-notification`, `contact-form`, `welcome-email`.

**Audit:** Every send attempt is logged in `email_send_log` with template name, recipient, status, and metadata. Unique index on `(message_id) WHERE status = 'sent'` prevents duplicate sends.

---

## 13. Customer acquisition (welcome codes)

### Overview

When an eBay buyer completes their first order, the system generates a unique welcome code with a Stripe promotion (5% discount) to drive them to the website.

```
ebay-process-order (first order for customer)
       │
       └─→ generate-welcome-code (fire-and-forget)
                │
                ├─ Generates: 4-char code (KSO-XXXX)
                ├─ Calls: Stripe API (create promotion_code, 5% off)
                ├─ Writes: welcome_code table
                │    ├─ code, ebay_order_id, sales_order_id, customer_id
                │    ├─ buyer_name, buyer_email, order_items, primary_sku
                │    ├─ stripe_coupon_id, stripe_promo_code_id, promo_code
                │    └─ discount_pct
                └─ Writes: audit_event

Buyer visits /welcome/:code
       │
       └─→ resolve-welcome-code (public, anonymous)
                │
                ├─ Reads: welcome_code (by code)
                ├─ Writes: welcome_code (scan_count++, scanned_at)
                ├─ Returns: buyer_name, order_items, promo_code, discount
                └─ Rate limit: 3 per IP per 10 min
```

### Technical detail

**Code logic:**
- First order for customer → generate new code
- Repeat order, unredeemed code exists → return existing code (for re-send)
- Repeat order, code already redeemed → skip (already converted)

**Collision handling:** If generated code already exists, retries up to 5 times.

**Lifecycle:** `welcome_code.redeemed_at` is set when the promo code is used on a website order. `welcome_code.user_id` links to `auth.users` when the buyer creates an account.

---

## 14. CSV bulk operations

### Overview

The CSV sync system provides staged bulk updates with preview, audit trail, and rollback capability.

```
Admin uploads CSV
       │
       └─→ csv-sync (Edge Function)
              │
              ├─ Stage 1: csv_sync_session (parent record)
              ├─ Stage 2: csv_sync_staging (raw rows, validated)
              ├─ Stage 3: csv_sync_changeset (computed diff: insert/update/delete)
              │
              ├─ Admin previews changeset
              │
              ├─ Stage 4: Apply atomically → target tables
              │            csv_sync_audit (before/after snapshots)
              │
              └─ Rollback: Reverts most recent applied sync using audit log
```

### Technical detail

| Table | Purpose |
|-------|---------|
| `csv_sync_session` | Parent operation record — `status` cycles through `staged` → `previewed` → `applied` / `rolled_back` / `error` |
| `csv_sync_staging` | Raw uploaded rows with per-row `status` (pending/valid/error) and `error_message` |
| `csv_sync_changeset` | Computed diff — `action` (insert/update/delete), `before_data`, `after_data`, `changed_fields`, `warnings` |
| `csv_sync_audit` | Applied changes log — `before_data`, `after_data`, `performed_by`, `performed_at` |

**Rollback:** Only permitted for the most recent applied sync (prevents cascading inversions). Uses `csv_sync_audit` to restore previous state.

---

## 15. Content generation (AI)

### Overview

Three Edge Functions use OpenAI to generate product content on demand.

```
Admin UI ──→ generate-product-copy (product_id)
                  │
                  ├─ Reads: product
                  ├─ Calls: OpenAI GPT-4
                  ├─ Writes: product (seo_title, seo_description, product_hook)
                  └─ Fallback: basic copy if API fails

Admin UI ──→ generate-alt-text (product_id, image_url)
                  │
                  ├─ Calls: OpenAI Vision model
                  └─ Writes: product (alt_text)

Admin UI ──→ generate-condition-notes (sku_id)
                  │
                  ├─ Reads: sku, product
                  ├─ Calls: OpenAI GPT-4
                  └─ Writes: sku (condition_notes)
```

---

## 16. Retry and error handling

### Overview

Two dedicated retry functions handle failed landing rows with exponential backoff.

```
ebay-retry-order (cron, every 5 min)
       │
       ├─ Reads: landing_raw_ebay_order (status=pending/error/retrying, after receive grace)
       ├─ Backoff: 0, 2, 10, 30, 60 minutes
       ├─ Max attempts: 5
       ├─ Retries → ebay-process-order
       ├─ On exhaust → admin_alert + audit_event
       ├─ Alerts on rows older than 30 min still not committed/skipped
       └─ Writes: landing table (status, retry_count, last_retry_at, error_message)

qbo-retry-sync (cron)
       │
       ├─ Reads: landing_raw_qbo_* (status=error)
       ├─ Backoff: 0, 2, 10, 30, 60 minutes
       ├─ Max attempts: 5
       ├─ On exhaust → admin_alert
       └─ Writes: landing table (status, retry_count, last_retry_at, error_message)
```

### Admin alerts

When retries are exhausted, both functions create an `admin_alert` row:

| Column | Purpose |
|--------|---------|
| `severity` | Error level |
| `category` | Integration area |
| `title` | Human-readable summary |
| `detail` | Error message and context |
| `entity_type` / `entity_id` | What failed |
| `acknowledged` | Admin dismissal flag |

---

## 17. Cross-cutting patterns

### Fire-and-forget pattern

Many Edge Functions trigger downstream processing without waiting for a response:

```typescript
fetch(`${supabaseUrl}/functions/v1/target-function`, {
  method: "POST",
  headers: { Authorization: `Bearer ${serviceRoleKey}` },
  body: JSON.stringify({ ... })
}).catch(() => {}); // Non-blocking
```

This is used for: QBO sync after order creation, welcome code generation, payout reconciliation, listing price updates.

### V2 stock unit lifecycle

```
purchased → graded → listed → sold → shipped → delivered → payout_received → complete
                                                   │
                                          return_pending → refunded / restocked
```

Each transition is timestamped (`graded_at`, `listed_at`, `sold_at`, `shipped_at`, `delivered_at`, `completed_at`).

### V2 order lifecycle

```
needs_allocation → new → awaiting_shipment → shipped → delivered → complete
                                                          │
                                                    return_pending
```

### Audit trail

The `audit_event` table records every material state change:

| Column | Purpose |
|--------|---------|
| `entity_type` / `entity_id` | What changed |
| `trigger_type` | insert, update, delete |
| `actor_type` / `actor_id` | system or user |
| `before_json` / `after_json` | Full record snapshots |
| `correlation_id` / `causation_id` | Event chain tracing |
| `occurred_at` | Immutable timestamp |

### OAuth connection tables

| Table | System | Pattern |
|-------|--------|---------|
| `ebay_connection` | eBay | Singleton; access_token, refresh_token, token_expires_at |
| `qbo_connection` | QuickBooks Online | Singleton; realm_id, access_token, refresh_token |
| `google_merchant_connection` | Google Merchant Center | Singleton; merchant_id, access_token, refresh_token |

All three are managed by their respective `-auth` Edge Functions and auto-refreshed before API calls.

---

## Appendix A: Complete Edge Function inventory

| Function | Trigger | Direction | External system |
|----------|---------|-----------|----------------|
| `ebay-auth` | Admin UI | Outbound | eBay OAuth |
| `ebay-sync` | Cron/manual | Inbound | eBay Inventory API |
| `ebay-notifications` | Webhook | Inbound | eBay Notifications |
| `ebay-process-order` | Internal call | Inbound | — |
| `ebay-retry-order` | Cron (5 min) | Internal | — |
| `ebay-poll-orders` | Cron (15 min) | Inbound | eBay Fulfillment API |
| `ebay-push-listing` | Admin/automated | Outbound | eBay Inventory API |
| `ebay-import-payouts` | Admin | Inbound | eBay Finances API |
| `qbo-auth` | Admin UI | Outbound | Intuit OAuth |
| `qbo-webhook` | Webhook | Inbound | QBO Webhooks |
| `qbo-sync-items` | Admin | Inbound | QBO Query API |
| `qbo-sync-item` | Internal call | Outbound | QBO Item API |
| `qbo-sync-customers` | Admin | Inbound | QBO Query API |
| `qbo-sync-purchases` | Admin | Inbound | QBO Query API |
| `qbo-sync-sales` | Admin | Inbound | QBO Query API |
| `qbo-sync-sales-receipt` | Internal call | Outbound | QBO SalesReceipt API |
| `qbo-sync-refund-receipt` | Internal call | Outbound | QBO RefundReceipt API |
| `qbo-sync-tax-rates` | Admin | Inbound | QBO Query API |
| `qbo-upsert-customer` | Internal/webhook | Outbound | QBO Customer API |
| `qbo-process-pending` | Cron | Internal | — |
| `qbo-retry-sync` | Cron | Internal | — |
| `qbo-sync-payout` | Internal call | Outbound | QBO Deposit/JE API |
| `qbo-sync-vendors` | Admin | Inbound | QBO Query API |
| `gmc-auth` | Admin UI | Outbound | Google OAuth |
| `gmc-sync` | Admin | Outbound | Google Merchant API |
| `create-checkout` | Frontend | Outbound | Stripe Checkout API |
| `stripe-webhook` | Webhook | Inbound | Stripe |
| `process-receipt` | Internal call | Internal | — |
| `stripe-sync-customers` | Admin | Outbound | Stripe Customer API |
| `stripe-sync-products` | Admin | Outbound | Stripe Product API |
| `import-sets` | Admin | Inbound | Supabase Storage |
| `import-product-data` | Admin | Inbound | Supabase Storage |
| `fetch-product-data` | Admin | Inbound | Rebrickable/BrickEconomy/BrickLink |
| `brickeconomy-sync` | Admin | Inbound | BrickEconomy API |
| `rebrickable-sync` | Admin | Inbound | Rebrickable API |
| `generate-product-copy` | Admin | Outbound | OpenAI API |
| `generate-alt-text` | Admin | Outbound | OpenAI API |
| `generate-condition-notes` | Admin | Outbound | OpenAI API |
| `send-transactional-email` | Internal call | Outbound | pgmq queue |
| `process-email-queue` | Cron (5 min) | Outbound | SendGrid/Resend |
| `preview-transactional-email` | Admin | Internal | — |
| `handle-email-suppression` | Webhook | Inbound | SendGrid/Resend |
| `handle-email-unsubscribe` | Link click | Inbound | — |
| `auth-email-hook` | Auth trigger | Internal | pgmq queue |
| `auto-markdown-prices` | Cron (daily) | Internal | — |
| `auto-progress-orders` | Cron (daily) | Internal | — |
| `csv-sync` | Admin | Internal | — |
| `v2-process-order` | Internal call | Internal | — |
| `v2-reconcile-payout` | Internal call | Internal | — |
| `admin-data` | Admin UI | Internal | — (read-only aggregation) |
| `sync-media-from-hub` | Admin | Inbound | Media hub / Storage |
| `generate-welcome-code` | Internal call | Outbound | Stripe Promotions API |
| `resolve-welcome-code` | Public | Internal | — |
| `submit-contact-form` | Public | Internal | — (triggers email) |

## Appendix B: Landing table inventory

| Landing table | Source system | Processor |
|--------------|-------------|-----------|
| `landing_raw_ebay_order` | eBay | `ebay-process-order` |
| `landing_raw_ebay_payout` | eBay | `ebay-import-payouts` (inline) |
| `landing_raw_stripe_event` | Stripe | `process-receipt` |
| `landing_raw_qbo_purchase` | QBO | `qbo-process-pending` |
| `landing_raw_qbo_sales_receipt` | QBO | `qbo-process-pending` |
| `landing_raw_qbo_refund_receipt` | QBO | `qbo-process-pending` |
| `landing_raw_qbo_customer` | QBO | `qbo-process-pending` |
| `landing_raw_qbo_item` | QBO | `qbo-process-pending` |
| `landing_raw_qbo_vendor` | QBO | `qbo-process-pending` |
| `landing_raw_qbo_tax_entity` | QBO | `qbo-sync-tax-rates` (inline) |
| `landing_raw_rebrickable` | Rebrickable | `rebrickable-sync` (inline) |
