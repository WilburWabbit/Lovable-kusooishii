

## Plan: QBO OAuth Integration for Inventory Population

This is a multi-phase integration. QBO uses OAuth 2.0 with short-lived access tokens (1 hour) and longer-lived refresh tokens (100 days). We need to store credentials securely, handle the OAuth flow, and then pull purchase/item data to populate inventory.

### Phase 1: Store QBO Credentials as Secrets

You'll need to create an app on the [Intuit Developer Portal](https://developer.intuit.com) and obtain:
- **Client ID** and **Client Secret** from your QBO app
- **Realm ID** (your QBO company ID)

We'll store these as backend secrets: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REALM_ID`.

### Phase 2: Database Tables

Create these tables via migration:

1. **`qbo_connection`** — stores OAuth tokens per realm
   - `id`, `realm_id` (unique), `access_token`, `refresh_token`, `token_expires_at`, `created_at`, `updated_at`
   - RLS: admin-only access

2. **`inbound_receipt`** — per the design spec (receipt header)
   - `id`, `qbo_purchase_id` (unique), `vendor_name`, `txn_date`, `total_amount`, `currency`, `raw_payload` (jsonb), `status` (pending/processed/error), `processed_at`, `created_at`
   - RLS: staff/admin only

3. **`inbound_receipt_line`** — individual line items from each purchase
   - `id`, `inbound_receipt_id` (FK), `description`, `quantity`, `unit_cost`, `line_total`, `qbo_item_id`, `mpn` (nullable — mapped later), `is_stock_line` (boolean), `created_at`
   - RLS: staff/admin only

### Phase 3: Edge Functions

1. **`qbo-auth`** — handles the OAuth 2.0 authorization code exchange and token refresh
   - `POST /authorize` — exchanges auth code for tokens, stores in `qbo_connection`
   - `POST /refresh` — refreshes expired access token using refresh token
   - Redirect URI will be constructed from the project URL

2. **`qbo-sync-purchases`** — pulls purchase data from QBO
   - Reads access token from `qbo_connection`, refreshes if expired
   - Calls QBO API `GET /v3/company/{realmId}/query?query=SELECT * FROM Purchase`
   - Upserts raw purchases into `inbound_receipt` with `raw_payload`
   - Parses line items into `inbound_receipt_line`
   - Returns count of new/updated receipts

### Phase 4: Admin UI — QBO Settings Page

Add a QBO connection panel to the Settings area:
- **Connect to QBO** button that initiates OAuth (redirects to Intuit authorization URL)
- **Callback handler** page/component that captures the auth code and calls `qbo-auth`
- **Connection status** indicator (connected/disconnected, last sync time)
- **Sync Purchases** button to manually trigger `qbo-sync-purchases`

### Phase 5: Intake Page — Receipt Review

Update the Intake admin page to show:
- List of `inbound_receipt` records with status
- Drill into receipt lines
- Map lines to catalog products (by MPN)
- "Process" action to explode receipt lines into `stock_unit` records with landed cost

### Files to Create/Modify

| File | Action |
|------|--------|
| Migration SQL | Create `qbo_connection`, `inbound_receipt`, `inbound_receipt_line` tables |
| `supabase/functions/qbo-auth/index.ts` | New — OAuth token exchange & refresh |
| `supabase/functions/qbo-sync-purchases/index.ts` | New — Pull purchases from QBO API |
| `src/pages/admin/AdminPages.tsx` | Update Settings/Intake placeholders |
| `src/pages/admin/QboSettingsPanel.tsx` | New — QBO connection UI |
| `src/pages/admin/IntakePage.tsx` | New — Receipt review & processing UI |
| `src/pages/admin/QboCallbackPage.tsx` | New — OAuth callback handler |
| `src/App.tsx` | Add route for QBO callback |

### Prerequisites

Before implementation, I'll need you to:
1. Create a QBO app at [developer.intuit.com](https://developer.intuit.com) (select "Accounting" scope)
2. Provide the **Client ID**, **Client Secret**, and **Realm ID** so I can store them as secrets

Shall I proceed? I'll start by requesting the secrets.

