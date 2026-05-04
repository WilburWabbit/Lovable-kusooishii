-- 1. Tighten scoping on LEGO-only canonical attributes so they require BOTH a
--    LEGO product type AND a LEGO eBay category before showing. This
--    prevents Theme/Subtheme/Pieces/etc. leaking into non-LEGO categories
--    even when the product still has product_type = 'set'.
UPDATE public.canonical_attribute
   SET applies_to_ebay_categories = ARRAY['19006','263012']
 WHERE key IN (
   'set_number','theme','subtheme','piece_count','minifig_count',
   'release_year','retired_flag','version_descriptor'
 );

-- 2. Drop the global Brand=LEGO/brand mapping and re-create it scoped to
--    LEGO categories only so the constant doesn't bleed into Food Processors.
DELETE FROM public.channel_attribute_mapping
 WHERE channel='ebay' AND aspect_key='Brand'
   AND category_id IS NULL;

INSERT INTO public.channel_attribute_mapping
  (channel, marketplace, category_id, aspect_key, canonical_key, constant_value, transform, notes)
VALUES
  ('ebay', NULL, '19006',  'Brand', 'brand', NULL, NULL, 'Sourced from product.brand'),
  ('ebay', NULL, '263012', 'Brand', 'brand', NULL, NULL, 'Sourced from product.brand');

-- 3. Remove the global "Model -> set_number" mapping so it doesn't apply
--    to non-LEGO categories. LEGO categories already have LEGO-specific
--    aspects (LEGO Set Number) covered by their own mappings.
DELETE FROM public.channel_attribute_mapping
 WHERE channel='ebay' AND aspect_key='Model'
   AND category_id IS NULL;

-- 4. Reclassify products in known non-LEGO eBay categories so the canonical
--    resolver no longer treats them as LEGO sets.
UPDATE public.product
   SET product_type = 'food_processor'
 WHERE ebay_category_id = '20673';

-- 5. Backfill brand on products that look like KitchenAid food processors
--    but have no brand set yet.
UPDATE public.product
   SET brand = 'KitchenAid'
 WHERE brand IS NULL
   AND (
     name ILIKE '%kitchenaid%'
     OR mpn ILIKE 'KA-%'
     OR mpn ILIKE '5KFC%'
     OR mpn ILIKE '5KFP%'
   );