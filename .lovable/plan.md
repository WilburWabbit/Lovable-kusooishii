

## Fix: Pricing Calculation Edge Function Timeout

### Problem
The `calculate-pricing` action in the `admin-data` edge function makes 6 sequential database queries, which combined with the large function file (1043 lines), exceeds the Edge Function CPU time limit. The logs show repeated boot/shutdown cycles with no error output — the classic sign of a worker being killed for exceeding the 2-second CPU limit.

### Solution
Parallelize the independent database queries in the `calculate-pricing` action. Currently queries run one after another; after the first query (SKU+product), the remaining 5 queries (defaults, stock, shipping rates, fees, BrickEconomy) can all run simultaneously via `Promise.all`.

### Changes

**File: `supabase/functions/admin-data/index.ts`** (lines ~670-763)

Refactor the calculate-pricing action to run queries 2-6 in parallel after query 1:

```typescript
// 1. Get SKU + product info (needs to run first — others depend on its results)
const { data: skuData } = await admin.from("sku")...

// 2-6. Run remaining queries in parallel
const [defaultsRes, stockRes, ratesRes, feesRes, beRes] = await Promise.all([
  admin.from("selling_cost_defaults").select("key, value"),
  admin.from("stock_unit").select("carrying_value").eq("sku_id", sku_id).eq("status", "available"),
  admin.from("shipping_rate_table").select("*").or(...).eq("active", true).gte(...).order(...),
  admin.from("channel_fee_schedule").select("*").eq("channel", channel).eq("active", true),
  // BrickEconomy lookup (conditional on mpn)
  mpn ? admin.from("brickeconomy_collection").select("current_value").in("item_number", candidates).limit(1).maybeSingle() : Promise.resolve({ data: null }),
]);
```

This reduces 6 sequential round-trips to 2 (1 + parallel batch), cutting wall-clock and CPU time by ~60%.

### Impact
- No schema changes needed
- No frontend changes needed
- Same inputs/outputs — purely an internal optimization

