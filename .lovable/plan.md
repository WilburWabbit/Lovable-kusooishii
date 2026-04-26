I’ve reviewed the current implementation and the frustration is justified. The existing system is mixing three ideas that must be kept separate: eBay category aspect schemas, reusable canonical product values, and per-category channel mappings. That is why LEGO fields leak into food processors, deleting mappings can affect other categories, manual values do not persist reliably, and publishing still has hardcoded assumptions.

Plan to fix the functionality properly:

1. Stop the Specifications tab from showing app-assumed attributes
- Change product Specifications to be driven by the selected product category’s eBay aspect schema.
- Display only attributes that exist in the selected category schema, plus future non-eBay channel attributes when those channels are added.
- Remove the current pattern where the tab displays every active canonical attribute that happens to match broad product/category scope.
- Keep universal fields visible only when they are mapped to an eBay aspect for the selected category.

2. Separate category schema from category mappings
- Treat `channel_category_attribute` as the immutable cached eBay schema per `(channel, marketplace, category_id, aspect_key)`.
- Treat `channel_attribute_mapping` as category-scoped mapping rules, never as global behavior unless explicitly saved as “all categories”.
- Fix delete behavior so deleting a mapping from one selected category deletes only that exact category mapping, not a default/all-category mapping or another category’s mapping.
- Fix upsert behavior to correctly replace only the exact mapping scope, including `NULL` marketplace/category cases.

3. Store canonical product values in one reliable place
- Use `product_attribute` as the canonical per-product attribute value store for dynamic/category-specific specs rather than continuously adding product columns for every eBay aspect.
- Keep existing product columns for true first-class product fields like MPN, brand, dimensions, weight, EAN, LEGO catalog fields, etc.
- For manually entered or overwritten values, persist them as canonical product values with source metadata.
- Ensure overrides are visible immediately after save and win over automatic provider values.

4. Add value-source mapping in Channel Mappings settings
- Extend mapping settings so each category aspect can choose a source:
  - Product field
  - BrickEconomy field
  - Catalog field
  - Constant/fixed value
  - Manual canonical product value
- Keep mapping setup in the backend/admin settings, not scattered across product UI.
- Show category-specific eBay allowed values, cardinality, required flag, and whether custom values are allowed.
- Prevent settings for one category from altering another category’s mappings unless the user explicitly edits an “all categories” default.

5. Support eBay allowed values correctly
- Preserve eBay aspect metadata per category: allowed values, single/multi cardinality, required/optional, custom-value permission.
- In the product Specifications tab:
  - Use dropdown/multiselect when eBay provides allowed values.
  - Allow free text only when the category aspect allows custom values.
  - Validate required fields before save/publish.
- This must be per category because the same aspect name can have different allowed values in different categories.

6. Repair backend resolution and publishing
- Replace `resolve-aspects` so it returns a product’s effective category-specific specification rows, each containing:
  - aspect metadata from eBay schema
  - mapping/source definition
  - automatically resolved value
  - saved manual/override value
  - final value to publish
- Update `ebay-push-listing` to build item specifics from this resolver only.
- Remove hardcoded eBay assumptions such as default `Brand = LEGO` and `mapCoreToEbayAspect`; those are exactly the kind of leaks causing incorrect listings.

7. Bulk category assignment
- Add backend support for bulk setting channel category by product IDs or filters.
- Add UI in product list/settings to select products and assign an eBay category in bulk.
- On category change, do not delete existing canonical product values; just show/hide them according to the newly selected category’s schema.

8. Data cleanup and migration
- Clean existing incorrect mappings and stale canonical rows caused by auto-bootstrapping.
- Keep the current cached eBay category schemas, but stop using bootstrapping to create assumptions.
- Convert relevant existing product-column/manual values into `product_attribute` rows where appropriate.
- Remove or disable mappings that were created for the wrong category, especially LEGO aspects tied to food processor category `20673`.

Technical implementation details
- Database/schema:
  - Add mapping-source metadata to `channel_attribute_mapping` if needed, or create a separate structured mapping table if cleaner.
  - Add fields to `product_attribute` for canonical key/channel aspect relationship and source metadata if needed.
  - Keep RLS/admin access consistent with existing staff/admin policies.
- Backend functions:
  - Refactor `supabase/functions/_shared/canonical-resolver.ts` into a channel-agnostic resolver.
  - Update `supabase/functions/ebay-taxonomy/index.ts` actions for listing schemas, mappings, resolving product specs, and safe category-scoped CRUD.
  - Update `supabase/functions/admin-data/index.ts` for bulk category assignment and robust product attribute save/load.
  - Update `supabase/functions/ebay-push-listing/index.ts` to use resolved specs only.
- Frontend:
  - Rework `SpecificationsTab.tsx` around returned aspect rows instead of active canonical attributes.
  - Rework `ChannelMappingsPanel.tsx` to edit source mappings per selected category and show allowed values/constraints.
  - Add bulk category controls to the admin product list.
- Validation:
  - Test the KitchenAid food processor product: it should show only the 32 food processor aspects from eBay category `20673`.
  - Test LEGO sets/minifigures: they should show only their category aspects.
  - Test deleting a mapping from food processors does not affect LEGO categories.
  - Test manual values persist, override automatic values, and publish to eBay.
  - Test publish payload no longer contains hardcoded LEGO attributes for non-LEGO categories.