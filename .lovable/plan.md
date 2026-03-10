

## Targeted Webhook Processing — Fetch Single Entity Instead of Full Re-sync

### Problem
Currently, `qbo-webhook` receives entity change notifications (e.g., `SalesReceipt Create 5456`) but fires off the full sync functions which re-query *all* entities from QBO. This is wasteful, slow, and doesn't scale.

### Approach
Move the processing logic directly into the `qbo-webhook` function. Instead of calling the bulk sync functions, the webhook will:
1. Fetch the single changed entity by ID from the QBO API (`GET /v3/company/{realmId}/salesreceipt/5456`)
2. Run the corresponding create/update/delete logic inline

The existing bulk sync functions remain untouched for manual full-sync triggers from the settings page.

### Entity → Action Matrix

```text
Entity          | Create/Update                      | Delete
────────────────|────────────────────────────────────|──────────────────────
Purchase        | Fetch by ID, upsert receipt +      | Delete inbound_receipt
                | lines, auto-process                | + lines + stock_units
SalesReceipt    | Fetch by ID, run processSalesRcpt  | Delete sales_order
                | (existing logic)                   | + lines, reopen stock
RefundReceipt   | Fetch by ID, run processRefundRcpt | Delete sales_order
                |                                    | + lines
Customer        | Fetch by ID, upsert customer row   | Mark inactive
Item            | Fetch by ID, no-op (lightweight)   | No-op
```

### Implementation — Single File Change

**File: `supabase/functions/qbo-webhook/index.ts`**

1. **Add QBO credentials + token refresh** — reuse the `ensureValidToken` pattern already present in all other sync functions.

2. **Replace the "trigger sync function" loop** with inline entity-specific handlers:
   - `handlePurchase(admin, baseUrl, accessToken, entityId, operation)` — fetches `GET /purchase/{id}`, then runs the same upsert + auto-process logic from `qbo-sync-purchases` (simplified for a single record).
   - `handleSalesReceipt(admin, baseUrl, accessToken, entityId, operation)` — fetches `GET /salesreceipt/{id}`, uses the same `processSalesReceipt` logic. For `Delete`, removes the matching `sales_order` and reopens any closed `stock_unit` records.
   - `handleRefundReceipt(...)` — same pattern with `processRefundReceipt` logic.
   - `handleCustomer(...)` — fetches `GET /customer/{id}`, upserts the single row into the `customer` table.
   - `handleItem(...)` — lightweight; could trigger a single TaxRate/TaxCode refresh or be a no-op.

3. **Delete handling**: For `Delete` operations, the webhook won't be able to fetch the entity from QBO (it's gone). Instead:
   - `Purchase Delete` → find `inbound_receipt` by `qbo_purchase_id`, delete associated stock_units and lines, then the receipt.
   - `SalesReceipt/RefundReceipt Delete` → find `sales_order` by `origin_reference`, reopen any linked stock_units (set status back to `available`), delete order lines and order.
   - `Customer Delete` → set `active = false` on the customer row.

4. **Audit logging stays** — each entity change gets logged to `audit_event` with the specific entity ID, type, and operation, plus the result of the handler.

5. **Keep the fire-and-forget pattern** — respond 200 immediately, process async. Each entity handler is wrapped in try/catch so one failure doesn't block others.

### What stays the same
- All four bulk sync functions (`qbo-sync-purchases`, `qbo-sync-sales`, `qbo-sync-customers`, `qbo-sync-tax-rates`) remain unchanged and are still callable from the Settings page for manual full syncs.
- The webhook signature verification and GET validation handler stay as-is.
- The `x-webhook-trigger` auth bypass in sync functions is no longer needed for webhooks but stays for potential future use.

### Key consideration
The webhook handler will need the same helper functions used across sync functions (token refresh, SKU parsing, item fetching, etc.). These will be inlined in the webhook function since edge functions can't share imports across directories.

