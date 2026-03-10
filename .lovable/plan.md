

## Bug: Enriched orders don't get `origin_channel` updated to `'ebay'`

The sync logs show 85 orders enriched (matched via `doc_number`), but the enrichment code at line 270 of `ebay-sync/index.ts` never updates `origin_channel`. It sets `origin_reference`, shipping details, guest info, and notes — but leaves `origin_channel` as `'qbo'` (or whatever it was before).

The original plan explicitly stated: *"set `origin_channel` to `'ebay'` if it was `'qbo'`"* — but the implementation omitted this.

### Fix

**File:** `supabase/functions/ebay-sync/index.ts`

In the enrichment `updatePayload` (around line 270), add:

```typescript
origin_channel: "ebay",
```

This single-line addition to the `updatePayload` object will cause all 85 matched orders to correctly show as `ebay` origin on the next sync run.

No other functions appear broken — the matching logic, SKU lookup, inventory sync, and push stock code all look correct. The issue is isolated to this one missing field in the enrichment path.

