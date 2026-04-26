I can see the regression pattern. The newer resolver now returns category-specific eBay rows, but the Product Specifications tab still consumes the older `canonical` shape, so canonical values no longer render/edit. The quick-map logic also creates literal eBay-aspect keys such as `item_height` instead of reusing existing canonical fields like `height_cm`, which explains the duplicates and broken mappings.

Plan to fix precisely:

1. Restore Product Specifications editing
   - Update `SpecificationsTab` to consume the resolver’s `rows` response instead of the now-empty legacy `canonical` array.
   - Show only the eBay aspects for the product’s selected category.
   - For mapped rows, display the resolved canonical/constant value, source badge, and manual saved override value.
   - Allow manual edits directly on each category aspect row and persist them to `product_attribute` with the exact scope: channel, marketplace, category, aspect key.
   - Respect eBay allowed values: render a select/multi-select when values are supplied, and only allow free text when `allows_custom` is true.

2. Preserve existing canonical source mappings
   - Change quick-map so it first checks a curated synonym map before creating anything new:
     - `Item Height` -> `height_cm`
     - `Item Length` -> `length_cm`
     - `Item Width` -> `width_cm`
     - `Item Weight` -> `weight_g`
     - `Number of Pieces` -> `piece_count`
     - `LEGO Set Number` / `Model` -> `set_number`
     - `LEGO Set Name` / `Set Name` -> `product_name`
     - `LEGO Theme` / `Theme` -> `theme`
     - `LEGO Subtheme` -> `subtheme`
     - `Release Year` / `Year Manufactured` -> `release_year`
     - `Year Retired` -> `retired_flag` only if appropriate, otherwise leave unmapped for manual decision
     - `Age Level` / `Recommended Age Range` -> `age_mark` or `age_range` depending existing canonical field
     - `Brand`, `MPN`, `EAN`, `Packaging`, `Type` keep existing mappings.
   - Only create a new canonical attribute if no existing canonical field or synonym match exists.
   - When creating new canonical attributes, avoid names that duplicate existing physical/identity concepts.

3. Repair the damaged mapping data
   - Add a data migration to remove/merge duplicate canonical fields that were created by quick-map when they duplicate existing fields, including `item_height` -> `height_cm`, and any matching `item_length`, `item_width`, `item_weight`, etc.
   - Repoint all `channel_attribute_mapping` rows from duplicate keys to the canonical key.
   - Preserve product-entered values by moving duplicate product-column values into the correct product columns or scoped `product_attribute` rows where appropriate.
   - Do not delete any unique/non-duplicate canonical fields that may contain real user data.

4. Fix canonical attributes visibility
   - Keep the Canonical Attributes settings page as a complete registry view: it should show all active canonical attributes, not only attributes for one selected category.
   - Add clear filters/labels for “universal”, “category-scoped”, and provider/source, rather than hiding rows.
   - Make the provider chain visible and editable so BrickEconomy/catalog/product source chains are not lost.

5. Fix channel mapping display across categories
   - In Channel Mappings, for a selected category, show:
     - every eBay aspect available for that category,
     - inherited default mappings,
     - marketplace mappings,
     - category-specific overrides.
   - Make scope explicit so deleting or editing a category-specific mapping cannot accidentally remove the global/default mapping.
   - Ensure the mapping list remains keyed by category aspect, not canonical field name, because the same eBay aspect can have different allowed values per category.

6. Backend save changes
   - Extend `save-product-attributes` to accept and persist `channel`, `marketplace`, `category_id`, `aspect_key`, `is_override`, and `source_value`.
   - Update the resolver to read both legacy unscoped product attributes and new scoped category attributes so existing manually-entered values reappear.
   - Keep existing direct product-table edits only for true canonical product facts; category-specific eBay overrides should live in `product_attribute`.

7. Validation after implementation
   - Test with category `19006` and `263012` because both are cached and share several aspects.
   - Confirm `Item Height` maps to `height_cm` and does not create/display `item_height` as a duplicate canonical field.
   - Confirm BrickEconomy/provider chains remain visible in Canonical Attributes.
   - Confirm manual edits persist after page refresh and category change.
   - Confirm allowed values display per category when eBay supplies them.

Technical note: this will require both code changes and a database data-cleanup migration. I will not touch the generated backend client/types files.