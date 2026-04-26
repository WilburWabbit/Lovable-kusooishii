## Why it is still happening

The food processor product shown is still `product_type = set` in the database. The scoping added earlier hides LEGO-specific fields only when the product type is not `set`/`minifigure`, so this product still qualifies for LEGO-only attributes such as Set Number, Theme, Pieces, Minifigures, Retired and Version.

There are two more issues:

1. eBay category `20673` is cached correctly as Food Processors, but its food-processor aspects were not bootstrapped into canonical editable fields/mappings because the schema was already cached after the reset. The current bootstrap only runs when the `aspects` endpoint fetches fresh data, not when a product resolves an existing cached schema.
2. The bottom “Channel-only Aspects” section is intentionally read-only today. It only lists unmapped eBay aspects and sends the user to Settings, so there is no per-product editing surface for those fields.

## Plan

1. **Clean up product type values for non-LEGO products**
   - Add a database cleanup migration that changes products in the food processor eBay category (`20673`) from `product_type = 'set'` to a non-LEGO type such as `food_processor`.
   - This will immediately stop LEGO-only canonical attributes from appearing for those products.
   - Preserve true LEGO products as `set`/`minifigure`.

2. **Make canonical scoping category-aware, not just product-type-aware**
   - Tighten the LEGO-only canonical attributes so they apply to LEGO eBay categories as well as LEGO product types.
   - This prevents a future non-LEGO item accidentally marked `set` from showing LEGO-only fields when its selected eBay category is Food Processors.
   - Keep universal commerce fields visible across categories: Brand, Product Type, MPN/Product Name, EAN, UPC, ISBN, Weight, Length, Width, Height, Dimensions.

3. **Repair food-processor canonical attributes and mappings**
   - Bootstrap all aspects from eBay category `20673` into editable canonical fields where no better existing canonical field exists.
   - Reuse existing universal fields for obvious matches:
     - `Brand` → `brand`
     - `MPN`/`Model` → product model/MPN field, avoiding the current global `Model → set_number` LEGO mapping
     - item dimensions/weight → existing product physical fields where appropriate
     - `Type` → `product_type`
   - Create missing category-scoped canonical fields for appliance-specific aspects such as Components Included, Number of Blades, Power Source, Capacity, Colour, Power, Appliance Uses, Features, Voltage, Unit Quantity, etc.
   - Create category-specific `channel_attribute_mapping` rows for `20673` so these fields are considered mapped and editable.

4. **Fix the bootstrap path so cached categories also get repaired**
   - Update `resolve-aspects` and/or cached `aspects` handling in `supabase/functions/ebay-taxonomy/index.ts` so if a category schema is already cached but missing mappings/canonical fields, it runs the bootstrap repair idempotently.
   - This avoids needing a forced fresh fetch from eBay just to create editable fields.

5. **Make bottom eBay aspects editable from the product Specifications tab**
   - Replace the read-only list of “Channel-only Aspects” with editable rows for unmapped/mapped eBay item specifics.
   - Saving should write values back to canonical product columns when a canonical mapping exists.
   - For unmapped fields, provide a quick action to create a category-scoped canonical field/mapping and then allow entering the value.
   - Keep the Settings link for bulk mapping management, but do not force product-by-product users to leave the tab.

6. **Fix global mappings that leak LEGO semantics into non-LEGO categories**
   - Replace or scope down the current global `Model → set_number` mapping so it does not affect Food Processors.
   - Ensure Food Processors use a category-specific mapping for Model/MPN that makes sense for appliances.

7. **Validate with the KitchenAid product**
   - Confirm product `5KFC3516BER` with eBay category Food Processors shows appliance-relevant fields only.
   - Confirm LEGO-specific fields are gone from its Product Specifications tab.
   - Confirm the previously listed bottom aspects are available for editing and/or mapped after bootstrap.

## Technical details

Files likely to change:
- `supabase/migrations/...sql` for data cleanup and mapping repairs
- `supabase/functions/ebay-taxonomy/index.ts` for idempotent bootstrap on cached schemas
- `supabase/functions/_shared/canonical-resolver.ts` if stricter category/type scoping is needed
- `src/components/admin-v2/SpecificationsTab.tsx` to make eBay aspects editable in-place
- `src/hooks/admin/use-channel-taxonomy.ts` if a new quick-bootstrap/save action is needed

The migration and backend changes will be idempotent so re-running them does not duplicate attributes or mappings.