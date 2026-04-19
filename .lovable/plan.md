

## Issue

A large number of payouts already have a `qbo_deposit_id` (e.g., 1835, 1859, 1677, 1608…) — these deposits exist in QBO and were back-ingested via `qbo-process-pending` rather than created by the app. But their `qbo_sync_status` is stuck at `'pending'`, so:

- The Payouts list/Detail UI shows "QBO Pending" badges for payouts that are in fact already in QBO
- The "Sync to QBO" button is offered for payouts that already have a deposit
- Operators can't tell at a glance which payouts genuinely need work

The UI logic in `PayoutDetail.tsx` already prefers the "deposit exists" signal in some places (`payout.qboDepositId &&`) but the `qboSyncStatus` field — used for badges and gating — was never reconciled.

## Fix — three small changes, no schema change

### 1. Backfill: mark all payouts with an existing `qbo_deposit_id` as synced

One-off SQL repair against `payouts`:

```sql
UPDATE payouts
SET qbo_sync_status = 'synced',
    qbo_sync_error = NULL
WHERE qbo_deposit_id IS NOT NULL
  AND qbo_sync_status = 'pending';
```

This brings the ~30 stuck rows in line with reality. No effect on rows already `synced`, `error`, or `partial`, and no effect on rows where `qbo_deposit_id IS NULL` (those genuinely need syncing).

Excludes the one in-flight payout `2a3b0be6-…` (Stripe payout `po_1TLY2QHDItV5mfAy1M1NtzCC`) which has no deposit yet — it correctly stays `pending`.

### 2. `qbo-process-pending/index.ts` — set status when ingesting a pre-existing QBO deposit

In the existing block (~line 1453) where the function inserts/updates a `payouts` row from a QBO deposit it found in QBO:

- On both the `INSERT` path (new payout discovered from QBO) and the `UPDATE` path (existing payout matched by `qbo_deposit_id`), set:
  - `qbo_sync_status = 'synced'`
  - `qbo_sync_error = null`

This prevents the same drift from recurring on the next QBO ingestion.

### 3. `qbo-sync-payout/index.ts` — when the existing-deposit lookup finds a match, persist `qbo_sync_status='synced'` immediately

In the block at line 1576–1587 (existing deposit found by `DocNumber`), after capturing `qboDepositId` and `qboDepositTotal` from the QBO query response, also persist `qbo_sync_status='synced'` so future page loads reflect reality even if the user closes the tab before the function reaches the line 1681 status-write.

This is defensive: the function already writes the final status at line 1681, but if anything between detection and final write throws, the payout would be left as `pending` despite being correctly linked to QBO. Persisting on detection makes the UI state monotonic and accurate.

No change needed to the verification logic at lines 1622–1664 — that already correctly downgrades to `error` if `TotalAmt` mismatches.

## Explicitly NOT changed

- Status enum (`pending | synced | partial | error | needs_manual_review`) — unchanged
- `qbo-sync-payout` core deposit-creation flow, repair loop, VAT logic — untouched
- `payouts` schema — no migration
- The "Sync to QBO" button visibility logic in `PayoutDetail.tsx` — already correct (line 694 also checks `qboReadiness.unsyncedOrders/pendingExpenses`, so it'll still surface when sales receipts or expenses are missing even after the payout is "synced")

## Files

- One-off `UPDATE payouts SET qbo_sync_status='synced'` for rows with existing `qbo_deposit_id`
- `supabase/functions/qbo-process-pending/index.ts` — set `qbo_sync_status='synced'` on insert/update of payouts created from existing QBO deposits
- `supabase/functions/qbo-sync-payout/index.ts` — write `qbo_sync_status='synced'` immediately when an existing QBO deposit is detected by `DocNumber`

## Verification after deploy

```sql
SELECT qbo_sync_status, COUNT(*), COUNT(qbo_deposit_id) FILTER (WHERE qbo_deposit_id IS NOT NULL)
FROM payouts GROUP BY 1;
```

Expected: every row with a `qbo_deposit_id` is `synced`, `partial`, or `error` — never `pending`.

