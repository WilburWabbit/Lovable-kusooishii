

## Fix: Mobile Overflow on Product Detail + Build Errors

### 1. Mobile horizontal overflow on `/sets/*` pages

The `container` class has `padding: "2rem"` (32px each side). On a 390px viewport, the content area is ~326px. The image gallery's `aspect-square` div and the offer cards don't have `min-w-0` or `overflow-hidden` constraints, so long text or flex children can push beyond the container.

**Fixes in `src/pages/ProductDetailPage.tsx`:**
- Add `overflow-hidden` to the outer `bg-background` wrapper div
- Add `min-w-0` to both grid columns (image gallery `div` and product info `div`) to prevent flex/grid blowout
- Add `min-w-0 overflow-hidden` to the offer card text containers to prevent long grade descriptions from overflowing

### 2. Build error: Spread types (ProductMediaCard.tsx line 338)

`arrayMove` returns `(MediaItem | undefined)[]` because the query data type from `useQuery` could be `undefined` entries. Fix by typing `items` explicitly or casting the spread.

**Fix in `src/components/admin/ProductMediaCard.tsx`:**
- Add a type assertion on the `arrayMove` result: `arrayMove(items, oldIndex, newIndex) as MediaItem[]`

### 3. Build error: boolean not assignable to input value (ProductDetailsTab.tsx line 206)

`FormValues` allows `boolean` values, but `<Input value={...}>` only accepts `string | number | readonly string[]`. The `String()` wrapper on line 363 handles this at runtime, but the TS type on line 206 (`form.retail_price`) flows through without `String()`.

**Fix in `src/components/admin/product-detail/ProductDetailsTab.tsx`:**
- In the `FieldWithOverride` component, the `value` prop already uses `String(form[field] ?? "")` which is correct. The error is actually on line 206 where `value={form.retail_price ?? ""}` is used directly in the retail price Input — wrap it with `String(form.retail_price ?? "")`.

### 4. Build error: getClaims (qbo-sync-tax-rates)

`getClaims` doesn't exist on the Supabase auth client. Replace with `getUser()` which is the standard method to verify the token.

**Fix in `supabase/functions/qbo-sync-tax-rates/index.ts`:**
- Replace `await userClient.auth.getClaims(token)` with `await userClient.auth.getUser()` and adjust the subsequent check accordingly.

