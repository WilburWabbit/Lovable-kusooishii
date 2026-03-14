

## Plan: Fix Build Error and Investigate Navigation Issues

### Problem 1: Build Error (stripe-webhook)
The `supabase/functions/stripe-webhook/index.ts` uses `npm:@supabase/supabase-js@2.57.2` which Deno cannot resolve. Every other edge function uses the `https://esm.sh/` pattern. This build error may be blocking edge function deployment.

**Fix:** Change line 3 of `stripe-webhook/index.ts` from:
```ts
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
```
to:
```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
```

### Problem 2: Navigation to Pages
The routes in `App.tsx` are correctly defined:
- `/admin/products/:id` → `ProductDetailAdminPage`
- `/sets/:mpn` → `ProductDetailPage`
- `/admin/listings` → `ListingsPage`

The admin Products page navigates correctly via `navigate(\`/admin/products/\${p.id}\`)`. However, the Listings page has **no row-click navigation** — it displays listing data but doesn't link to a detail view.

**Clarification needed:** "Can't get to" could mean:
1. Pages show a blank/error screen (likely caused by the build error affecting edge functions like `admin-data` which powers `ProductDetailAdminPage`)
2. There are no clickable links to reach these pages

Since the build error could prevent the `admin-data` edge function from deploying correctly (all functions share a build pipeline), fixing the stripe-webhook import should resolve any downstream failures.

### Implementation Steps
1. Fix the `npm:` import in `stripe-webhook/index.ts` to use `esm.sh` (consistent with all other functions)

### Technical Details
- File: `supabase/functions/stripe-webhook/index.ts`, line 3
- Single-line change from `npm:` to `https://esm.sh/` import specifier

