
## Diagnosis

Do I know what the issue is? Yes.

There are two separate problems, and only one is a code bug:

1. **The “dist upload failed / R2 temp credentials timeout” is a transient publish/infrastructure timeout**, not a code error. Retrying publish usually clears that.
2. **The real app bug is in `qbo-sync-payout`**: the code now assumes a Deposit line can link to a QBO `SalesReceipt` or `Purchase` and still force a different `Amount`. In practice, QBO totals the Deposit from the **linked document totals**, not the overridden line amount.

That means:
- your stale `SalesReceipt 1668` is still sitting in QBO at **£14.99**
- the app expects the canonical sale to be **£15.99**
- the Deposit therefore lands **£1 short**
- current code then aborts on the Deposit total mismatch

So the failure is not “simple arithmetic gone wrong” anymore. It is:
- a **stale bad SalesReceipt**
- plus a **wrong assumption about how linked Deposit lines behave in QBO**

## What I will change

### 1. Fix SALE handling to use the canonical sale record only
In `supabase/functions/qbo-sync-payout/index.ts`:

- For every SALE transaction with an existing `qbo_sales_receipt_id`, fetch:
  - the linked QBO SalesReceipt `TotalAmt`
  - the canonical sale gross from `sales_order_line.unit_price × quantity`
- Compare **only those two values**
- Do **not** compare against:
  - payout transaction gross
  - current product price
  - current listing price

If the existing QBO SalesReceipt is stale/wrong:
- auto-delete the bad SalesReceipt in QBO
- clear the stale local link
- recreate it from the canonical order lines using `qbo-sync-sales-receipt`
- reuse the existing 3-attempt rounding-repair loop

If it still cannot land after retries:
- skip that SALE transaction
- mark payout `partial`
- continue the payout instead of hard-failing everything

### 2. Stop assuming linked Deposit lines can “override” document totals
Still in `qbo-sync-payout/index.ts`:

- Build linked Deposit lines using the **actual fetched QBO totals** for linked SalesReceipts and Purchases
- Treat those lines as **clearing lines only**
- After summing them, compute the remaining delta to the payout net
- Add a separate unlinked line:
  - `Description: "Payout settlement adjustment"`
  - amount = exact residual delta
  - account = configurable payout-adjustment mapping if available, otherwise fail safely with a clear message rather than silently misposting

This keeps the accounting explicit:
- linked docs clear the exact QBO documents
- settlement drift is shown as a separate adjustment
- the deposit can still land cleanly

### 3. Keep the retry-and-skip behavior
I will retain the existing 3-attempt loop for:
- Purchases
- SalesReceipts

If a single doc still refuses to match after 3 attempts:
- skip only that transaction
- persist `qbo_sync_error`
- let the payout finish as `partial`

### 4. Surface the real reason in the UI
In `src/components/admin-v2/PayoutDetail.tsx`:

- show when a payout contains:
  - skipped transactions
  - a payout settlement adjustment
  - stale SalesReceipt/Purchase self-healing attempts
- make it obvious whether the payout is:
  - fully synced
  - partial
  - blocked by missing adjustment-account mapping

## Why this matches your business rule

This restores the rule you stated:

- the **sale record for that moment in time** is canonical
- the app must mirror **that sale**, not today’s fluctuating price
- payout settlement is a separate cash event and should be reconciled at the **deposit level**, not used to rewrite or veto the sale

So:
- SalesReceipt correctness comes from `sales_order` + `sales_order_line`
- payout cash differences are handled as deposit reconciliation
- current catalog prices stay irrelevant

## Files to update

- `supabase/functions/qbo-sync-payout/index.ts`
  - detect stale linked SalesReceipts
  - self-heal bad receipts before deposit
  - compute deposit from actual linked doc totals
  - add explicit payout-adjustment line
- `supabase/functions/qbo-sync-sales-receipt/index.ts`
  - keep canonical-order-only total logic
  - expose clearer retry failure info for payout caller
- `src/components/admin-v2/PayoutDetail.tsx`
  - show adjustment/skipped/self-healed status clearly

No DB migration required.

## Repair plan for the stuck payout after code changes

For payout `060ee447-02f7-4527-84a4-95aedecd0daa`, after implementation I will clean up the bad accounting state before retrying:

1. delete bad QBO Deposit `2206`
2. delete bad QBO SalesReceipt `1668`
3. clear the stale local QBO IDs/status for that payout and affected order
4. re-run payout sync

Expected result:
- SalesReceipt is recreated from the canonical sale amount
- Deposit lands at the payout total
- if anything still refuses to match after retries, payout completes as `partial` instead of blocking everything

## Note on the publish error

The Cloudflare/R2 timeout is not the bug here. After the code fix, frontend publish may simply need to be retried if that timeout happens again.
