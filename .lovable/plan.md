

## Fix QBO Sales Sync: Rate Limiting

### Problem
The logs show massive 429 (Too Many Requests) errors from QBO's API. Two issues:

1. **Item pre-fetch**: Batches of 5 concurrent requests with only 250ms delay — too aggressive for ~180 unique items
2. **VAT backfill**: Fetches each QBO receipt individually with zero delay between requests, plus re-fetches items inside the loop — causes cascading 429s that kill the entire sync

The edge function likely times out before completing, returning no response to the frontend.

### Solution

Restructure the function to reduce QBO API calls and add proper throttling:

#### 1. Reduce item fetch concurrency and increase delays
- Change `BATCH_SIZE` from 5 to 2
- Increase inter-batch delay from 250ms to 500ms
- Add retry-with-backoff on 429 responses in `fetchQboItem`

#### 2. Throttle the VAT backfill receipt fetches
- Add 500ms delay between each receipt fetch in the backfill loop
- Skip re-fetching items that are already in the cache (they already are, but 429 failures cache `null` — fix by not caching 429 failures so retries work)

#### 3. Don't cache 429 failures
Currently `fetchQboItem` caches `null` on failure, meaning a 429'd item can never be resolved in the same run. Change to only cache successful results and explicit 400/404 errors — not 429s.

#### 4. Add backfill throttling
Add a delay between each order's backfill fetch to stay under QBO's rate limit (~500 req/min for sandbox, higher for production but still finite).

### Changes

**`supabase/functions/qbo-sync-sales/index.ts`**:
- `fetchQboItem`: Add retry logic (1 retry after 2s on 429). Don't cache 429 failures.
- Item pre-fetch: Reduce batch size to 2, increase delay to 500ms
- VAT backfill loop: Add 500ms delay between receipt fetches
- Wrap backfill in a time budget (e.g. 20s max) so the function doesn't timeout

### Files
- `supabase/functions/qbo-sync-sales/index.ts` — throttling and retry fixes

