

## Problem

The `authorize_url` action in the `qbo-auth` edge function builds the OAuth redirect URI from `req.headers.get("origin")`, which returns the **preview URL** (e.g., `https://e9e56bf8-...lovableproject.com`). QuickBooks only accepts redirect URIs that are pre-registered in the Intuit Developer portal — the preview URL is not registered, so Intuit rejects it.

## Solution

Use the **published production URL** as the redirect URI instead of the request origin. Two changes:

1. **Edge function (`supabase/functions/qbo-auth/index.ts`, line 71):** Replace the dynamic origin fallback with the published URL:
   ```typescript
   const actualRedirect = redirect_uri || "https://workspace-charm-market.lovable.app/admin/qbo-callback";
   ```

2. **QuickBooks Developer Portal:** Ensure `https://workspace-charm-market.lovable.app/admin/qbo-callback` is listed as an authorized redirect URI in the Intuit app settings. (You may have already done this.)

This means even when clicking "Connect" from the preview, the OAuth flow will redirect back to the production URL after authorization. The user must complete the callback on the production site.

## Scope

- One line change in the edge function
- Redeploy `qbo-auth`

