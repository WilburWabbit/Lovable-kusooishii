

## Fix: Remove `carrying_value` from stock_unit insert

The edge function logs show every auto-process attempt fails with:

> `Column "carrying_value" is a generated column — cannot insert a non-DEFAULT value`

The `carrying_value` column on `stock_unit` is a database-generated column (likely computed from `landed_cost`). The `autoProcessReceipt` function in `qbo-sync-purchases` explicitly sets `carrying_value: landedCost` in the insert, which Postgres rejects.

### Fix

In `supabase/functions/qbo-sync-purchases/index.ts`, remove `carrying_value` from the `stock_unit` insert object in the `autoProcessReceipt` function (around the `stockUnits.push` block):

```typescript
// Before
stockUnits.push({
  sku_id: sku!.id,
  mpn: product.mpn,
  condition_grade: conditionGrade,
  status: "received",
  landed_cost: landedCost,
  carrying_value: landedCost,  // ← remove this line
  supplier_id: vendorName ?? null,
});

// After
stockUnits.push({
  sku_id: sku!.id,
  mpn: product.mpn,
  condition_grade: conditionGrade,
  status: "received",
  landed_cost: landedCost,
  supplier_id: vendorName ?? null,
});
```

The database will auto-compute `carrying_value` from `landed_cost`. No other changes needed.

