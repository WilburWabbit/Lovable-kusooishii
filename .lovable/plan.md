

# Fix: Purchase batch creation still leaves orphan batches (PO-668)

## What broke (again)

PO-668 was created at 12:19:30 with 9 line items, then the hook silently failed somewhere between line-items and stock_units. The "rollback" `try/catch` we added last round did NOT clean up — header + 9 line items + 9 products are still in the database, 0 SKUs, 0 stock units. The user saw a generic toast and the half-created batch is now sitting in the Purchases list.

Confirmed in DB:
- `purchase_batches` PO-668: status `draft`, unit_counter 0
- `purchase_line_items`: 9 rows for batch PO-668
- `product`: 9 rows created at 12:19:30–33 (one per MPN)
- `sku`: **0 rows for these MPNs**
- `stock_unit`: **0 rows for batch PO-668**

The line items include several non-LEGO MPNs (`38881`, `PO702`, `TIP0284GRNONE`, `ricardo`, `B0F5B3VGFN`) — these are valid (consumables / raw materials in a mixed John Pye lot) and not the cause.

## Root causes

1. **Multi-step client-side write with no real transaction.** The hook does 8+ sequential `supabase.from(...)` calls. If any one fails, the previous ones are already committed. The `try/catch` rollback uses 3 more network calls that are themselves subject to RLS, network errors, and the same `as never` typing fragility — and we have no logs proving they ran. PO-668 still being present is proof they didn't.

2. **Errors swallowed by destructuring.** Lines 309 and 337 destructure `data` but discard `error`:
   ```ts
   let { data: product } = await supabase.from('product').select('id')...
   let { data: sku } = await supabase.from('sku').select('id')...
   ```
   A failed select returns `data: null, error: <something>` — the code then assumes "row doesn't exist" and tries to insert. If the insert later fails for an unrelated reason, the user has no diagnostic and we don't know whether the select or insert was the real culprit.

3. **Rollback can't be trusted from the client.** Even if we capture errors better, the rollback still runs as 3 separate network calls with no guarantee they all succeed (RLS, network drop, concurrent edits). The only reliable way is one server-side transaction.

4. **`condition_grade` enum may reject the placeholder grade `'5'` when `saleable_flag=false`.** This isn't the root cause for PO-668 (no constraint enforces this), but the design uses grade 5 as a sentinel which has knock-on effects elsewhere (listings hooks filter on grade ≠ 5; pricing logic skips grade 5). Worth a small assertion test.

5. **No diagnostic surface.** The only way we found PO-667 / PO-668 was by querying the DB directly. There's no audit_event row written, no staging row, nothing. Repeated incidents are invisible until a human notices.

## The fix

### 1. Move the entire create into one SECURITY DEFINER RPC (real transaction)

New migration: `v2_create_purchase_batch(p_input jsonb) returns jsonb`.

Inside one BEGIN/COMMIT it:

1. Inserts the `purchase_batches` row, returning the new batch id (continues to use the existing `PO-NNN` sequence — read max id + 1, or reuse whatever the current `id` default is).
2. Inserts all `purchase_line_items` in a single statement.
3. For each unique MPN: `INSERT … ON CONFLICT (mpn) DO NOTHING` into `product`, then `INSERT … ON CONFLICT (sku_code) DO NOTHING` into `sku` for `<mpn>.5` with `saleable_flag=false, active_flag=true, condition_grade='5'`. `RETURNING id` resolves to the existing or new row in both cases.
4. Calls `v2_reserve_stock_unit_uids(batch_id, total_units)` (already exists).
5. Bulk inserts all `stock_unit` rows with `sku_id`, `condition_grade='5'`, `uid`, `landed_cost`, `mpn`, `batch_id`, `line_item_id`, `v2_status='purchased'`, `status='pending_receipt'`.
6. Calls `v2_calculate_apportioned_costs(batch_id)`.
7. Writes one `audit_event` row of category `purchase_batch_created` with input + output payloads.
8. Returns `{ batch_id, line_item_count, unit_count }`.

Any error → automatic transaction rollback → nothing persists. No orphan batches possible.

Permissions: grant execute to `authenticated`. Inside the function, assert `has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff')` and raise if not.

### 2. Replace the client hook body with a single RPC call

`useCreatePurchaseBatch` becomes ~15 lines:

```ts
const { data, error } = await supabase.rpc('v2_create_purchase_batch', { p_input: input });
if (error) throw error;
return (data as { batch_id: string }).batch_id;
```

Drop the find-or-create product / SKU / UID / unit / apportionment / rollback code from the client. The rebrickable enrichment fire-and-forget stays in the client (post-success, iterate unique MPNs).

### 3. Surface real errors in the form

`NewPurchaseForm` `onError` toast must include `error.message` AND, when present, `error.details` / `error.hint` from the PostgrestError. Currently a Postgres error like `null value in column "sku_id"` is being collapsed to "Something went wrong".

Also add a non-toast error banner inside the form panel that persists until the user dismisses it — toasts auto-hide too quickly to read DB error text.

### 4. Always write an audit_event for create attempts

Inside the RPC, write `audit_event` for both success and failure (failure path uses an EXCEPTION block that writes the audit row then re-raises). Category: `purchase_batch_create`. This gives us a permanent diagnostic trail for the next incident.

### 5. Clean up PO-668

One-shot migration (data, not schema — done via insert tool):
- `DELETE FROM purchase_line_items WHERE batch_id='PO-668'`
- `DELETE FROM purchase_batches WHERE id='PO-668'`
- Leave the 9 `product` rows (they're useful and not orphaned).

### 6. Add a backstop nightly drift check

Tiny `pg_cron` job: any `purchase_batches` row with `status='draft'` AND `created_at < now() - interval '15 minutes'` AND `unit_counter = 0` → write an `audit_event` of category `purchase_batch_orphan_detected` (do NOT auto-delete — humans should review). This catches anything that slips through.

## Files touched

| File | Change |
|---|---|
| New migration | `v2_create_purchase_batch(jsonb)` SECURITY DEFINER function + GRANT EXECUTE; nightly orphan-detection cron |
| Data migration (insert tool) | Delete PO-668 line items + header |
| `src/hooks/admin/use-purchase-batches.ts` | Replace `useCreatePurchaseBatch` mutation body with single `supabase.rpc('v2_create_purchase_batch', …)` call; keep rebrickable enrichment fire-and-forget after success |
| `src/components/admin-v2/NewPurchaseForm.tsx` | Surface `error.message` + `error.details` in toast AND in a dismissible inline error banner |

## Verification

1. Retry the John Pye purchase that produced PO-668 (9 line items, mixed MPNs including non-LEGO). Expect: one new `PO-669` row with status `draft`, 9 line items, 9 stock units at grade 5 each with a `uid` and `sku_id`, 9 SKUs of form `<mpn>.5`. Zero orphan rows on any failure path.
2. Force a failure (e.g. submit an invalid `unit_cost: 'abc'` via the network). Expect: zero rows persisted (no batch, no lines, no products, no SKUs, no units). Toast shows the actual Postgres error. Audit event row written with `purchase_batch_create_failed`.
3. Run the nightly orphan check manually via `SELECT cron.schedule(...)` test invocation — confirm it does not flag the new healthy batch and would flag PO-668 if it still existed.
4. Confirm `audit_event` now has a `purchase_batch_create` row per attempt.

