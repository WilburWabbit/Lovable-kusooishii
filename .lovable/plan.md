

# Sync QBO Deposits to App — Standalone Trigger

## Summary
Add a "Sync Deposits" button to the QBO Settings Card that independently pulls all QBO Deposit records into the app via the existing land-and-process pipeline. This lets you import new deposits without running a full rebuild, and inspect how QBO structures deposit payloads to debug the outbound push.

## What already exists
- **`qbo-sync-deposits`** edge function — lands all QBO Deposit records into `landing_raw_qbo_deposit` (97 already committed)
- **`qbo-process-pending`** — processes pending deposits into `payouts` + `payout_orders` tables, linking deposit lines to sales orders via QBO SalesReceipt IDs
- Both functions are fully operational; they just lack a standalone UI trigger

## Plan

### 1. Add "Sync Deposits" button to QboSettingsCard
**File:** `src/components/admin-v2/QboSettingsCard.tsx`

- Add `syncingDeposits` state variable
- Add a button (alongside existing Sync Purchases, Sync Sales, etc.) that:
  1. Calls `invokeWithAuth('qbo-sync-deposits')` to land raw deposits
  2. Calls `invokeWithAuth('qbo-process-pending')` to process any newly landed deposits
  3. Toasts the result (landed count, processed count, errors)
- Disable during `anyBusy`

### 2. No backend changes needed
The edge functions already exist and work correctly. No new tables, migrations, or RLS changes required.

## Technical detail
The button handler will be ~15 lines:
```ts
async function handleSyncDeposits() {
  setSyncingDeposits(true);
  try {
    const landRes = await invokeWithAuth('qbo-sync-deposits');
    toast.info(`Landed ${landRes.landed} deposits (${landRes.skipped} unchanged)`);
    const procRes = await invokeWithAuth('qbo-process-pending');
    toast.success(`Processed deposits: ${procRes.deposits?.processed ?? 0} OK, ${procRes.deposits?.errors ?? 0} errors`);
  } catch (e: any) {
    toast.error(e.message);
  } finally {
    setSyncingDeposits(false);
  }
}
```

