# Kuso Hub Admin Redesign — Full Specification

**Version:** 1.0
**Date:** 22 March 2026
**Status:** Approved by owner — ready for implementation

---

## 1. Design Philosophy

The admin UI is organised around **the stock unit as the atomic lifecycle entity**. Every physical item that enters the business is tracked as an individual unit from purchase through to payout. Products (MPN + Grade variants) are aggregation layers that group stock units for listing and pricing purposes, but workflow state lives on the unit.

The sidebar has four pipeline views — Purchases, Products, Orders, Payouts — plus system pages for QBO Sync, Analytics, and Settings. Navigation follows the natural business workflow: stock flows left-to-right through the pipeline, and every view provides drill-through to the stock unit level.

**Design language:** Dark-mode-first. Charcoal sidebar (#18181B), main area (#1C1C1E), surface cards (#2A2A2E). Amber (#F59E0B) for primary actions and attention indicators. Teal (#14B8A6) for money/price values. Green (#22C55E) for positive states. Red (#EF4444) for alerts and returns. Inter for body text, JetBrains Mono for all data values (prices, SKUs, unit IDs, dates).

---

## 2. Entity Model

### 2.1 Purchase Batch

A single buying event. Parent of all stock units acquired in that purchase.

| Field | Type | Notes |
|-------|------|-------|
| id | string | Auto-generated, format `PO-NNN` |
| supplier | FK → suppliers | Dropdown with quick-add |
| purchase_date | date | |
| reference | string | Optional external reference |
| supplier_vat_registered | boolean | Determines whether landed cost uses ex-VAT unit price |
| shared_costs | jsonb | `{ shipping: number, broker_fee: number, other: number, other_label: string }` |
| total_shared_costs | number | Computed sum |
| status | enum | `draft`, `recorded` |
| created_at | timestamp | |

### 2.2 Purchase Line Item

One MPN within a purchase batch.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | |
| batch_id | FK → purchase_batches | |
| mpn | string | Format `NNNNN-N` (e.g., `75348-1`) |
| quantity | integer | Number of physical units purchased |
| unit_cost | number | Per-unit price paid (ex-VAT if supplier is VAT registered) |
| apportioned_cost | number | Computed: unit's proportional share of shared costs |
| landed_cost_per_unit | number | Computed: `unit_cost + apportioned_cost` (before grade-based reallocation) |

### 2.3 Stock Unit

The atomic entity. A single physical item tracked through its entire lifecycle.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | |
| uid | string | Human-readable, format `PO052-01` (batch-sequence) |
| batch_id | FK → purchase_batches | Which purchase this unit arrived in |
| line_item_id | FK → purchase_line_items | Which line item within the batch |
| mpn | string | The product MPN |
| grade | integer (1–4) | Null until graded |
| sku | string | Computed: `{mpn}.{grade}` — null until graded |
| landed_cost | number | Initially from batch apportionment; recalculated via relative sales value allocation when grade is assigned |
| condition_flags | jsonb | Array of strings from grading checklist |
| status | enum | See lifecycle statuses below |
| order_id | FK → orders | Null until sold |
| payout_id | FK → payouts | Null until payout received |
| created_at | timestamp | |
| graded_at | timestamp | |
| listed_at | timestamp | |
| sold_at | timestamp | |
| shipped_at | timestamp | |
| delivered_at | timestamp | |
| completed_at | timestamp | |

**Stock unit lifecycle statuses:**

`purchased` → `graded` → `listed` → `sold` → `shipped` → `delivered` → `payout_received` → `complete`

Branch: `sold`/`shipped`/`delivered` → `return_pending` → `refunded` | `restocked`

Special: `needs_allocation` (for unallocated in-person Stripe sales)

### 2.4 Product (MPN level)

The parent product entity. Groups variants. Owns shared data (specs, copy, photos).

| Field | Type | Notes |
|-------|------|-------|
| mpn | string (PK) | Format `NNNNN-N` |
| name | string | Official LEGO® set name |
| theme | string | |
| subtheme | string | Optional |
| set_number | string | The numeric set number without variant |
| piece_count | integer | |
| age_mark | string | e.g., "14+" |
| ean | string | |
| release_date | date | |
| retired_date | date | |
| dimensions_cm | string | e.g., "38 × 26 × 7" |
| weight_g | integer | |
| hook | text | Product copy: 1–2 line hook |
| description | text | Product copy: 80–140 words |
| highlights | text | Product copy: 3–6 bullet points |
| cta | text | Product copy: 1 line |
| seo_title | string | Max 60 chars |
| seo_description | string | 150–160 chars |
| created_at | timestamp | |

### 2.5 Product Variant (SKU level)

A specific grade variant of a product. Owns pricing, channel listings, condition notes.

| Field | Type | Notes |
|-------|------|-------|
| sku | string (PK) | Format `{mpn}.{grade}` — e.g., `75367-1.1` |
| mpn | FK → products | |
| grade | integer (1–4) | |
| sale_price | number | VAT-inclusive |
| floor_price | number | Computed: minimum viable price based on highest-cost batch on hand |
| avg_cost | number | Weighted average landed cost across all on-hand units |
| cost_range | string | Computed: `"£X–£Y"` showing min/max batch costs on hand |
| qty_on_hand | integer | Computed: count of units with status in (`graded`, `listed`) |
| condition_notes | text | AI-drafted from grade + condition flags + photos |
| market_price | number | Fetched from BrickEconomy/BrickLink |
| created_at | timestamp | |

### 2.6 Product Images

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | |
| mpn | FK → products | Images are at MPN level, shared across variants |
| storage_path | string | Supabase Storage path |
| alt_text | text | AI-generated |
| sort_order | integer | |

### 2.7 Channel Listing

Per-variant, per-channel listing record.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | |
| sku | FK → product_variants | |
| channel | enum | `ebay`, `website`, `bricklink` |
| status | enum | `draft`, `live`, `paused`, `ended` |
| external_id | string | eBay item ID, BrickLink lot ID, etc. |
| external_url | string | |
| listed_at | timestamp | |

### 2.8 Order

| Field | Type | Notes |
|-------|------|-------|
| id | string | Format `KO-NNNN` |
| customer_id | FK → customers | |
| channel | enum | `ebay`, `website`, `bricklink`, `in_person` |
| status | enum | `needs_allocation`, `new`, `awaiting_shipment`, `shipped`, `delivered`, `complete`, `return_pending` |
| total | number | VAT-inclusive gross total |
| vat_amount | number | Computed: `total / 1.2 * 0.2` (for eBay orders where tax is not provided) |
| net_amount | number | Computed: `total - vat_amount` |
| payment_method | string | e.g., `ebay_managed`, `stripe`, `cash`, `split` |
| carrier | string | |
| tracking_number | string | |
| shipping_cost | number | |
| blue_bell_club | boolean | Whether this order qualifies for Blue Bell commission |
| qbo_sales_receipt_id | string | QBO SalesReceipt DocNumber |
| qbo_sync_status | enum | `pending`, `synced`, `error` |
| external_order_id | string | eBay order ID, Stripe payment intent, etc. |
| created_at | timestamp | |
| shipped_at | timestamp | |
| delivered_at | timestamp | |

### 2.9 Order Line Item

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | |
| order_id | FK → orders | |
| stock_unit_id | FK → stock_units | Null if unallocated |
| sku | string | Null if unallocated |
| unit_price | number | VAT-inclusive sale price |
| cogs | number | Landed cost of the consumed stock unit (FIFO: oldest batch) |

### 2.10 Customer

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | |
| name | string | |
| email | string | Primary lookup key for upsert |
| channel_ids | jsonb | `{ ebay: "username", bricklink: "username" }` |
| qbo_customer_id | string | |
| blue_bell_member | boolean | |
| created_at | timestamp | |

A standing "Cash Sales" customer record exists for unallocated in-person orders.

### 2.11 Payout

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | |
| channel | enum | `ebay`, `stripe` |
| payout_date | date | |
| gross_amount | number | |
| total_fees | number | |
| net_amount | number | |
| fee_breakdown | jsonb | `{ fvf: number, promoted_listings: number, international: number, processing: number }` |
| order_count | integer | |
| unit_count | integer | |
| qbo_deposit_id | string | |
| qbo_expense_id | string | |
| qbo_sync_status | enum | `pending`, `synced`, `error` |
| external_payout_id | string | eBay payout ID, Stripe payout ID |

### 2.12 Blue Bell Commission Tracker

Not a separate table — computed from orders where `blue_bell_club = true`.

Dashboard widget shows: running commission owed since last payment, qualifying order count, and a "Record Payment" action that creates a QBO Expense and resets the tally.

---

## 3. Business Rules

### 3.1 Cost Apportionment (Step 1 — Purchase)

Shared batch costs are apportioned **proportionally to unit cost**.

```
apportioned_cost_per_unit = (unit_cost / sum_of_all_unit_costs_in_batch) × total_shared_costs
landed_cost_per_unit = unit_cost + apportioned_cost_per_unit
```

If the supplier is VAT registered, `unit_cost` is the ex-VAT amount (the VAT portion is reclaimable and not part of landed cost).

### 3.2 Relative Sales Value Allocation (Step 2 — Grading)

When a batch line item's units are graded into different grades, the total landed cost for that line item is redistributed proportionally to market value.

```
total_line_landed_cost = landed_cost_per_unit × quantity_purchased
expected_revenue_per_grade = market_price[grade] × units_at_grade
total_expected_revenue = sum of all expected_revenue_per_grade
allocation_ratio[grade] = expected_revenue_per_grade / total_expected_revenue
allocated_cost[grade] = total_line_landed_cost × allocation_ratio[grade]
new_landed_cost_per_unit[grade] = allocated_cost[grade] / units_at_grade
```

Market prices per grade are fetched at Step 1 (purchase). If grade-specific market prices are not available, default ratios apply: G1 = 100%, G2 = 80%, G3 = 60%, G4 = 40% of the G1 market price.

### 3.3 Weighted Average Cost (ongoing)

Each variant SKU maintains a weighted average cost across all on-hand stock units. Recalculated on each intake (grading event).

```
new_avg = (existing_qty × existing_avg + new_qty × new_landed_cost) / (existing_qty + new_qty)
```

The weighted average is used for QBO Item cost and P&L reporting.

### 3.4 FIFO for COGS (on sale)

When a stock unit is sold, the system consumes the **oldest unit** (by `created_at`) for that variant SKU. The consumed unit's actual `landed_cost` becomes the COGS for that line item — not the weighted average.

This gives accurate per-sale margin reporting.

### 3.5 Floor Price Guardrail

Each variant's floor price is calculated from the **highest landed cost batch** currently on hand:

```
floor_price = highest_batch_landed_cost × (1 + minimum_margin_target)
```

The minimum margin target is configurable in settings (default: 25%). The app prevents listing below floor price and flags any existing listings where market movement has pushed the sale price below floor.

### 3.6 Markdown Windows

Automated price reduction triggers:

- **Day 30:** First markdown (configurable percentage, default 10%)
- **Day 45:** Clearance markdown (configurable percentage, default 20%)

Calculated from `listed_at` on the stock unit. Applied to the variant's sale price. Must never breach the floor price guardrail.

### 3.7 VAT Handling

**Purchases:** Landed cost uses ex-VAT amount when supplier is VAT registered. Full amount when not.

**Sales:** All sale prices are VAT-inclusive (TaxInclusive).

**QBO SalesReceipt creation — critical bugs:**

1. **eBay does not provide VAT breakdown.** The app must calculate: `net = total / 1.2`, `vat = total - net`.

2. **QBO ignores GlobalTaxCalculation TaxInclusive flag** and treats all line item amounts as ex-VAT. The app must always send QBO the **ex-VAT unit price** plus explicit VAT amount. The line total (net + VAT) must exactly match the gross order total.

3. **Rounding on multi-item orders:** Calculate VAT per line item, sum all lines, compare to order total. If there's a penny discrepancy, adjust the last line item's VAT to force an exact match.

### 3.8 QBO Sync Flow

**On order creation:**

1. Upsert Customer in QBO (match by email)
2. Create SalesReceipt with:
   - Customer reference
   - Line items: QBO Item ref, quantity, **ex-VAT unit price**, TaxCode (standard rate 20%), explicit VAT amount
   - Payment method mapped to channel
   - Line total validation: sum of (net + VAT per line) must equal gross order total
3. Consume FIFO stock unit, record COGS locally

**On payout:**

1. Create Deposit in QBO for net payout amount → bank account
2. Create Expense entries for each fee category (FVF, Promoted Listings, etc.)
3. Link Deposit and Expenses to the covered orders

**QBO Item creation:**

When a new variant SKU is created (at grading), create the corresponding QBO Item with: name, SKU, current weighted average cost. Update cost on each new intake.

### 3.9 In-Person / Stripe Sales

Stripe webhook fires on payment. The app checks for customer and SKU data in the payload.

- **Customer data present:** Upsert normally
- **Customer data missing:** Allocate to standing "Cash Sales" customer
- **SKU data present:** Link to products, consume FIFO, decrement stock
- **SKU data missing:** Create order with unallocated line items, status `needs_allocation`

Unallocated orders are flagged in the Orders pipeline for manual allocation. On allocation, normal sync fires (FIFO consumption, stock update, QBO SalesReceipt update).

Cash sales (no Stripe) are entered via a quick-entry form with payment method selector (cash/card/split).

### 3.10 Blue Bell Commission

Not tracked per-order. The app maintains a running tally of qualifying orders (where `blue_bell_club = true`) and the commission owed (5% of qualifying order totals). A dashboard widget shows the amount owed and a "Record Payment" action that creates a QBO Expense and resets the period.

---

## 4. UI Structure

### 4.1 Sidebar Navigation

```
Pipeline
  🛒 Purchases     [badge: ungraded count]
  📦 Products
  🧾 Orders         [badge: action-needed count]
  💰 Payouts

System
  ⚡ QBO Sync
  📊 Analytics
  ⚙  Settings

Footer
  QBO: ● Connected
  eBay: ● Connected
  Stripe: ● Connected
```

### 4.2 Purchases View

**List view:** Cards per batch showing: PO number, supplier, date, total cost, unit count, ungraded count badge, shared costs, VAT registered indicator. Coloured status bar at bottom showing proportion of units by lifecycle status.

**Batch detail view:** Accessed by clicking a batch card.

Header: PO number, supplier, date, total cost, ungraded badge. Bulk Grade button appears when units are multi-selected.

Summary cards: Total Units, Shared Costs, Batch Cost, Ungraded count.

Per-MPN sections: Each MPN in the batch displayed as a card with a unit table. Columns: checkbox (ungraded only), Unit ID, Grade, Status, Landed Cost, Actions. Grade button opens slide-out. Edit button opens same slide-out for already-graded units.

**Grading slide-out (from batch):**

- Grade assignment: 4 clickable grade cards (G1 Mint Brick, G2 Full Stack, G3 Well Bricked, G4 Brick Shy) with market price per grade shown
- Condition flags: checkbox grid (Resealed, Shelf wear, Box dent, Box crush, Missing outer carton, Bags opened, Parts verified, Sun yellowing, Price sticker residue)
- Physical confirmation: EAN, Age Mark, Dimensions, Weight (pre-populated from API where available, editable)
- Save Grade / Cancel buttons

**Bulk grading:** Multi-select ungraded units via checkboxes, click "Bulk Grade N Units" — opens a simplified slide-out that applies the same grade and condition flags to all selected units.

**New Purchase form:** Batch header (supplier, date, reference, VAT registered checkbox) + shared costs (shipping, broker fee, other with label). Line items table with: MPN (autocomplete), quantity, unit cost. Live-calculated columns: apportioned cost, landed cost per unit. Existing stock indicator per MPN ("3 on hand at £22.80 avg" or "New to catalogue"). Footer: item count, unit total, shared total, batch total. Save Draft / Record Purchase buttons.

### 4.3 Products View

**List view:** Table of MPNs. Columns: MPN, Product name, Theme, Variants (grade badges), Total Units, Listed count, Sold count, Status badge.

**Product detail view:** Accessed by clicking a product row.

Header: Product name, MPN, theme.

Variant summary cards: One card per grade variant showing: SKU, grade badge, sale price, avg cost, floor price, qty on hand, cost range, listed/sold counts.

Tabs:

**Stock Units tab (default):** Combined stock movement and unit management view. Table of all stock units across all variants. Columns: checkbox, Unit ID, Grade, Batch, Landed Cost, Status, Order, Payout, View button. Multi-select for bulk editing. Row background highlights for return_pending (red tint). View button opens unit detail slide-out.

**Copy & Media tab:** Photo upload zone (drag and drop, bulk upload, auto-generated alt text per image). Product copy fields at MPN level: Hook, Description, Highlights, CTA. Per-variant condition notes sections (AI-drafted from grade + flags + photos).

**Channels tab:** Per-variant channel listing management. Each variant shows a card with channel rows (eBay, Website, BrickLink). Per-channel: status badge, Publish/Update button. "Publish All" per variant. Batch publish across variants and channels.

**Specifications tab:** Product data at MPN level. Set Number, Theme, Pieces, Age Mark, EAN, Released, Retired, Dimensions, Weight. "To be confirmed" shown in amber for missing data.

**Unit detail slide-out (from Products):**

- Key data: SKU, Grade, Batch, Landed Cost, Order, Payout
- Full lifecycle stepper: visual progression through all statuses with check marks for completed steps, amber highlight for current step, red branch for returns
- Edit Grade: grade selector (4 buttons)
- Save Changes button

### 4.4 Orders View

**List view:** Table of orders. Columns: Order ID, Customer, Channel, Items count, Total, VAT, Status, Date. Row highlight for action-needed statuses (needs_allocation, return_pending). "Cash Sales" customer shows amber allocation warning.

**Order detail view:** Accessed by clicking an order row.

Header: Order ID, status badge, customer, channel, date. Action buttons: "Allocate Items" (for needs_allocation), "Mark Complete" (for shipped/delivered).

Summary cards: Total, VAT, Net Revenue, QBO Status.

Line Items table: Columns: SKU, Product name, Unit ID, Landed Cost, Unit Status, Tracking, Payout Status, View Unit button. Row highlighting for return_pending (red) and needs_allocation (amber). "View Unit" opens a slide-out with the stock unit's full details and lifecycle stepper.

### 4.5 Payouts View

**Summary cards:** One per channel (eBay, Stripe, Blue Bell Commission Owed). Each shows: pending amount, order count, unit count, next expected payout date.

**Recent Payouts table:** Columns: Date, Channel, Gross, Fees (red), Net (teal), Orders, Units, QBO sync status. Click to drill into payout detail showing per-order breakdown.

### 4.6 Shared UI Patterns

**Slide-out panel:** Used for grading, unit detail, and edit actions. 480px wide, slides in from right with backdrop overlay. Always closeable via X button or clicking backdrop.

**Status badges:** Colour-coded uppercase labels matching the UNIT_STATUSES colour map.

**Grade badges:** Square badges with grade number, coloured per grade (G1 gold, G2 silver, G3 bronze, G4 dim).

**Mono values:** All numeric data (prices, costs, SKUs, unit IDs, dates in tables) rendered in JetBrains Mono.

**Action-needed indicators:** Amber background tint on table rows, badge counts in sidebar, amber dot indicators on tabs.

---

## 5. Integration Points

### 5.1 Data Fetch (Step 1 — on purchase)

When an MPN is added to a purchase batch, the app fetches:

- **Rebrickable API:** Set name, theme, subtheme, piece count, release year, minifig list
- **BrickEconomy:** Market prices (new/used/current), price history, retirement status
- **BrickLink:** Average sale prices by condition, current inventory levels

Market prices are stored per grade on the product variant. Default grade ratios (G1: 100%, G2: 80%, G3: 60%, G4: 40%) used when grade-specific data is unavailable.

### 5.2 eBay (Orders and Listings)

- **Inbound:** Poll Fulfillment API for new orders. Pull order details, create local order + stock unit consumption + QBO sync.
- **Inbound:** Detect shipping label purchase via Fulfillment API. Pull tracking details into order.
- **Outbound:** Push listings via Inventory API. Create/update/end listings per channel listing record.
- **Inbound:** Pull payout reports via Finances API. Match line items to orders. Extract fee breakdown.

### 5.3 Stripe (In-person and Website)

- **Inbound:** Webhook on `payment_intent.succeeded` for website orders and in-person card payments.
- **Inbound:** Webhook on `payout.paid` for payout reconciliation.

### 5.4 QuickBooks Online

- **Outbound:** Upsert Customer on order creation
- **Outbound:** Create SalesReceipt on order creation (ex-VAT prices + explicit VAT)
- **Outbound:** Create/update Item on variant creation and cost recalculation
- **Outbound:** Create Deposit + Expenses on payout
- **Outbound:** Create Expense on Blue Bell commission payment
- **Outbound:** Create RefundReceipt on return/refund

### 5.5 Evri (Future — Shipping)

- **Outbound:** Generate shipping label via Evri API using parcel dimensions (confirmed at Step 2) and delivery address
- **Inbound:** Tracking updates

### 5.6 AI Content Generation (Steps 1–3)

- **Step 1:** Fetch and structure product specifications from external APIs
- **Step 2:** No AI — structured data entry (grade, flags, physical confirmation)
- **Step 3 (on photo upload):** Generate alt text per image (using image + product context). Generate condition notes per variant (using grade + condition flags + photos). Generate full product copy suite for new MPNs (hook, description, highlights, CTA, SEO title, SEO description) using brand voice guidelines.

---

## 6. Condition Flags (Grading Checklist)

Available flags at grading (Step 2):

- Resealed
- Shelf wear
- Box dent
- Box crush
- Missing outer carton
- Bags opened
- Parts verified
- Sun yellowing
- Price sticker residue

These are stored as a JSON array on the stock unit. They feed into AI-generated condition notes at Step 3.

---

## 7. Wireframe Reference

The approved interactive wireframe is available as `kuso-hub-v2.jsx` (React component with mock data). It demonstrates the full navigation structure, all views, slide-out panels, and the stock-unit-centric data display patterns agreed in this specification.
