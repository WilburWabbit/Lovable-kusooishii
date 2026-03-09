

## Wire Up Intake UI

### Current State
The Intake page exists with receipt listing and a detail dialog for MPN mapping. Routes and sidebar navigation are in place. However, the page lacks the critical "Process Receipt" action that converts receipt lines into `stock_unit` records, completing the intake workflow.

### Plan

#### 1. Create `process-receipt` edge function
A new backend function that, given a receipt ID:
- Fetches all lines for that receipt where `mpn IS NOT NULL`
- For each line, looks up the `catalog_product` by MPN
- Finds or creates a `sku` record (default condition grade "3", price from unit_cost)
- Creates `quantity` number of `stock_unit` records per line (status `received`, `landed_cost` = `unit_cost`, `carrying_value` = `unit_cost`, vendor as `supplier_id`)
- Marks the `inbound_receipt.status` = `processed` and sets `processed_at`
- Returns a summary of units created
- Validates caller is admin/staff
- Skips lines without an MPN match in `catalog_product` and reports them

#### 2. Update IntakePage UI
- Add a **"Process Receipt"** button in the receipt detail dialog (enabled only when status is `pending` and at least one line has an MPN)
- Add a condition grade selector (default "3") per line or globally for the receipt
- Show processing state with a spinner
- On success, invalidate queries and close dialog with a toast
- Indicate which lines are unmapped (no MPN) with a warning badge
- After processing, show the receipt as "processed" (green badge) and disable re-processing

#### 3. Improve MPN input UX
- After saving an MPN, validate it exists in `catalog_product` and show a green check or red warning
- Invalidate the receipt-lines query after saving so the UI reflects the change

### Scope
- 1 new edge function: `supabase/functions/process-receipt/index.ts`
- 1 file updated: `src/pages/admin/IntakePage.tsx`
- Deploy the new edge function

