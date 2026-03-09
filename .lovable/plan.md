

## Fetch QBO Item SKU Field for MPN Extraction

### Problem
The current sync uses `ItemRef.name` from purchase lines, which contains full product descriptions (e.g., "Chief Wiggum (sim021)"), not the dot-delimited SKU. The actual SKU field lives on the QBO **Item** record, which requires a separate API call.

### Approach
During sync, for each unique `ItemRef.value` (QBO item ID), fetch the full Item record from the QBO API to get its `Sku` field. Then parse that SKU using the `.` delimiter convention (MPN.grade).

### Changes

**`qbo-sync-purchases` edge function:**

1. **Collect unique QBO item IDs** from all item-based purchase lines across all purchases
2. **Batch-fetch Item records** from QBO API: `GET /v3/company/{realmId}/item/{itemId}` for each unique item ID (with a local cache to avoid re-fetching the same item)
3. **Parse the `Sku` field** using `.` delimiter:
   - `"75192.3"` → MPN `75192`, grade `3`
   - `"75192"` → MPN `75192`, grade `1`
   - If `Sku` is empty/null, fall back to `ItemRef.name` parsing as current behavior
4. **Store parsed `mpn` and `condition_grade`** on each `inbound_receipt_line`

### Technical Detail

```text
Purchase Line → ItemRef.value: "167"
                                ↓
QBO API: GET /item/167 → { Name: "Chief Wiggum (sim021)", Sku: "sim021.2" }
                                                                   ↓
Parse: mpn = "sim021", condition_grade = "2"
```

The item cache ensures each QBO item is fetched only once per sync run, even if it appears across multiple purchases.

### Existing data
All 318 stock lines currently have null MPN/grade. After deploying this change, a re-sync will populate them from the QBO Item SKU fields.

