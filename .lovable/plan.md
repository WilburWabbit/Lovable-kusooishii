

## Auto-Extract MPN and Condition Grade from QBO Item SKU

### Problem
Currently, MPN must be manually entered per line in the Intake page, and a single condition grade is applied to the entire receipt. The QBO item name/SKU already encodes this information using a dot delimiter (e.g., `75192.3` = MPN `75192`, grade `3`; `75192` alone = grade `1`).

### Changes

**1. Add `condition_grade` column to `inbound_receipt_line`**
- New nullable text column to store the per-line parsed grade
- Migration: `ALTER TABLE inbound_receipt_line ADD COLUMN condition_grade text;`

**2. Update `qbo-sync-purchases` edge function**
- Parse `ItemRef.name` (or line description) on item-based lines using `.` as delimiter
- First part → `mpn`, second part → `condition_grade` (default `"1"` if no dot)
- Store both in the receipt line row during sync

```text
"75192.3"  → mpn: "75192", condition_grade: "3"
"75192"    → mpn: "75192", condition_grade: "1"
"10294.2"  → mpn: "10294", condition_grade: "2"
```

**3. Update `process-receipt` edge function**
- Use the per-line `condition_grade` from `inbound_receipt_line` instead of the receipt-wide parameter
- Remove `condition_grade` from the request body (no longer needed)
- Each line creates stock units with its own grade

**4. Update Intake page UI**
- Show the auto-parsed MPN and grade per line (pre-populated, still editable)
- Remove the receipt-wide grade selector from the dialog footer
- Add a "Grade" column showing per-line grade
- MPN input pre-filled from parsed value

