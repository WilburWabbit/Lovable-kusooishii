

# Fix QBO Sales Receipt Processing — Blocked by Function Overload

## Problem

Sales receipts (1795, 1796) are stuck as `pending` and never processed. The root cause is a cascading blockage:

1. **17 pending purchases** are blocking Tier 3 (sales receipts) because the processor uses strict tiered dependency ordering
2. Purchases fail to complete because `ensure_product_exists` has **3 ambiguous overloads** in the database (4-arg, 8-arg, 10-arg). PostgreSQL cannot disambiguate between them when called with `(p_mpn, p_brand, p_item_type, p_name)`
3. The fallback (direct lookup) works but is slow — the processor times out ("connection closed before message completed") before finishing all 17 purchases
4. Until purchases are fully drained, the tiered logic never reaches sales receipts

## Fix

### Step 1: Database migration — Drop redundant function overloads

Drop the 4-arg and 8-arg versions, keeping only the 10-arg version (which has all parameters including `p_brand` and `p_item_type`):

```sql
DROP FUNCTION IF EXISTS public.ensure_product_exists(text, text, text, text);
DROP FUNCTION IF EXISTS public.ensure_product_exists(text, text, uuid, text, integer, integer, boolean, text);
```

This leaves only the 10-arg version, which the RPC call already matches (it has `p_mpn`, `p_brand`, `p_item_type`, `p_name` plus optional extras).

### Step 2: Redeploy `qbo-process-pending`

No code changes needed — the existing RPC call with `{p_mpn, p_brand, p_item_type, p_name}` will now unambiguously match the remaining 10-arg function (other params use defaults).

### Expected Result

- Purchases process without the ambiguity warning or fallback delay
- 17 pending purchases clear quickly
- Tier 3 unlocks, and the 2 pending sales receipts (1795, 1796) get processed

