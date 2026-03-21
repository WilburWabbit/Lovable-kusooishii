

## Fix: Reorder Processing Sequence + Add Stock Adjustments

### Why the current order is wrong

The current order is: Items → Purchases → Sales → Refunds → Customers

But sales processing (line 662) looks up `customer_id` from the `customer` table. If customers haven't been committed yet, the lookup returns null, and the order gets created without a customer link. The customer processor then tries to backlink, but this is fragile and unnecessary if customers are simply processed first.

Correct dependency chain:
1. **Customers** — no dependencies, referenced by sales orders
2. **Items** — no dependencies, referenced by purchases and sales (SKU resolution)
3. **Purchases** — depends on items/SKUs for stock unit creation
4. **Sales** — depends on items (SKU lookup) + purchases (stock allocation) + customers (customer_id)
5. **Refunds** — depends on sales (refund references)
6. **Stock Adjustments** — not currently handled; QBO Inventory Quantity Adjustment entities that adjust stock without a purchase or sale

### Changes

**File: `supabase/functions/qbo-process-pending/index.ts`**

1. **Reorder the main handler** (lines 962-976): Move customers first, then items, purchases, sales, refunds.

2. **Enforce tiered processing** (from the previously approved plan): When running without `entity_type` filter, only process the current tier — don't start sales until all items AND purchases are done. Sequence:
   - Tier 1: Customers + Items (no dependencies between them, can run in same batch)
   - Tier 2: Purchases (only if no pending customers/items remain)
   - Tier 3: Sales + Refunds (only if no pending purchases remain)

3. **Remove customer backlinking logic** (lines 900-909): Since customers are now processed before sales, the `customer_id` will always be resolved at insert time. The backlink code becomes dead code.

### Stock Adjustments — deferred

QBO Inventory Quantity Adjustments aren't currently landed by any sync function. Adding them requires:
- A new landing table or reusing `landing_raw_qbo_item` with an entity_type discriminator
- Landing logic in `qbo-sync-items` or a new `qbo-sync-adjustments` function
- Processing logic to create/delete stock units based on adjustment direction

This is a separate piece of work and should be tackled after the current rebuild is verified working correctly. I'll note it for follow-up.

### Files Modified

- `supabase/functions/qbo-process-pending/index.ts` — reorder to Customers → Items → Purchases → Sales → Refunds; add tier gating; remove backlink code

