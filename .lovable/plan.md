

# QBO Webhook & Bidirectional Customer Sync — Issues and Fix Plan

## Findings

### 1. QBO Webhook Is Not Receiving Any Calls
Zero HTTP requests to `qbo-webhook` in the edge function logs. The webhook subscription in QBO has either expired, been disabled, or was never properly configured for this project URL. This means **no automatic updates from QBO are reaching the app** — not for customers, sales receipts, purchases, or items.

### 2. Customer Table Missing `first_name` / `last_name` Columns
The QBO `Customer` payload includes `GivenName` and `FamilyName`, but the local `customer` table has no `first_name` or `last_name` columns. The processor (`processCustomers`) only writes `display_name` from `DisplayName`. So even when data lands correctly, name components are lost — and when pushing back to QBO, the `qbo-upsert-customer` function has no stored first/last name to send.

### 3. Pending Data Is Stacking Up (Not Being Processed)
There are currently **256 pending sales receipts**, **10 pending customers**, and **6 pending items** sitting in staging tables. The architecture relies on a **client-side drain loop** to trigger `qbo-process-pending`, but nothing is automatically calling it after the webhook lands data. Since the webhook isn't calling at all, this data came from a manual bulk sync — but it was never processed.

### 4. No App → QBO Push for Customer Edits in Admin
The admin customer detail view is read-only. The `qbo-upsert-customer` function is only called from the public profile/address forms (for the logged-in user's own record). There is no admin UI to edit customer details and push changes to QBO.

## Plan

### Step 1: Add `first_name` and `last_name` columns to `customer` table
New migration adding two nullable text columns.

### Step 2: Update `processCustomers` in `qbo-process-pending` to store name components
Map `GivenName` → `first_name` and `FamilyName` → `last_name` from the QBO payload into the customer upsert.

### Step 3: Add editable customer fields in admin UI + push-to-QBO button
Add inline editing for name, email, phone, address fields on the `CustomerDetail` component, with a "Save & Sync to QBO" action that calls `qbo-upsert-customer`.

### Step 4: Update `qbo-upsert-customer` to accept a `customer_id` parameter
Currently it only works for the logged-in user. Add support for admin callers to specify a customer record by ID, look up that customer's details, and push to QBO.

### Step 5: Re-register QBO webhook
This is a **manual action** — you need to go to the QBO developer portal and verify/re-register the webhook subscription pointing to `https://gcgrwujfyurgetvqlmbf.supabase.co/functions/v1/qbo-webhook`. Alternatively, if the app has a QBO webhook setup mechanism in the Settings UI, use that.

### Step 6: Process the pending backlog
Trigger the drain loop from the admin UI (Settings → QBO → Process Pending) to clear the 256 pending sales receipts, 10 customers, and 6 items.

## Technical Details

| Change | File |
|---|---|
| Migration: add `first_name`, `last_name` to `customer` | New SQL migration |
| Map GivenName/FamilyName in processor | `supabase/functions/qbo-process-pending/index.ts` (line ~941) |
| Admin customer editing + sync button | `src/components/admin-v2/CustomerDetail.tsx` |
| Accept `customer_id` param for admin push | `supabase/functions/qbo-upsert-customer/index.ts` |
| Deploy | `qbo-process-pending`, `qbo-upsert-customer` |
| Manual | Re-register QBO webhook subscription; trigger pending drain |

