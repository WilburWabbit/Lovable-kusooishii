

# Fix: Payout Net Amount Overwrite + Channel Card Safeguards

## Root Cause

`qbo-process-pending` (line 1462) overwrites `payouts.net_amount` with the QBO deposit total every time it processes. When the deposit was created without the TRANSFER line, it wrote 188.67 back into the payout record, replacing the correct eBay-sourced 222.06.

## Changes

### 1. Prevent QBO from overwriting eBay-sourced payout amounts — `qbo-process-pending/index.ts`

When updating an existing payout that already has an `external_payout_id` (i.e. it came from eBay import), do NOT overwrite `gross_amount`, `total_fees`, or `net_amount`. The eBay import is the source of truth for those values. Only update `qbo_deposit_id`, `reconciliation_status`, `notes`, and `updated_at`.

### 2. Fix the corrupted data — migration

Run an UPDATE to recalculate `net_amount` for payout `7388684270` from its `ebay_payout_transactions`:
```sql
UPDATE payouts SET 
  net_amount = 222.06,
  gross_amount = 300.89,
  total_fees = 78.83
WHERE external_payout_id = '7388684270';
```
(Fees = 300.89 - 222.06 = 78.83 — only the selling fees on SALE transactions, not subscription/insertion)

Actually, let me recalculate properly. The payout record should reflect the eBay payout totals as eBay reports them. I'll compute from the transaction data to get the correct values.

### 3. Add eBay-computed total to the Channel Detail card — `PayoutDetail.tsx`

Compute the "eBay Payout Total" from summing all transaction `net_amount` values (with appropriate signs: SALE/TRANSFER positive, SHIPPING_LABEL/NON_SALE_CHARGE negative). Display it on the channel card alongside:

- **eBay Total**: computed from transactions
- **DB Net Amount**: from the payout record  
- If they differ: show both in red with the difference
- **QBO Deposit ID**: show when `qbo_deposit_id` is set, with the synced status

### 4. Recompute correct totals from transactions — `PayoutDetail.tsx`

```text
eBay payout net = Σ SALE.net - Σ SHIPPING_LABEL.net - Σ NON_SALE_CHARGE.net + Σ TRANSFER.net
```

For this payout: 256.34 - 34.16 - 32.52 + 32.40 = **222.06**

## Scope

| File | Change |
|------|--------|
| `supabase/functions/qbo-process-pending/index.ts` | Skip overwriting amounts on eBay-sourced payouts |
| `src/components/admin-v2/PayoutDetail.tsx` | Add eBay total, mismatch flag, QBO deposit ID to channel card |
| Migration | Fix corrupted net_amount for payout 7388684270 |
| Redeploy | `qbo-process-pending` |

## Technical Detail

**Channel card additions:**
- New row: "eBay Total" — computed client-side from transactions
- New row: "QBO Deposit" — shows `qbo_deposit_id` when present  
- Mismatch detection: if `|ebayTotal - payout.netAmount| > 0.01`, highlight both in red with the difference shown

**qbo-process-pending guard** (around line 1457-1466):
```typescript
if (existingPayout) {
  payoutId = existingPayout.id;
  // Check if this payout was sourced from eBay — don't overwrite amounts
  const { data: currentPayout } = await admin.from("payouts")
    .select("external_payout_id").eq("id", payoutId).single();
  
  const updatePayload: Record<string, unknown> = {
    qbo_deposit_id: qboDepositId,
    reconciliation_status: "reconciled",
    notes: memo,
    updated_at: new Date().toISOString(),
  };
  
  // Only overwrite amounts if NOT eBay-sourced
  if (!currentPayout?.external_payout_id) {
    updatePayload.payout_date = txnDate;
    updatePayload.gross_amount = grossTotal;
    updatePayload.total_fees = Math.round(feesTotal * 100) / 100;
    updatePayload.net_amount = netAmount;
    updatePayload.channel = channel;
  }
  
  await admin.from("payouts").update(updatePayload).eq("id", payoutId);
}
```

