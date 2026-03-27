

# Add CloudEvent Interface & Event Type Parser to QBO Webhook

## What changes

Insert a new block of code at line 132 (between the `landReferencedItems` function and the "Entity handlers" section comment). The block contains:

1. A section comment: `// CloudEvents v1.0 types and parser`
2. A `CloudEvent` interface with all specified fields
3. A `parseEventType()` function that converts CloudEvents `type` strings (e.g. `"qbo.customer.created.v1"`) into `{ entityName, operation }` objects

## No other changes

All existing code — functions, types, the main `Deno.serve` handler — remains untouched. This is a pure additive insertion between lines 131 and 133.

## Technical Details

| Detail | Value |
|---|---|
| File | `supabase/functions/qbo-webhook/index.ts` |
| Insertion point | After line 131, before line 133 |
| Lines added | ~30 |
| Lines modified | 0 |

