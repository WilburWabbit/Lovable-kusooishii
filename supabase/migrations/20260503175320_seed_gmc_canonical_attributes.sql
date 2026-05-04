-- Seed canonical attributes used by GMC field mappings.
-- These are app-mastered or publisher-derived source keys referenced by
-- channel_attribute_mapping.canonical_key. Keep idempotent for Lovable runs.

INSERT INTO public.canonical_attribute
  (key, label, attribute_group, editor, data_type, unit, db_column, provider_chain, editable, sort_order, active)
VALUES
  ('title', 'GMC title', 'marketing', 'readOnly', 'string', NULL, NULL,
   '[{"provider":"derived","field":"title"}]'::jsonb, false, 900, true),
  ('description', 'GMC description', 'marketing', 'readOnly', 'string', NULL, NULL,
   '[{"provider":"derived","field":"description"}]'::jsonb, false, 901, true),
  ('link', 'Product URL', 'marketing', 'readOnly', 'string', NULL, NULL,
   '[{"provider":"derived","field":"link"}]'::jsonb, false, 902, true),
  ('image_link', 'Primary image URL', 'marketing', 'readOnly', 'string', NULL, NULL,
   '[{"provider":"derived","field":"image_link"}]'::jsonb, false, 903, true),
  ('price_amount_micros', 'Price amount micros', 'value', 'readOnly', 'decimal', 'micros', NULL,
   '[{"provider":"derived","field":"price_amount_micros"}]'::jsonb, false, 904, true),
  ('availability_from_stock', 'Availability from stock', 'lifecycle', 'readOnly', 'string', NULL, NULL,
   '[{"provider":"derived","field":"availability_from_stock"}]'::jsonb, false, 905, true),
  ('condition_from_grade', 'Condition from grade', 'lifecycle', 'readOnly', 'string', NULL, NULL,
   '[{"provider":"derived","field":"condition_from_grade"}]'::jsonb, false, 906, true),
  ('gtin', 'GTIN', 'identity', 'readOnly', 'string', NULL, NULL,
   '[{"provider":"derived","field":"gtin"},{"provider":"product","field":"ean"},{"provider":"product","field":"upc"},{"provider":"product","field":"isbn"}]'::jsonb, false, 907, true),
  ('identifier_exists', 'Identifier exists', 'identity', 'readOnly', 'string', NULL, NULL,
   '[{"provider":"derived","field":"identifier_exists"}]'::jsonb, false, 908, true),
  ('gmc_product_category', 'Google product category', 'marketing', 'text', 'string', NULL, 'gmc_product_category',
   '[{"provider":"product","field":"gmc_product_category"}]'::jsonb, true, 909, true),
  ('product_type_path', 'Product type path', 'marketing', 'readOnly', 'string', NULL, NULL,
   '[{"provider":"derived","field":"product_type_path"}]'::jsonb, false, 910, true),
  ('weight_g', 'Weight', 'physical', 'number', 'decimal', 'g', NULL,
   '[{"provider":"derived","field":"weight_g"},{"provider":"product","field":"weight_kg"}]'::jsonb, false, 911, true)
ON CONFLICT (key) DO NOTHING;
