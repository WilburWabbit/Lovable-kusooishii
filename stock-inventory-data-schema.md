# Stock Inventory & Financial Tracking Data Schema

> Derived from QBO extract analysis (April 2026). Designed for the LEGO resale commerce platform to track stock lifecycle from purchase through sale, with full cost apportionment, FIFO costing, payout reconciliation, and per-unit profit calculation.

---

## 1. Source Data Summary (QBO Extracts)

| Source file | Records | Role in schema |
|---|---|---|
| `items.json` | 382 items (360 Inventory, 22 non-inventory) | Master product catalogue — each inventory item has MPN.grade SKU, purchase cost, sale price, income/expense/asset accounts. Non-inventory types: Group, Service, Category, NonInventory |
| `purchases.json` | 623 purchase transactions | Stock acquisition (86 with item lines) + operating expenses (537 pure expense). 78 are **mixed** (stock items + non-stock costs on same invoice — the apportionment trigger) |
| `salesreceipts.json` | 320 sales receipts | Revenue events. 319 deposit to Undeposited Funds (marketplace sales), 1 direct to Current. Items sold at unit level |
| `deposits.json` | 97 deposit records | Payout events. All deposit to Current. 43 contain both SalesReceipt and Purchase linked transactions (payout with fee deductions). 62 have negative line amounts (fees/shipping deducted from payout) |
| `refunds.json` | 12 refund receipts | Stock returns — reverse a sale, item returns to stock or is written off |
| `invoices.json` | 1 invoice | Service income (AlphaSights consulting) — not stock-related |
| `payments.json` | 1 payment | Payment against the invoice above |
| `journal_entries.json` | 11 journal entries | VAT journals — not stock-related |
| `vendors.json` | 46 vendors | Supplier master (John Pye & Sons, eBay, Stripe, Etsy, etc.) |
| `customers.json` | 317 customers | Buyer master — mix of named individuals and marketplace usernames |
| `accounts.json` | 77 accounts | Chart of accounts — key accounts identified below |

### Key QBO Accounts

| Account | Id | Type | Role |
|---|---|---|---|
| Stock Asset | 66 | Other Current Asset (Inventory) | Inventory holding account |
| Sales of Product Income | 64 | Income | Revenue from stock sales |
| Cost of sales | 65 | COGS | Direct cost of stock sold |
| Courier and delivery charges | 21 | COGS (sub-account) | Shipping costs — both inbound (buying) and outbound (selling) |
| Buying Fees | 1150040005 | COGS (sub-account) | Auction/platform fees on purchases |
| Selling Fees | 1150040006 | COGS (sub-account) | Marketplace commission on sales |
| Bank charges | 29 | Expense | Stripe processing fees |
| Undeposited Funds | 67 | Other Current Asset | Holding account for marketplace proceeds before payout |
| Current | 1150040004 | Bank | Business bank account — payout destination |
| Discounts given | 59 | Income (contra) | Sale discounts |
| Advertising | 20 | Expense | Promoted listings / Etsy ads |

---

## 2. Entity-Relationship Model

### 2.1 Core Entities

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│   vendor     │     │  purchase_order   │     │   product    │
│              │────▶│  (QBO Purchase)   │◀────│  (QBO Item)  │
│  QBO vendor  │     │                  │     │  SKU master  │
└──────────────┘     └────────┬─────────┘     └──────┬───────┘
                              │                       │
                     ┌────────▼─────────┐            │
                     │ purchase_line    │            │
                     │ (item + expense) │────────────┘
                     └────────┬─────────┘
                              │
                     ┌────────▼─────────┐
                     │   stock_unit     │  ◀── atomic lifecycle entity
                     │ (individual item)│
                     └────────┬─────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
     ┌────────────┐  ┌───────────────┐  ┌──────────┐
     │ sale_line  │  │ return_line   │  │ adjust-  │
     │            │  │               │  │  ment    │
     └─────┬──────┘  └───────────────┘  └──────────┘
           │
     ┌─────▼──────┐     ┌──────────────┐     ┌──────────────┐
     │   sale     │     │   payout     │     │  payout_fee  │
     │(SalesRcpt) │────▶│  (Deposit)   │◀────│  (Purchase   │
     └─────┬──────┘     │              │     │  from deposit)│
           │            └──────────────┘     └──────────────┘
     ┌─────▼──────┐
     │  customer  │
     └────────────┘
```

---

## 3. Table Definitions

### 3.1 `product` — SKU Master

The canonical product/item record. One row per SKU (MPN.grade).

| Column | Type | Source | Description |
|---|---|---|---|
| `id` | UUID / PK | Generated | Internal primary key |
| `qbo_item_id` | TEXT | `items[].Id` | QBO Item ID (e.g. "5") |
| `name` | TEXT | `items[].Name` | Display name (e.g. "4x4 Mercedes-Benz Zetros Trial Truck (42129-1.2)") |
| `sku` | TEXT | `items[].Sku` | MPN.grade identifier (e.g. "42129-1.2") |
| `mpn` | TEXT | Derived | LEGO set number with version (e.g. "42129-1") — extracted from SKU before last dot |
| `grade` | INTEGER | Derived | Condition grade (1–5) — extracted from SKU after last dot |
| `type` | ENUM | `items[].Type` | "Inventory" or "NonInventory" or "Service" |
| `unit_sale_price` | DECIMAL(10,2) | `items[].UnitPrice` | Default sale price (ex-VAT) |
| `unit_purchase_cost` | DECIMAL(10,2) | `items[].PurchaseCost` | Default purchase cost |
| `is_active` | BOOLEAN | `items[].Active` | Active in catalogue |
| `income_account_id` | TEXT | `items[].IncomeAccountRef.value` | QBO income account |
| `expense_account_id` | TEXT | `items[].ExpenseAccountRef.value` | QBO COGS account |
| `asset_account_id` | TEXT | `items[].AssetAccountRef.value` | QBO asset account (Stock Asset) |
| `tax_code` | TEXT | `items[].SalesTaxCodeRef.name` | VAT rate (e.g. "20.0% S") |
| `created_at` | TIMESTAMPTZ | `items[].MetaData.CreateTime` | |
| `updated_at` | TIMESTAMPTZ | `items[].MetaData.LastUpdatedTime` | |

**Constraint**: `sku` is UNIQUE. Products with `type = 'Inventory'` and `asset_account_id = '66'` (Stock Asset) are stock-tracked items.

---

### 3.2 `vendor` — Supplier Master

| Column | Type | Source | Description |
|---|---|---|---|
| `id` | UUID / PK | Generated | |
| `qbo_vendor_id` | TEXT | `vendors[].Id` | QBO Vendor ID |
| `display_name` | TEXT | `vendors[].DisplayName` | e.g. "John Pye & Sons", "eBay", "Stripe" |
| `company_name` | TEXT | `vendors[].CompanyName` | Legal entity name |
| `is_active` | BOOLEAN | `vendors[].Active` | |
| `vendor_type` | ENUM | Derived | "supplier" (stock source), "marketplace" (eBay, Etsy), "payment_processor" (Stripe), "other" |
| `created_at` | TIMESTAMPTZ | | |

**Key vendors by role**:
- **Stock suppliers**: Will Killin (director — DLA-STOCK-CONSOL), John Pye & Sons (auction house)
- **Marketplaces**: eBay, Etsy
- **Payment processors**: Stripe
- **Service/operational**: Amazon, Anthropic, Google, Royal Mail, etc.

---

### 3.3 `customer` — Buyer Master

| Column | Type | Source | Description |
|---|---|---|---|
| `id` | UUID / PK | Generated | |
| `qbo_customer_id` | TEXT | `customers[].Id` | QBO Customer ID |
| `display_name` | TEXT | `customers[].DisplayName` | Name or marketplace username |
| `given_name` | TEXT | `customers[].GivenName` | |
| `family_name` | TEXT | `customers[].FamilyName` | |
| `email` | TEXT | `customers[].PrimaryEmailAddr.Address` | May be marketplace-masked (e.g. `*@members.ebay.com`) |
| `bill_address` | JSONB | `customers[].BillAddr` | |
| `ship_address` | JSONB | `customers[].ShipAddr` | |
| `channel` | ENUM | Derived from email pattern | "ebay", "etsy", "website", "direct" |
| `is_active` | BOOLEAN | `customers[].Active` | |
| `created_at` | TIMESTAMPTZ | | |

**Channel detection logic**: If `email` contains `@members.ebay.com` → "ebay". If email contains `@etsy.com` → "etsy". If sale deposited to Stripe → "website". Otherwise → "direct".

---

### 3.4 `purchase_order` — Stock Purchase & Expense Transactions

One row per QBO Purchase. Covers both stock acquisitions and operating expenses.

| Column | Type | Source | Description |
|---|---|---|---|
| `id` | UUID / PK | Generated | |
| `qbo_purchase_id` | TEXT | `purchases[].Id` | QBO Purchase ID |
| `doc_number` | TEXT | `purchases[].DocNumber` | Vendor invoice/reference number |
| `txn_date` | DATE | `purchases[].TxnDate` | Transaction date |
| `vendor_id` | UUID / FK | `purchases[].EntityRef.value` → `vendor` | |
| `payment_account_id` | TEXT | `purchases[].AccountRef.value` | Payment source account (Current, Director's current account, Undeposited Funds) |
| `payment_type` | TEXT | `purchases[].PaymentType` | "Cash", "Check", etc. |
| `total_amount` | DECIMAL(10,2) | `purchases[].TotalAmt` | Gross total including VAT |
| `tax_calculation` | TEXT | `purchases[].GlobalTaxCalculation` | "TaxExcluded", "TaxInclusive", "NotApplicable" |
| `private_note` | TEXT | `purchases[].PrivateNote` | |
| `purchase_type` | ENUM | Derived | "stock_acquisition" (has item lines), "payout_deduction" (account=Undeposited Funds, linked from deposit), "operating_expense" (everything else) |
| `has_stock_items` | BOOLEAN | Derived | TRUE if any line is ItemBasedExpenseLineDetail with a stock product |
| `stock_items_subtotal` | DECIMAL(10,2) | Calculated | Sum of item line amounts (ex-VAT) |
| `ancillary_costs_subtotal` | DECIMAL(10,2) | Calculated | Sum of account-based expense line amounts on mixed purchases |
| `created_at` | TIMESTAMPTZ | | |

**Purchase classification** (623 total):
- **8** pure stock-item purchases (only ItemBasedExpenseLineDetail)
- **78** mixed purchases (stock items + account-based expenses — require apportionment)
- **537** pure operating expenses (only AccountBasedExpenseLineDetail)
- **287** are payout deductions (linked from deposits, `payment_account = Undeposited Funds`)

---

### 3.5 `purchase_line` — Individual Lines on a Purchase

| Column | Type | Source | Description |
|---|---|---|---|
| `id` | UUID / PK | Generated | |
| `purchase_order_id` | UUID / FK | → `purchase_order` | Parent purchase |
| `line_number` | INTEGER | `Line[].Id` | Line sequence |
| `line_type` | ENUM | `Line[].DetailType` | "item" (ItemBasedExpenseLineDetail) or "expense" (AccountBasedExpenseLineDetail) |
| `product_id` | UUID / FK | → `product` (if line_type = "item") | NULL for expense lines |
| `description` | TEXT | | |
| `quantity` | DECIMAL(10,4) | `ItemBasedExpenseLineDetail.Qty` | NULL for expense lines |
| `unit_price` | DECIMAL(10,4) | `ItemBasedExpenseLineDetail.UnitPrice` | NULL for expense lines |
| `amount` | DECIMAL(10,2) | `Line[].Amount` | Line total (ex-VAT) |
| `account_id` | TEXT | `AccountBasedExpenseLineDetail.AccountRef.value` | Expense account (for expense lines) |
| `account_name` | TEXT | `AccountBasedExpenseLineDetail.AccountRef.name` | e.g. "Cost of sales:Courier and delivery charges" |
| `expense_category` | ENUM | Derived from account_name | "delivery", "buying_fees", "selling_fees", "bank_charges", "advertising", "subscription", "other" |
| `tax_code` | TEXT | `TaxCodeRef.value` | |

---

### 3.6 `stock_unit` — Individual Physical Items (Atomic Lifecycle Entity)

**One row per physical unit acquired.** If a purchase line has Qty=3, this creates 3 `stock_unit` rows. This is the heart of the schema — every unit is tracked from acquisition through sale/disposal with its own landed cost.

| Column | Type | Source | Description |
|---|---|---|---|
| `id` | UUID / PK | Generated | |
| `product_id` | UUID / FK | → `product` | What this unit is |
| `purchase_line_id` | UUID / FK | → `purchase_line` | Which purchase line acquired it |
| `purchase_order_id` | UUID / FK | → `purchase_order` | Which purchase transaction |
| `vendor_id` | UUID / FK | → `vendor` | Who it was bought from |
| `acquisition_date` | DATE | From parent purchase_order.txn_date | Date acquired |
| `unit_purchase_price` | DECIMAL(10,4) | `purchase_line.unit_price` | Raw unit cost before apportionment |
| `apportioned_ancillary_cost` | DECIMAL(10,4) | Calculated | Share of delivery + buying fees (see §4) |
| `landed_cost` | DECIMAL(10,4) | Calculated | `unit_purchase_price + apportioned_ancillary_cost` |
| `carrying_value` | DECIMAL(10,4) | | `landed_cost` less any impairment |
| `status` | ENUM | | "in_stock", "sold", "returned", "written_off", "adjusted" |
| `sold_date` | DATE | | Date of sale (if sold) |
| `sale_line_id` | UUID / FK | → `sale_line` | Link to the sale event |
| `fifo_sequence` | INTEGER | Auto-increment per product_id | FIFO ordering — lower = acquired earlier = sold first |
| `created_at` | TIMESTAMPTZ | | |
| `updated_at` | TIMESTAMPTZ | | |

**Key invariant**: `landed_cost = unit_purchase_price + apportioned_ancillary_cost`. This varies per unit even within the same SKU because different purchase invoices carry different ancillary cost ratios.

---

### 3.7 `sale` — Sales Transactions

One row per QBO SalesReceipt.

| Column | Type | Source | Description |
|---|---|---|---|
| `id` | UUID / PK | Generated | |
| `qbo_salesreceipt_id` | TEXT | `salesreceipts[].Id` | QBO SalesReceipt ID |
| `doc_number` | TEXT | `salesreceipts[].DocNumber` | Order reference (e.g. "19-14370-57622") |
| `txn_date` | DATE | `salesreceipts[].TxnDate` | Sale date |
| `customer_id` | UUID / FK | → `customer` | |
| `channel` | ENUM | Derived | "ebay", "etsy", "website", "direct" |
| `deposit_to_account_id` | TEXT | `salesreceipts[].DepositToAccountRef.value` | Usually "67" (Undeposited Funds) |
| `payment_method` | TEXT | `salesreceipts[].PaymentMethodRef.name` | "Cash", "Credit Card", etc. |
| `subtotal` | DECIMAL(10,2) | SubTotalLineDetail.Amount | Pre-discount, pre-tax total |
| `discount_amount` | DECIMAL(10,2) | DiscountLineDetail.Amount | Discount applied (4 sales have discounts) |
| `discount_percent` | DECIMAL(5,2) | DiscountLineDetail.DiscountPercent | |
| `tax_amount` | DECIMAL(10,2) | `TxnTaxDetail.TotalTax` | VAT amount |
| `total_amount` | DECIMAL(10,2) | `salesreceipts[].TotalAmt` | Gross total including VAT |
| `bill_address` | JSONB | `salesreceipts[].BillAddr` | |
| `ship_address` | JSONB | `salesreceipts[].ShipAddr` | |
| `bill_email` | TEXT | `salesreceipts[].BillEmail.Address` | |
| `tax_calculation` | TEXT | `salesreceipts[].GlobalTaxCalculation` | |
| `created_at` | TIMESTAMPTZ | | |

---

### 3.8 `sale_line` — Items Sold per Sale

| Column | Type | Source | Description |
|---|---|---|---|
| `id` | UUID / PK | Generated | |
| `sale_id` | UUID / FK | → `sale` | Parent sale |
| `line_number` | INTEGER | `Line[].LineNum` | |
| `product_id` | UUID / FK | → `product` | Item sold |
| `description` | TEXT | `Line[].Description` | |
| `quantity` | INTEGER | `SalesItemLineDetail.Qty` | Units sold (usually 1) |
| `unit_price` | DECIMAL(10,4) | `SalesItemLineDetail.UnitPrice` | Sale price per unit (ex-VAT) |
| `tax_inclusive_amount` | DECIMAL(10,2) | `SalesItemLineDetail.TaxInclusiveAmt` | Price including VAT |
| `amount` | DECIMAL(10,2) | `Line[].Amount` | Line total (ex-VAT) |
| `tax_code` | TEXT | `SalesItemLineDetail.TaxCodeRef.value` | |

**Stock unit linkage**: When a `sale_line` is processed, the system must allocate `stock_unit` records using FIFO (see §5). If `quantity > 1`, multiple stock units are linked.

---

### 3.9 `sale_line_stock_unit` — Junction Table (Sale ↔ Stock Unit)

Resolves the many-to-many between sale lines and stock units (a sale line with qty=2 consumes 2 stock units).

| Column | Type | Source | Description |
|---|---|---|---|
| `id` | UUID / PK | Generated | |
| `sale_line_id` | UUID / FK | → `sale_line` | |
| `stock_unit_id` | UUID / FK | → `stock_unit` | |
| `unit_revenue` | DECIMAL(10,4) | `sale_line.unit_price` | Revenue recognised for this unit |
| `unit_cogs` | DECIMAL(10,4) | `stock_unit.landed_cost` | FIFO cost of this unit |
| `unit_gross_profit` | DECIMAL(10,4) | Calculated | `unit_revenue - unit_cogs` |

---

### 3.10 `return` — Refund/Return Transactions

| Column | Type | Source | Description |
|---|---|---|---|
| `id` | UUID / PK | Generated | |
| `qbo_refund_id` | TEXT | `refunds[].Id` | QBO Refund Receipt ID |
| `doc_number` | TEXT | `refunds[].DocNumber` | e.g. "R-03-14240-37590" |
| `txn_date` | DATE | `refunds[].TxnDate` | |
| `customer_id` | UUID / FK | → `customer` | |
| `original_sale_id` | UUID / FK | → `sale` | Matched by customer + item + proximity |
| `deposit_to_account_id` | TEXT | `refunds[].DepositToAccountRef.value` | Usually Undeposited Funds |
| `total_amount` | DECIMAL(10,2) | `refunds[].TotalAmt` | Refund amount |
| `tax_amount` | DECIMAL(10,2) | `TxnTaxDetail.TotalTax` | |
| `return_disposition` | ENUM | | "restock" (back to in_stock), "write_off" (to Stock Shrinkage) |
| `created_at` | TIMESTAMPTZ | | |

---

### 3.11 `return_line` — Items Returned

| Column | Type | Source | Description |
|---|---|---|---|
| `id` | UUID / PK | Generated | |
| `return_id` | UUID / FK | → `return` | |
| `product_id` | UUID / FK | → `product` | |
| `quantity` | INTEGER | | |
| `unit_price` | DECIMAL(10,4) | | Refund price per unit |
| `amount` | DECIMAL(10,2) | | |
| `stock_unit_id` | UUID / FK | → `stock_unit` | The original stock unit being returned |

When a return is processed: if `return_disposition = 'restock'`, the `stock_unit.status` reverts to `'in_stock'` and `stock_unit.sale_line_id` is cleared. The unit retains its original `landed_cost` for FIFO purposes.

---

### 3.12 `stock_adjustment` — Write-offs, Impairments, Corrections

| Column | Type | Source | Description |
|---|---|---|---|
| `id` | UUID / PK | Generated | |
| `stock_unit_id` | UUID / FK | → `stock_unit` | |
| `adjustment_date` | DATE | | |
| `adjustment_type` | ENUM | | "write_off", "impairment", "revaluation", "shrinkage" |
| `amount` | DECIMAL(10,2) | | Value change (negative for impairment) |
| `reason` | TEXT | | |
| `qbo_journal_id` | TEXT | | Linked QBO journal entry if applicable |
| `created_at` | TIMESTAMPTZ | | |

---

### 3.13 `payout` — Provider Payout/Deposit Events

One row per QBO Deposit. Represents a payout from a marketplace or payment processor into the bank account.

| Column | Type | Source | Description |
|---|---|---|---|
| `id` | UUID / PK | Generated | |
| `qbo_deposit_id` | TEXT | `deposits[].Id` | QBO Deposit ID |
| `txn_date` | DATE | `deposits[].TxnDate` | Payout date |
| `deposit_to_account_id` | TEXT | `deposits[].DepositToAccountRef.value` | Always "Current" (bank account) |
| `gross_amount` | DECIMAL(10,2) | Calculated | Sum of positive linked amounts (sales proceeds) |
| `total_deductions` | DECIMAL(10,2) | Calculated | Sum of negative linked amounts (fees + shipping) |
| `net_amount` | DECIMAL(10,2) | `deposits[].TotalAmt` | Amount actually deposited = gross - deductions |
| `payout_provider` | ENUM | Derived | "stripe", "ebay", "etsy", "direct" — inferred from linked purchase vendors |
| `created_at` | TIMESTAMPTZ | | |

---

### 3.14 `payout_sale_link` — Sales Included in a Payout

| Column | Type | Source | Description |
|---|---|---|---|
| `id` | UUID / PK | Generated | |
| `payout_id` | UUID / FK | → `payout` | |
| `sale_id` | UUID / FK | → `sale` | Linked via `deposits[].Line[].LinkedTxn` where TxnType="SalesReceipt" |
| `amount` | DECIMAL(10,2) | `Line[].Amount` | Gross sale amount included in this payout |

---

### 3.15 `payout_fee` — Fees & Deductions Within a Payout

Each negative-amount linked Purchase within a Deposit becomes a `payout_fee`. These represent selling fees, shipping label costs, payment processing fees, and advertising charges deducted by the provider before depositing.

| Column | Type | Source | Description |
|---|---|---|---|
| `id` | UUID / PK | Generated | |
| `payout_id` | UUID / FK | → `payout` | Parent payout |
| `qbo_purchase_id` | TEXT | Linked Purchase ID | The QBO Purchase representing this deduction |
| `purchase_order_id` | UUID / FK | → `purchase_order` | Full purchase record |
| `vendor_id` | UUID / FK | → `vendor` | Who charged the fee (eBay, Stripe, Etsy, etc.) |
| `total_amount` | DECIMAL(10,2) | `purchases[].TotalAmt` | Total deduction amount |
| `fee_type` | ENUM | Derived from line accounts | Primary fee classification (see below) |
| `created_at` | TIMESTAMPTZ | | |

---

### 3.16 `payout_fee_line` — Itemised Fee Breakdown

A single payout fee purchase can contain multiple line items (e.g. an eBay purchase with 10 shipping labels + 1 selling fee line).

| Column | Type | Source | Description |
|---|---|---|---|
| `id` | UUID / PK | Generated | |
| `payout_fee_id` | UUID / FK | → `payout_fee` | |
| `account_name` | TEXT | `AccountBasedExpenseLineDetail.AccountRef.name` | |
| `fee_category` | ENUM | Derived | See classification below |
| `amount` | DECIMAL(10,2) | `Line[].Amount` | |
| `description` | TEXT | `Line[].Description` | |
| `linked_sale_id` | UUID / FK | → `sale` (nullable) | Sale-level fee linkage (see §6) |
| `linked_product_id` | UUID / FK | → `product` (nullable) | If fee is for a specific item (e.g. shipping label for a sale) |

**Fee category classification** (from observed QBO data):

| Account pattern | `fee_category` | Linkable to sale? | Description |
|---|---|---|---|
| `Cost of sales:Selling Fees` | `selling_fee` | Yes — per-sale commission | eBay/Etsy/marketplace percentage fee |
| `Cost of sales:Courier and delivery charges` | `shipping_label` | Yes — per-sale postage | Shipping labels purchased via marketplace |
| `Bank charges` | `payment_processing` | Yes — per-sale Stripe fee | Stripe processing fee (1.4% + 20p typical) |
| `Advertising` | `advertising` | No — platform-level | Promoted Listings / Etsy ads (monthly aggregate) |
| `Subscriptions` | `subscription` | No — platform-level | Monthly platform subscriptions |
| `Cost of sales:Buying Fees` | `buying_fee` | No — per-purchase | Auction buyer's premium (apportioned to stock units, not sales) |
| `Printing, postage and stationery` | `postage_supplies` | Sometimes | Packaging materials, stamps |
| `Equipment additions at cost` | `equipment` | No | Capital items purchased via marketplace |

---

### 3.17 `unit_profit_view` — Calculated Per-Unit Profit (View/Materialised)

This is the ultimate output — profit per stock unit sold, with all costs allocated.

| Column | Type | Description |
|---|---|---|
| `stock_unit_id` | UUID | The unit |
| `product_id` | UUID | Product/SKU |
| `sku` | TEXT | MPN.grade |
| `acquisition_date` | DATE | When purchased |
| `sold_date` | DATE | When sold |
| `vendor_name` | TEXT | Supplier |
| `customer_name` | TEXT | Buyer |
| `channel` | TEXT | Sales channel |
| `sale_doc_number` | TEXT | Order reference |
| `unit_purchase_price` | DECIMAL | Raw purchase price |
| `apportioned_ancillary_cost` | DECIMAL | Delivery + buying fees apportioned |
| `landed_cost` | DECIMAL | Total cost in (FIFO basis) |
| `sale_price_ex_vat` | DECIMAL | Revenue (ex-VAT) |
| `discount_applied` | DECIMAL | Any discount on the sale |
| `net_revenue` | DECIMAL | `sale_price_ex_vat - discount_applied` |
| `selling_fee` | DECIMAL | Marketplace commission allocated to this unit |
| `shipping_cost` | DECIMAL | Outbound shipping label cost for this sale |
| `payment_processing_fee` | DECIMAL | Stripe/payment fee for this sale |
| `total_selling_costs` | DECIMAL | Sum of all sale-level deductions |
| `gross_profit` | DECIMAL | `net_revenue - landed_cost` |
| `net_profit` | DECIMAL | `gross_profit - total_selling_costs` |
| `margin_percent` | DECIMAL | `net_profit / net_revenue * 100` |

---

## 4. Landed Cost Apportionment Logic

### The Problem

78 out of 86 stock purchases contain non-stock expense lines (delivery charges, buying fees) that must be apportioned to each stock unit on the invoice. The apportionment must be **per-invoice** because the ratio of ancillary costs to item costs varies significantly.

### Observed Expense Categories on Stock Purchases

| Category | Account | Typical role |
|---|---|---|
| Courier/delivery | `Cost of sales:Courier and delivery charges` | Inbound shipping for the whole order |
| Buying fees | `Cost of sales:Buying Fees` | Auction buyer's premium |

### Apportionment Method: Pro-Rata by Unit Value

For each purchase with mixed lines:

```
stock_items_subtotal = SUM(amount) WHERE line_type = 'item'
ancillary_costs_total = SUM(amount) WHERE line_type = 'expense'
                        AND expense_category IN ('delivery', 'buying_fees')

For each stock unit on the purchase:
  unit_value_share = unit_purchase_price / stock_items_subtotal
  apportioned_ancillary_cost = unit_value_share × ancillary_costs_total
  landed_cost = unit_purchase_price + apportioned_ancillary_cost
```

### Worked Example

**Purchase 461809952** (John Pye & Sons):

| Item | Qty | Unit Price | Amount |
|---|---|---|---|
| Hot Chocolate Stand (40776-1.1) | 1 | £5.00 | £5.00 |
| Bouquet of Pink Roses (10374-1.1) | 1 | £20.00 | £20.00 |
| The Wolf Stronghold (21261-1.1) | 1 | £5.00 | £5.00 |
| Sonic Game Watch | 1 | £5.00 | £5.00 |
| Barbie Game Watch | 1 | £5.00 | £5.00 |
| Mini Knights Castle (40775-1.2) | 1 | £20.00 | £20.00 |
| **Stock subtotal** | | | **£60.00** |
| Courier and delivery charges | — | — | £7.99 |
| Buying Fees | — | — | £15.00 |
| **Ancillary total** | | | **£22.99** |

Apportionment rate: `22.99 / 60.00 = 0.38317`

| Item | Purchase Price | Apportioned Cost | Landed Cost |
|---|---|---|---|
| Hot Chocolate Stand | £5.00 | £1.92 | £6.92 |
| Bouquet of Pink Roses | £20.00 | £7.66 | £27.66 |
| The Wolf Stronghold | £5.00 | £1.92 | £6.92 |
| Sonic Game Watch | £5.00 | £1.92 | £6.92 |
| Barbie Game Watch | £5.00 | £1.92 | £6.92 |
| Mini Knights Castle | £20.00 | £7.66 | £27.66 |
| **Totals** | **£60.00** | **£22.99** | **£82.99** |

> **Note**: Only ancillary costs that are direct to the stock purchase are apportioned (delivery, buying fees). General operating expenses (subscriptions, advertising, etc.) on pure expense purchases are NOT apportioned to stock units.

---

## 5. FIFO Stock Costing

### Principle

When a unit is sold, the cost of goods sold is the `landed_cost` of the **oldest** available unit of that SKU still in stock. "Oldest" is determined by `fifo_sequence` (assigned in acquisition order per `product_id`).

### Algorithm

```
ON sale_line INSERT (product_id, quantity):
  available_units = SELECT * FROM stock_unit
    WHERE product_id = sale_line.product_id
      AND status = 'in_stock'
    ORDER BY fifo_sequence ASC
    LIMIT quantity

  IF COUNT(available_units) < quantity:
    RAISE "Insufficient stock for FIFO allocation"

  FOR EACH unit IN available_units:
    UPDATE stock_unit SET status = 'sold',
                          sold_date = sale.txn_date,
                          sale_line_id = sale_line.id

    INSERT INTO sale_line_stock_unit (
      sale_line_id, stock_unit_id,
      unit_revenue = sale_line.unit_price,
      unit_cogs = unit.landed_cost,
      unit_gross_profit = sale_line.unit_price - unit.landed_cost
    )
```

### Weighted Average Cost (for reporting)

While FIFO governs actual COGS per sale, a weighted average cost per SKU is useful for inventory valuation:

```sql
SELECT
  product_id,
  sku,
  COUNT(*) AS units_in_stock,
  SUM(landed_cost) AS total_stock_value,
  AVG(landed_cost) AS weighted_avg_cost
FROM stock_unit
WHERE status = 'in_stock'
GROUP BY product_id, sku;
```

---

## 6. Payout Fee Linkage Rules

### How Payouts Work (from QBO data)

A Deposit in QBO represents a payout from a marketplace/payment processor. The Deposit's `Line[]` array contains:

- **Positive amounts**: `LinkedTxn` → `SalesReceipt` — the sales included in this payout
- **Negative amounts**: `LinkedTxn` → `Purchase` — fees/costs deducted before payout

The net deposit amount = sum of all lines (positive sales minus negative deductions).

### Fee Linkage Strategy

**Sale-level fees** (linkable to specific sales):

| Fee type | Linkage method | Rationale |
|---|---|---|
| **Selling fees** (per-sale commission) | Match purchase to sale within same payout by proportional amount, or by sequential pairing if 1:1 | eBay/Etsy charges a percentage per transaction |
| **Shipping labels** | Match purchase to sale within same payout — often eBay groups multiple labels in one purchase, each line ≈ one sale's postage | eBay shipping labels are deducted per-sale |
| **Stripe processing fees** | Match to sale in same payout by amount ratio (`fee / stripe_rate ≈ sale_amount`) | Stripe charges per transaction |

**Platform-level fees** (NOT linkable to individual sales):

| Fee type | Treatment |
|---|---|
| Advertising (Promoted Listings) | Period cost — allocate to the payout period, not to individual sales |
| Subscriptions | Period cost |
| Buying fees on stock purchases | Already apportioned to stock units via landed cost (§4) |

### Selling Fee Allocation to Multi-Item Sales

If a single sale contains multiple items and has one aggregate selling fee, the fee is apportioned to each sale line pro-rata by line amount:

```
For each sale_line in the sale:
  line_share = sale_line.amount / sale.subtotal
  allocated_selling_fee = total_selling_fee × line_share
```

### Payout Reconciliation Check

```sql
-- Every payout should balance:
SELECT
  p.id,
  p.net_amount AS deposited,
  SUM(psl.amount) AS gross_sales,
  SUM(pf.total_amount) AS total_fees,
  SUM(psl.amount) - SUM(pf.total_amount) AS calculated_net,
  p.net_amount - (SUM(psl.amount) - SUM(pf.total_amount)) AS discrepancy
FROM payout p
LEFT JOIN payout_sale_link psl ON psl.payout_id = p.id
LEFT JOIN payout_fee pf ON pf.payout_id = p.id
GROUP BY p.id, p.net_amount
HAVING ABS(p.net_amount - (SUM(psl.amount) - SUM(pf.total_amount))) > 0.01;
```

---

## 7. Data Flow Diagram

```
                    ┌─────────────────────────────┐
                    │     QBO Purchase (mixed)     │
                    │  Items: £60.00               │
                    │  Delivery: £7.99             │
                    │  Buying Fee: £15.00          │
                    └──────────┬──────────────────┘
                               │
                    ┌──────────▼──────────────────┐
                    │   Apportionment Engine       │
                    │   rate = 22.99/60.00         │
                    └──────────┬──────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
     ┌────────────┐   ┌────────────┐   ┌────────────┐
     │ Stock Unit │   │ Stock Unit │   │ Stock Unit │
     │ landed=6.92│   │ landed=27.66│  │ landed=6.92│
     │ FIFO seq=1 │   │ FIFO seq=2 │   │ FIFO seq=3 │
     └─────┬──────┘   └────────────┘   └─────┬──────┘
           │  FIFO picks oldest                │
           │  available unit                   │
     ┌─────▼──────┐                     ┌─────▼──────┐
     │   Sale     │                     │   Sale     │
     │ rev=£14.99 │                     │ rev=£9.99  │
     └─────┬──────┘                     └────────────┘
           │
     ┌─────▼──────────────────────────────────────┐
     │                    Payout                   │
     │  + Sale £14.99 (gross)                      │
     │  + Sale £9.99 (gross)                       │
     │  - Selling fee £2.38                        │
     │  - Shipping label £2.45                     │
     │  = Net deposit £20.15                       │
     └────────────────────────────────────────────┘

     Unit Profit (Stock Unit 1):
       Revenue:           £14.99 (ex-VAT)
       Landed cost:       -£6.92 (FIFO)
       Selling fee:       -£2.38 (from payout)
       Shipping:          -£2.45 (from payout)
       ─────────────────────────
       Net profit:         £3.24
       Margin:             21.6%
```

---

## 8. Key Queries

### Inventory Valuation (FIFO)

```sql
SELECT
  p.sku,
  p.name,
  COUNT(su.id) AS units_on_hand,
  SUM(su.landed_cost) AS total_value,
  MIN(su.landed_cost) AS lowest_fifo_cost,
  MAX(su.landed_cost) AS highest_fifo_cost,
  AVG(su.landed_cost) AS avg_landed_cost
FROM stock_unit su
JOIN product p ON p.id = su.product_id
WHERE su.status = 'in_stock'
GROUP BY p.sku, p.name
ORDER BY total_value DESC;
```

### Profit Per Sale

```sql
SELECT
  s.doc_number,
  s.txn_date,
  c.display_name AS customer,
  s.channel,
  sl.description AS item,
  slsu.unit_revenue,
  slsu.unit_cogs AS fifo_cost,
  slsu.unit_gross_profit,
  COALESCE(pfl_sell.amount, 0) AS selling_fee,
  COALESCE(pfl_ship.amount, 0) AS shipping_cost,
  COALESCE(pfl_bank.amount, 0) AS payment_fee,
  slsu.unit_gross_profit
    - COALESCE(pfl_sell.amount, 0)
    - COALESCE(pfl_ship.amount, 0)
    - COALESCE(pfl_bank.amount, 0) AS net_profit
FROM sale_line_stock_unit slsu
JOIN sale_line sl ON sl.id = slsu.sale_line_id
JOIN sale s ON s.id = sl.sale_id
JOIN customer c ON c.id = s.customer_id
LEFT JOIN payout_fee_line pfl_sell
  ON pfl_sell.linked_sale_id = s.id AND pfl_sell.fee_category = 'selling_fee'
LEFT JOIN payout_fee_line pfl_ship
  ON pfl_ship.linked_sale_id = s.id AND pfl_ship.fee_category = 'shipping_label'
LEFT JOIN payout_fee_line pfl_bank
  ON pfl_bank.linked_sale_id = s.id AND pfl_bank.fee_category = 'payment_processing'
ORDER BY s.txn_date DESC;
```

### Profitability by Channel

```sql
SELECT
  s.channel,
  COUNT(DISTINCT s.id) AS sales_count,
  SUM(slsu.unit_revenue) AS total_revenue,
  SUM(slsu.unit_cogs) AS total_cogs,
  SUM(slsu.unit_gross_profit) AS gross_profit,
  SUM(COALESCE(fees.selling_fee, 0)) AS total_selling_fees,
  SUM(COALESCE(fees.shipping_cost, 0)) AS total_shipping,
  SUM(COALESCE(fees.payment_fee, 0)) AS total_payment_fees,
  SUM(slsu.unit_gross_profit)
    - SUM(COALESCE(fees.total_fees, 0)) AS net_profit,
  ROUND(
    (SUM(slsu.unit_gross_profit) - SUM(COALESCE(fees.total_fees, 0)))
    / NULLIF(SUM(slsu.unit_revenue), 0) * 100, 1
  ) AS net_margin_pct
FROM sale s
JOIN sale_line sl ON sl.sale_id = s.id
JOIN sale_line_stock_unit slsu ON slsu.sale_line_id = sl.id
LEFT JOIN LATERAL (
  SELECT
    SUM(CASE WHEN fee_category = 'selling_fee' THEN amount ELSE 0 END) AS selling_fee,
    SUM(CASE WHEN fee_category = 'shipping_label' THEN amount ELSE 0 END) AS shipping_cost,
    SUM(CASE WHEN fee_category = 'payment_processing' THEN amount ELSE 0 END) AS payment_fee,
    SUM(amount) AS total_fees
  FROM payout_fee_line WHERE linked_sale_id = s.id
) fees ON TRUE
GROUP BY s.channel
ORDER BY net_profit DESC;
```

---

## 9. Mapping Rules: QBO → Schema

| QBO entity | Schema table | Key mapping |
|---|---|---|
| Item (Type=Inventory, AssetAccount=Stock Asset) | `product` | `Id` → `qbo_item_id`, `Sku` → `sku` |
| Purchase with ItemBasedExpenseLineDetail | `purchase_order` + `purchase_line` + `stock_unit` | One `stock_unit` per Qty unit |
| Purchase with AccountBasedExpenseLineDetail on stock purchase | `purchase_line` (expense) | Feeds apportionment calculation |
| Purchase linked from Deposit (account=Undeposited Funds) | `payout_fee` + `payout_fee_line` | Fee deducted from payout |
| SalesReceipt | `sale` + `sale_line` | Triggers FIFO stock allocation |
| RefundReceipt | `return` + `return_line` | Reverses stock allocation |
| Deposit | `payout` | Links sales + fees in a single settlement |
| Deposit.Line with LinkedTxn.TxnType=SalesReceipt | `payout_sale_link` | Sale included in payout |
| Deposit.Line with LinkedTxn.TxnType=Purchase | `payout_fee` | Fee deducted from payout |
| Vendor | `vendor` | `Id` → `qbo_vendor_id` |
| Customer | `customer` | `Id` → `qbo_customer_id` |

---

## 10. Implementation Notes

### Idempotency

Every table includes a `qbo_*_id` column to prevent duplicate imports. Processing is idempotent — re-running the import for the same QBO ID updates rather than duplicates.

### Edge Cases

1. **DLA-STOCK-CONSOL purchase** (Id=1733): A 94-item consolidated correction from the director. All items at cost, no ancillary expenses. Process normally — each item becomes a stock unit with `apportioned_ancillary_cost = 0`.

2. **Non-LEGO stock items**: The catalogue includes Apple products, Philips Hue, KitchenAid, etc. The schema handles all inventory items uniformly — the `sku` format differs (no MPN.grade pattern) but the lifecycle tracking is identical.

3. **Purchases within deposits that are stock acquisitions** (e.g. John Pye purchases linked from deposits with item lines like "The Endurance"): These are stock purchases paid via a marketplace account. They create both `stock_unit` records AND appear as `payout_fee` deductions. The `payout_fee_line.fee_category` should be "stock_purchase" and the buying fees/delivery within them still apportion to the stock units.

4. **Sales with discounts**: 4 sales have `DiscountLineDetail`. The discount reduces `net_revenue` in the profit calculation. Apply the discount pro-rata across sale lines when calculating per-unit revenue.

5. **Tax handling**: QBO uses both TaxInclusive and TaxExcluded modes. All schema amounts should be stored **ex-VAT** for consistency. Convert TaxInclusive amounts using the tax rate before storing.

6. **Refund to Undeposited Funds**: All 12 refunds deposit to Undeposited Funds, meaning they appear as negative amounts in a subsequent payout. The refund amount should be tracked against the original sale for accurate profit reporting.

7. **RefundReceipts linked from Deposits**: 7 refund receipts appear as linked transactions within deposits (alongside sales and fee purchases). The schema handles this via negative `payout_sale_link` amounts — or via a dedicated `payout_refund_link` table if cleaner separation is preferred.

8. **Direct deposit lines**: 51 deposit lines have no `LinkedTxn` — these are direct deposits (e.g. bank transfers, cash) not linked to QBO sales/purchases. They should be recorded as `payout` entries with `payout_provider = 'direct'`.

9. **Sales not yet in a deposit**: 34 sales receipts exist in QBO but are not linked from any deposit yet — these are in Undeposited Funds awaiting payout. The schema tracks them as sales with `payout_id = NULL` in `payout_sale_link`.

10. **Total stock units**: The 86 stock-related purchases (8 pure item + 78 mixed) would create approximately **708 individual stock unit records** based on line quantities.

11. **Item types**: Of 382 QBO items, 360 are `Inventory` type with Stock Asset account 66. The remaining 22 are `Group` (bundled items), `Service` (consulting hours), `Category` (organisation nodes), and `NonInventory` (non-tracked goods). Only `Inventory` items create `stock_unit` records.
