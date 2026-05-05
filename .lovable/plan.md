## Why the latest eBay orders haven't reached QBO

The two most recent eBay orders are sitting **queued but unprocessed**:

| Order | Customer | qbo_sync_status | Posting intents |
|---|---|---|---|
| KO-0009654 (John Bromiley, 2026-05-05) | not yet in QBO | `pending` | `upsert_customer` + `create_sales_receipt` both `pending` |
| KO-0009653 (Simone Lewis, 2026-05-04) | not yet in QBO | `pending` | `upsert_customer` + `create_sales_receipt` both `pending` |

The intents were correctly enqueued by `queue_qbo_posting_intents_for_order`. They are **not failing** — they are never being picked up. There are **180 pending posting_intent rows** in total (only 133 have ever posted).

### Root cause

The cron job that drains the QBO posting outbox is:

```
subledger-qbo-posting-outbox-processor  (every 5 min)
  → SELECT public.invoke_subledger_scheduled_job('qbo_posting_outbox', ...)
  → calls edge function: subledger-scheduled-jobs
```

Every recent invocation of `subledger-scheduled-jobs` is erroring with:

```
Unauthorized — invalid scheduled job secret
  at authenticateInternalSchedule
  at requireAutomationActor
```

So the outbox never runs `accounting-posting-intents-process`, and `posting_intent` rows for both new eBay orders stay `pending` forever. (The separate `qbo-process-pending` cron that runs every minute is healthy — but that one only handles inbound landing tables, not the outbound QBO posting outbox.)

The `qbo_posting_outbox` job is comparing an incoming secret against a Lovable-managed value (likely `INTERNAL_CRON_SECRET` / scheduled-job secret) and the value the DB function is sending no longer matches the value the edge function expects — typical drift after a key rotation or after the secret was changed on only one side.

## Plan

### 1. Fix the auth mismatch on the scheduled job
- Inspect `supabase/functions/subledger-scheduled-jobs/index.ts` (`authenticateInternalSchedule`) to confirm exactly which env var/secret it expects (e.g. `INTERNAL_CRON_SECRET` or a dedicated scheduled-jobs secret).
- Inspect `public.invoke_subledger_scheduled_job` to see which Vault secret name it pulls and which header it sends.
- Align the two: prefer the existing pattern used by `qbo-process-pending-safety-net` (header `x-internal-shared-secret`, secret `INTERNAL_CRON_SECRET`). Update either the SQL function or the edge function so both sides read the same Lovable-managed secret. No Vault drift copies.
- Redeploy `subledger-scheduled-jobs`.

### 2. Drain the backlog manually once
- After the fix, invoke `accounting-posting-intents-process` (or trigger `subledger-scheduled-jobs` for `qbo_posting_outbox`) with a larger `batch_size` to clear the 180 pending intents in dependency order (customers before sales receipts).
- Verify KO-0009653 and KO-0009654:
  - `customer.qbo_customer_id` populated for both Simone Lewis and John Bromiley
  - `sales_order.qbo_sales_receipt_id` populated and `qbo_sync_status = 'synced'`
  - corresponding `posting_intent` rows flipped to `posted`

### 3. Confirm steady state
- Wait one cron cycle (5 min) and confirm `subledger-scheduled-jobs` logs show success, not "invalid scheduled job secret".
- Spot-check `posting_intent` pending count is trending toward zero and not regrowing.

### Notes / non-goals
- No schema changes required.
- Do not touch `qbo-process-pending` — it's healthy.
- Do not byte-compare service-role keys; keep using the JWT verifier / shared-secret pattern already in `_shared/auth.ts`.
- If `INTERNAL_CRON_SECRET` was rotated and a stale copy is in `vault.decrypted_secrets`, remove the Vault copy and have the SQL function read the canonical secret only.
