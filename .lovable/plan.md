

# Enhance In-Person Draft Order Editing

## What this does
When a Stripe tap-to-pay payment creates a draft order, the current "Add Items & Complete" modal is limited — you can only add line items and submit. This plan adds full editing capabilities: view the Stripe sale note, split payment between card and cash, add discounts, and flag Blue Bell donations.

## Changes

### 1. Enhance CompleteOrderModal with new fields

**File**: `src/components/admin-v2/CompleteOrderModal.tsx`

Add these controls to the modal:

- **Stripe Note display** — Already partially working (memo extraction from `description=` in notes). Make it more prominent and show the raw Stripe description directly (it's already stored in the order notes as `description=31173`).

- **Split Payment section** — Two inputs:
  - "Card (Stripe)" — pre-filled with the Stripe `grossTotal`, editable downward
  - "Cash" — auto-calculates as `lineTotal - cardAmount`
  - Store the card amount via the existing `payment_reference` (Stripe PI) and add `payment_method: "split"` when cash portion > 0
  - On save, update `gross_total` to the full line total (card + cash), keep `payment_reference` for the Stripe portion

- **Discount field** — A single numeric input for discount amount (gross, VAT-inclusive). Deducted from line total before comparing against payment. Saved to `discount_total` on the order.

- **Blue Bell donation toggle** — A checkbox/switch that sets `blue_bell_club: true` on the order. Already exists as a column.

### 2. Update order save logic in the mutation

**File**: `src/components/admin-v2/CompleteOrderModal.tsx`

When saving, the mutation currently uses the Stripe `grossTotal` as authoritative. Change to:
- `gross_total` = line total − discount + cash portion (full sale value)
- `discount_total` = discount amount entered
- `payment_method` = "card" if no cash, "split" if cash portion > 0
- `blue_bell_club` = toggle value
- `notes` = append cash amount info if split payment
- Recalculate `merchandise_subtotal`, `tax_total`, `net_amount` from the new gross total

### 3. Add cash amount to sales_order (no schema change needed)

The existing `notes` field can record the cash portion, and `payment_method` already supports arbitrary strings. No new columns required. The split is:
- `payment_reference` = Stripe PI (card portion tracking)  
- `gross_total` = full sale amount  
- `discount_total` = any discount applied  
- `notes` = includes `cash_amount=X.XX` for audit

### 4. Show Stripe note on OrderDetail page

**File**: `src/components/admin-v2/OrderDetail.tsx`

For `in_person` orders, extract and display the Stripe description from the notes field in the order header area (already stored as `description=31173`).

## No database migrations needed

All fields already exist: `discount_total`, `blue_bell_club`, `payment_method`, `notes`, `gross_total`.

## Summary of UI additions to CompleteOrderModal

```text
┌─────────────────────────────────────┐
│ Complete Order KO-0009642           │
├─────────────────────────────────────┤
│ Payment Summary                     │
│   £17.00  Stripe in-person payment  │
│   Customer: Cash Sales              │
│   Stripe Note: 31173                │
├─────────────────────────────────────┤
│ Line Items                          │
│   [SKU picker] [Price] [Qty] [x]    │
│   + Add line                        │
├─────────────────────────────────────┤
│ Payment Split                       │
│   Card (Stripe): [£17.00]           │
│   Cash:          [£0.00]            │
├─────────────────────────────────────┤
│ Discount: [£0.00]                   │
│ ☐ Includes Blue Bell donation       │
├─────────────────────────────────────┤
│ Line total:  £X.XX                  │
│ Discount:   -£X.XX                  │
│ Net total:   £X.XX                  │
│ Card:        £17.00                 │
│ Cash:        £X.XX                  │
├─────────────────────────────────────┤
│           [Cancel] [Complete Order] │
└─────────────────────────────────────┘
```

