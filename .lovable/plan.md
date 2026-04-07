

# Fix: Reliable Post-Landing Processing for QBO Webhooks

## Problem

When multiple QBO webhooks arrive in quick succession (e.g., 4 sales receipts within 13 minutes), only the first triggers a successful processor run. The later webhooks land their data but the auto-triggered processor either:
- Was already running from a previous webhook and finishes before the new data lands
- Times out or fails silently because concurrent invocations interfere

This leaves records stuck in `pending` until manually processed.

## Root cause

The webhook calls `qbo-process-pending` once at the end of `processWebhookInBackground`. But Supabase Edge Functions can run concurrently — if webhook A's processor call starts before webhook B has finished landing, B's records are missed. There is no retry or re-check mechanism.

## Solution

**File: `supabase/functions/qbo-webhook/index.ts`**

Replace the single fire-and-forget processor call with a **poll-after-land** pattern:

1. After landing all entities, wait a short delay (3 seconds) to allow any near-simultaneous webhooks to finish landing
2. Call `qbo-process-pending` 
3. Check the response's `has_more` / `total_remaining` field
4. If there are still pending records, wait 2 seconds and call the processor again (up to 3 total attempts)

This ensures that even if webhooks overlap, the processor will drain all pending records within the same background execution.

```
// Replace lines 366-381 with:
// Auto-trigger processor with retry loop to drain all pending records
const maxAttempts = 3;
await new Promise(r => setTimeout(r, 3000)); // let concurrent webhooks finish landing

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  try {
    const processUrl = `${supabaseUrl}/functions/v1/qbo-process-pending`;
    const processRes = await fetchWithTimeout(processUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
        "x-webhook-trigger": "true",
      },
      body: JSON.stringify({ batch_size: 50 }),
    });
    const result = await processRes.json();
    log.info("Processor attempt completed", { 
      attempt, 
      status: processRes.status,
      total_remaining: result.total_remaining ?? 0 
    });
    
    if (!result.has_more || (result.total_remaining ?? 0) === 0) break;
    
    // More records pending — wait and retry
    await new Promise(r => setTimeout(r, 2000));
  } catch (err: any) {
    log.warn("Processor attempt failed (non-fatal)", { attempt, error: err.message });
    break;
  }
}
```

Additionally, increase `batch_size` from 15 to 50 to ensure a single processor call can handle a typical webhook payload's worth of entities.

## Files changed

| File | Change |
|------|--------|
| `supabase/functions/qbo-webhook/index.ts` | Replace single processor call with poll-and-drain loop (3 attempts, 3s initial delay, 2s between retries, batch_size 50) |

## Expected outcome

- All QBO webhook notifications are landed and processed automatically without manual intervention
- Near-simultaneous webhooks (common when QBO batches notifications) are handled reliably
- Processing order is maintained by the existing chronological TxnDate ordering in `qbo-process-pending`

