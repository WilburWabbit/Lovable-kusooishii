
Root cause is now clearer after reviewing the live code paths and schema:

1. The reset button failure is a real code bug, not user error.
   - In `supabase/functions/admin-data/index.ts`, the request body is parsed as:
     `const { action, ...params } = await req.json()`
   - But the `reset-qbo-purchase` branch reads `body.ids` instead of `params.ids`.
   - That throws a server-side `ReferenceError`, which is why the UI only shows:
     `Reset failed: Edge Function returned a non-2xx status code`.

2. The two purchases are still blocked in staging.
   - `landing_raw_qbo_purchase` for `881` and `1733` is still `status = error`.
   - Their `inbound_receipt` rows are `pending`.
   - There are currently no surviving `purchase_batches` for references `881` / `1733`, and the exact conflicting UIDs are not present now.
   - So the immediate blocker is the broken reset action, and the processor also needs one more hardening pass so retries are deterministic.

Implementation plan:

## 1. Fix the reset action so it actually runs
File: `supabase/functions/admin-data/index.ts`

- Change `body.ids` to `params.ids`.
- Keep validation strict (`ids` must be a non-empty array).
- Return a structured success payload per purchase id so the UI can show what happened.
- Add clearer server-side error messages around the reset helper so future failures are diagnosable instead of generic 500s.

## 2. Make the UI surface the real backend error
File: `src/components/admin-v2/StagingErrorsPanel.tsx`

- Switch the purchase reset call from `supabase.functions.invoke(...)` to the existing `invokeWithAuth(...)` helper.
- That will expose the real server message instead of the generic “non-2xx” toast.
- Keep the special amber “Reset & Retry” button, but make its toast actionable.

## 3. Harden QBO purchase retries before stock is rebuilt
File: `supabase/functions/qbo-process-pending/index.ts`

- Before reprocessing a QBO purchase that has a pending receipt but incomplete derived data, run the same cleanup logic used by manual reset.
- Do this even when receipt line count is `0`, so retries do not depend on partial state.
- Make the cleanup path deterministic: receipt-linked units/lines, purchase line items, and purchase batches for that QBO purchase are cleared in one place before rebuild starts.

## 4. Fix batch counter bookkeeping while hardening retries
File: `supabase/functions/qbo-process-pending/index.ts`

- Replace the current batch `unit_counter` write that uses the function-level cumulative `stockCreated` total.
- Update each batch using its own actual unit count only.
- This is separate from the reset bug, but it is wrong today and can distort batch/UID state during rebuilds.

## 5. Add precise duplicate-UID diagnostics
File: `supabase/functions/qbo-process-pending/index.ts`

- When stock insert fails, log:
  - QBO purchase id
  - batch id
  - receipt line id
  - current batch unit counter
  - the conflicting UID / collision context if available
- This gives a single source of truth if either purchase still fails after the reset bug is fixed.

## Technical details

Files to update:
- `supabase/functions/admin-data/index.ts`
- `supabase/functions/qbo-process-pending/index.ts`
- `src/components/admin-v2/StagingErrorsPanel.tsx`

No migration is needed.

## Expected outcome

After deployment:
1. Clicking “Reset & Retry” for `881` and `1733` should succeed and move both landing rows to `pending`.
2. Running “Process Pending” should rebuild them from a clean state.
3. If either still fails, the error will be specific enough to isolate the remaining collision source immediately instead of looping on a generic 500.
