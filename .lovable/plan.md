

## Fix QBO Sync: Redeploy + Prevent Timeout

### Problem
Two issues:
1. **Stale deployment** — The `carrying_value` fix is in the code but the old version may still be running. Need to force redeploy.
2. **Timeout** — The function processes up to 1000 QBO purchases sequentially, each potentially making individual Item API calls. This exceeds the edge function time limit (~60s), causing "Load failed" with no error logged.

### Changes

**1. Redeploy `qbo-sync-purchases`** to pick up the `carrying_value` fix.

**2. Optimize the sync to avoid timeout** in `supabase/functions/qbo-sync-purchases/index.ts`:

- **Pre-fetch all unique QBO item IDs in parallel**: Before processing purchases, collect all unique `ItemRef.value` IDs across all purchases, then fetch them in parallel (batches of ~10 concurrent fetches) to populate the item cache upfront. This replaces the current sequential per-line fetch.
- **Skip already-processed receipts early**: After the upsert, if status is `processed`, skip immediately without rebuilding lines (already implemented but verify it's working).
- **Increase wall-clock headroom**: The config already has `verify_jwt = false`. No config change needed for timeout — the optimization should bring it well within limits.

### Technical Detail

```text
Current flow (slow):
  For each purchase (up to 1000):
    For each line:
      Fetch QBO item (sequential) → ~200ms each
  Total: potentially 1000+ sequential HTTP calls

New flow (fast):
  Pass 1: Collect all unique ItemRef.value IDs across all purchases
  Pass 2: Fetch all items in parallel (batches of 10)
  Pass 3: Process purchases using cached items (no HTTP calls)
```

The item cache (`Map<string, any>`) already exists. The change is to populate it upfront rather than lazily during line processing.

### Files to modify
- `supabase/functions/qbo-sync-purchases/index.ts` — Add upfront parallel item fetching before the main purchase loop

