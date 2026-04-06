

# QBO Webhook Not Processing — Root Cause & Fix

## Root Cause

The QBO webhook is receiving notifications from Intuit but silently dropping all of them. The single recent invocation (April 4, 200 OK, 345ms) produced zero application logs — no landing, no errors, nothing.

**Why**: Intuit has migrated to CloudEvents v1.0 format (deadline May 15, 2026), but the deployed webhook code only handles the legacy `eventNotifications` format:

```typescript
// Line 218 — looks for old format
const notifications = payload?.eventNotifications ?? [];
if (notifications.length === 0) return;  // ← exits here every time
```

CloudEvents payloads arrive as a flat array of objects with different field names (`type`, `source`, headers like `intuit-signature`). The code never finds `eventNotifications`, so it returns immediately — no data is landed, no processor is triggered.

This is **systemic**: every entity type (Customer, SalesReceipt, Purchase, Item, Vendor, RefundReceipt) is affected. Nothing has been landed via webhook since March 31.

## Fix Plan

### File: `supabase/functions/qbo-webhook/index.ts`

Add CloudEvents parsing alongside the legacy format. CloudEvents from Intuit:
- Are a flat JSON array of objects
- Each has `type` (e.g., `qbo.customer.created.v1`), `data.intuitaccountid` (realm), `data.intuitentityid` (entity ID)
- Use the same `intuit-signature` HMAC verification

**Changes:**

1. **Parse CloudEvents format** — After signature verification, detect whether the payload is a CloudEvents array or legacy format by checking if it's an array vs an object with `eventNotifications`.

2. **Map CloudEvents to entity handlers** — Parse `type` field (e.g., `qbo.customer.created.v1`) into entity name + operation, extract `intuitaccountid` as `realmId`, `intuitentityid` as entity ID.

3. **Propagate metadata** — Pass `cloudEventId` (from `id` field) and `eventTime` (from `time` field) to `landEntity` for the staging tables that have those columns (`landing_raw_qbo_customer`, `landing_raw_qbo_item`, etc.).

4. **Keep legacy format as fallback** — Maintain backward compatibility in case Intuit sends mixed formats during migration.

5. **Echo suppression** — Query `qbo_outbound_queue` for recent pushes (within 10 seconds of the event) to prevent infinite sync loops when the app pushes to QBO and QBO sends a webhook back.

### Deployment

Redeploy `qbo-webhook` after changes.

### Verification

After deployment, trigger a test change in QBO (e.g., edit a customer) and confirm:
- Webhook logs show entity landing messages
- New records appear in `landing_raw_qbo_customer` (or relevant table)
- `qbo-process-pending` is auto-triggered and processes the staged data

