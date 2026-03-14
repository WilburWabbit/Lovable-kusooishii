

## Plan: Fix Edge Function Error Handling for Listing Actions

### Root Cause

Two issues combine to produce a generic, unhelpful error:

1. **Edge function returns 500 for validation errors** — When `create-web-listing` rejects a SKU with price 0 (our new safeguard working correctly), it throws, which the catch block returns as HTTP 500. This should be a 400 (client error).

2. **`invokeWithAuth` discards the error message** — `supabase.functions.invoke` wraps non-2xx responses in a `FunctionsHttpError` whose `.message` is generic ("Edge Function returned a non-2xx status code"). The actual JSON error body (e.g., `"Cannot list: SKU has no valid price"`) is in the response context but never read.

SKU `77251-1.2` currently has `price: 0` in the database, so the safeguard is correctly blocking the listing — but the user sees a useless error message instead of the helpful one.

### Changes

#### 1. `supabase/functions/admin-data/index.ts` — Return 400 for validation errors

Wrap known validation errors in a custom error class so the catch block can return 400 instead of 500:

```typescript
class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ValidationError"; }
}
```

In the catch block, check `err instanceof ValidationError` and return 400 for those, 500 for unexpected errors. Update all `throw new Error(...)` for user-facing validation messages (like "SKU has no valid price", "sku_id is required") to use `throw new ValidationError(...)`.

#### 2. `src/lib/invokeWithAuth.ts` — Extract the actual error message

When `supabase.functions.invoke` returns an error, attempt to read the response body to get the server's error message:

```typescript
if (error) {
  // Try to extract the server's error message from the response context
  const context = (error as any).context;
  if (context instanceof Response) {
    try {
      const body = await context.json();
      throw new Error(body.error || error.message);
    } catch { /* fall through */ }
  }
  throw error;
}
```

This ensures the toast shows "Cannot list: SKU has no valid price. Calculate pricing first." instead of the generic message.

### Files Changed
- `supabase/functions/admin-data/index.ts` — Add `ValidationError` class; use 400 for validation, 500 for unexpected
- `src/lib/invokeWithAuth.ts` — Extract error message from response context

