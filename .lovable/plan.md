

# Fix: Allow Cash Sales to Allocate Graded (Unlisted) Stock

## Problem

The cash sale form calls `v2_consume_fifo_unit`, which only matches stock units with `v2_status = 'listed'`. The items you tried to sell (SKU `75682-1.1`) have 2 units in `graded` status — they were graded but never listed on any channel. The FIFO function raises an exception, the catch block sets `allAllocated = false`, and the order ends up with `v2_status: needs_allocation`.

This is a workflow gap: in-person sales should be able to consume graded stock, not just listed stock.

## Solution

Modify the `v2_consume_fifo_unit` database function to accept both `graded` and `listed` units, preferring `listed` first (since those are already advertised and priced), then falling back to `graded`. This is the correct fix because:

- The function is already used by `v2-process-order` (edge function) and `useAllocateOrderItems` (manual allocation hook) — all callers benefit from the same fix
- Graded units are saleable inventory; the only reason they aren't listed is timing
- The lifecycle transition `graded → sold` is valid (it just skips the `listed` step)

## Changes

### 1. Database migration: Update `v2_consume_fifo_unit`

Replace the WHERE clause to match both statuses with a preference order:

```sql
CREATE OR REPLACE FUNCTION public.v2_consume_fifo_unit(p_sku_code text)
RETURNS public.stock_unit
LANGUAGE plpgsql
AS $$
DECLARE v_unit public.stock_unit;
BEGIN
  SELECT su.* INTO v_unit
  FROM public.stock_unit su
  JOIN public.sku sk ON sk.id = su.sku_id
  WHERE sk.sku_code = p_sku_code
    AND su.v2_status IN ('listed', 'graded')
  ORDER BY
    CASE su.v2_status WHEN 'listed' THEN 0 ELSE 1 END,
    su.created_at ASC
  LIMIT 1
  FOR UPDATE OF su;

  IF v_unit.id IS NULL THEN
    RAISE EXCEPTION 'No available stock units for SKU %', p_sku_code;
  END IF;

  UPDATE public.stock_unit
  SET v2_status = 'sold', sold_at = now()
  WHERE id = v_unit.id;

  RETURN v_unit;
END;
$$;
```

**Key changes:**
- `v2_status = 'listed'` → `v2_status IN ('listed', 'graded')`
- Added `ORDER BY CASE` to prefer listed units over graded ones
- Updated error message from "No listed stock units" to "No available stock units"

### 2. No frontend changes needed

The `CashSaleForm.tsx` allocation logic is correct — it calls the RPC, handles failures gracefully, and sets the order status accordingly. Once the DB function accepts graded units, existing cash sales will work.

## Immediate fix for KO-0009628

After deploying the migration, you can use the existing "Allocate Items" dialog on the order detail page to manually allocate the units. Alternatively, we could add a one-time fix to re-run allocation for that order.

## Files changed

| File | Change |
|------|--------|
| **Migration** | Update `v2_consume_fifo_unit` to accept `graded` and `listed` units |

