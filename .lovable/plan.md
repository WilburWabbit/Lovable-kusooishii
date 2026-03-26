

# Fix Build Errors and Redeploy

## Problem

Two categories of build errors:

1. **Missing `BackOfficeLayout` component** — Three callback pages (`EbayCallbackPage.tsx`, `GmcCallbackPage.tsx`, `QboCallbackPage.tsx`) import `@/components/BackOfficeLayout` which doesn't exist. This breaks the Vite build.

2. **Edge function `npm:@lovable.dev/webhooks-js` resolution** — The `auth-email-hook` deno.json doesn't declare the npm dependency, causing deploy failures. (Per memory: do NOT add imports/nodeModulesDir to deno.json.)

## Changes

### 1. Fix callback page imports (3 files)
Replace `import { BackOfficeLayout } from "@/components/BackOfficeLayout"` with `import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout"` in:
- `src/pages/admin/EbayCallbackPage.tsx`
- `src/pages/admin/GmcCallbackPage.tsx`  
- `src/pages/admin/QboCallbackPage.tsx`

Also replace `<BackOfficeLayout>` / `</BackOfficeLayout>` JSX tags with `<AdminV2Layout>` / `</AdminV2Layout>` in each file.

### 2. Redeploy all edge functions
Deploy all 49 edge functions after the build fix. The `npm:@lovable.dev/webhooks-js` specifier should resolve natively in Deno without deno.json remapping (per project memory).

## Files Modified

| File | Change |
|---|---|
| `src/pages/admin/EbayCallbackPage.tsx` | Replace BackOfficeLayout → AdminV2Layout |
| `src/pages/admin/GmcCallbackPage.tsx` | Replace BackOfficeLayout → AdminV2Layout |
| `src/pages/admin/QboCallbackPage.tsx` | Replace BackOfficeLayout → AdminV2Layout |
| Edge functions | Redeploy all |

