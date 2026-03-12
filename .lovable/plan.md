

## Fix: Stale Edge Functions Producing `-G` SKU Codes

### Root Cause

The code in the repository correctly uses raw QBO SKU verbatim (dot notation like `42129-1.2`), but the **deployed edge functions** are running an older version that converts dot notation to `-G` format (e.g., `42129-1-G2`). Evidence:

- QBO sends: `42129-1.2` (confirmed via `landing_raw_qbo_item` payloads)
- Database stores: `42129-1-G2` (all 362 SKUs in `-G` format, zero in dot format)
- Last sync ran today at 15:53 UTC and produced `-G` results
- No database triggers transform the SKU — the conversion happens in the deployed function code

The repo code has been fixed but the edge functions were never redeployed.

### Fix

**1. Redeploy all QBO-related edge functions** to ensure the deployed code matches the repo:
- `qbo-sync-items` — the primary offender, syncs all QBO items to SKUs
- `qbo-sync-purchases` — creates SKUs during purchase processing
- `qbo-sync-sales` — resolves SKUs during sales sync
- `qbo-webhook` — handles real-time QBO item/purchase/sale webhooks
- `process-receipt` — manual receipt processing, creates SKUs

**2. Database migration** — fix all 362 existing SKU records from `-G` back to dot notation:

```sql
-- Convert -G1 → .1, -G2 → .2, etc. for all SKUs
UPDATE sku
SET sku_code = regexp_replace(sku_code, '-G(\d)$', '.\1')
WHERE sku_code ~ '-G\d$';
```

Also update any `channel_listing.external_sku` and `inbound_receipt_line.sku_code` values that use `-G` format.

**3. Code audit result** — the current repo code is correct across all five functions:
- `parseSku()` is only used to extract MPN and condition_grade for internal logic
- `sku_code` is always set from the raw QBO `Sku` field verbatim
- Fallback reconstruction (`mpn.grade`) uses dot notation correctly
- No `-G` transformation exists anywhere in the current codebase

### Files Changed

| File | Change |
|------|--------|
| All 5 QBO edge functions | Redeploy (no code changes needed — repo is correct) |
| New SQL migration | Convert all `-G` sku_codes to dot notation across `sku`, `channel_listing`, `inbound_receipt_line` |

