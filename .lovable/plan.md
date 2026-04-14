

# Fix: QBO Deposit Processing Not Populating Orders, Fees, or Counts

## Root Cause

The `processDeposits` function in `qbo-process-pending` has four gaps that explain why imported QBO deposits show no associated data in the UI:

1. **`order_count` and `unit_count` never set** — The function creates `payout_orders` links but never updates the payout record's `order_count` or `unit_count` (they remain 0).

2. **Fees not calculated** — Both `gross_amount` and `net_amount` are set to `TotalAmt` (identical). The function never separates the positive SalesReceipt lines (gross revenue) from the negative Purchase lines (fees/expenses), so `total_fees` stays 0.

3. **Purchase lines ignored** — Line 1452 skips any line where `TxnType !== "SalesReceipt"`, so negative expense lines (`TxnType: "Purchase"`) are never processed. No fee breakdown is captured.

4. **Stock units not linked** — The function never sets `payout_id` on `stock_unit` records for the linked orders, nor transitions eligible units to `payout_received`.

## Fix — Enhance `processDeposits` in `supabase/functions/qbo-process-pending/index.ts`

### Change 1: Calculate gross, fees, and net from deposit lines

Instead of using `TotalAmt` for both gross and net, iterate the deposit lines and sum:
- **Positive amounts** from `SalesReceipt` lines → `gross_amount`
- **Negative amounts** from `Purchase` lines → `total_fees` (absolute value)
- `net_amount` = `gross_amount` - `total_fees` (should equal `TotalAmt`)

### Change 2: Process Purchase lines (expenses)

Remove the `SalesReceipt`-only filter. For `Purchase`-linked lines, look up the QBO Purchase by ID in `inbound_receipt` (or at minimum record the expense amount). This captures the fee side of the deposit.

### Change 3: Update `order_count` and `unit_count` after linking

After processing all deposit lines, count the `payout_orders` created and query `stock_unit` for linked orders:

```ts
// After all lines processed:
const orderCount = salesOrderIds.length;
const { count: unitCount } = await admin.from("stock_unit")
  .select("id", { count: "exact", head: true })
  .in("order_id", salesOrderIds);

await admin.from("payouts").update({
  order_count: orderCount,
  unit_count: unitCount ?? 0,
  gross_amount: grossTotal,
  total_fees: Math.round(feesTotal * 100) / 100,
  net_amount: Math.round((grossTotal - feesTotal) * 100) / 100,
  updated_at: new Date().toISOString(),
}).eq("id", payoutId);
```

### Change 4: Link stock units to payout

Set `payout_id` on stock units for linked orders and transition eligible ones:

```ts
if (salesOrderIds.length > 0) {
  await admin.from("stock_unit")
    .update({ payout_id: payoutId })
    .in("order_id", salesOrderIds)
    .is("payout_id", null);

  await admin.from("stock_unit")
    .update({ v2_status: "payout_received", payout_id: payoutId })
    .in("order_id", salesOrderIds)
    .in("v2_status", ["sold", "shipped", "delivered"]);
}
```

### Change 5: Populate `payout_orders` fee data per order

For each SalesReceipt-linked order, calculate its share of fees from the Purchase lines (or distribute proportionally by gross) and set `order_fees` and `order_net` on the `payout_orders` row.

## Scope

- **File**: `supabase/functions/qbo-process-pending/index.ts` — rewrite `processDeposits` function (~lines 1385–1481)
- **Redeploy**: `qbo-process-pending` edge function
- No database migrations needed
- No frontend changes needed (the UI fallback table from the previous fix will display the now-populated data)

## Post-fix: Re-process existing deposits

After deploying, reset the QBO-imported deposits back to `pending` and re-process them:
```sql
UPDATE landing_raw_qbo_deposit SET status = 'pending', processed_at = NULL WHERE status = 'committed';
```
Then trigger "Sync Deposits" from the QBO Settings Card to re-run the processor.

