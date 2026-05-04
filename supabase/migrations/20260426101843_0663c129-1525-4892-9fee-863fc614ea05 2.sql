-- ============================================================
-- Canonical attribute scoping + dedupe
-- (data_type uses allowed values: string|int|decimal|date|bool)
-- ============================================================

ALTER TABLE public.canonical_attribute
  ADD COLUMN IF NOT EXISTS applies_to_product_types text[],
  ADD COLUMN IF NOT EXISTS applies_to_ebay_categories text[];

CREATE INDEX IF NOT EXISTS canonical_attribute_product_types_gin
  ON public.canonical_attribute USING gin (applies_to_product_types);
CREATE INDEX IF NOT EXISTS canonical_attribute_ebay_categories_gin
  ON public.canonical_attribute USING gin (applies_to_ebay_categories);

-- Universal attributes
INSERT INTO public.canonical_attribute (key, label, attribute_group, editor, data_type, db_column, provider_chain, editable, sort_order, active)
VALUES
  ('mpn',          'MPN',           'identity',  'text',     'string',  'mpn',          '[{"provider":"product","field":"mpn"}]'::jsonb,          true, 20,  true),
  ('product_name', 'Product Name',  'identity',  'text',     'string',  'name',         '[{"provider":"product","field":"name"}]'::jsonb,         true, 25,  true),
  ('brand',        'Brand',         'identity',  'text',     'string',  'brand',        '[{"provider":"product","field":"brand"}]'::jsonb,        true, 10,  true),
  ('product_type', 'Product Type',  'identity',  'text',     'string',  'product_type', '[{"provider":"product","field":"product_type"}]'::jsonb, true, 15,  true),
  ('ean',          'EAN',           'identity',  'text',     'string',  'ean',          '[{"provider":"product","field":"ean"}]'::jsonb,          true, 32,  true),
  ('upc',          'UPC',           'identity',  'text',     'string',  'upc',          '[{"provider":"product","field":"upc"}]'::jsonb,          true, 30,  true),
  ('isbn',         'ISBN',          'identity',  'text',     'string',  'isbn',         '[{"provider":"product","field":"isbn"}]'::jsonb,         true, 31,  true),
  ('weight_g',     'Weight',        'physical',  'number',   'decimal', 'weight_g',     '[{"provider":"product","field":"weight_g"},{"provider":"derived","field":"weight_kg_to_g"}]'::jsonb, true, 50,  true),
  ('length_cm',    'Length',        'physical',  'number',   'decimal', 'length_cm',    '[{"provider":"product","field":"length_cm"},{"provider":"derived","field":"parse_dimensions_cm_length"}]'::jsonb, true, 60,  true),
  ('width_cm',     'Width',         'physical',  'number',   'decimal', 'width_cm',     '[{"provider":"product","field":"width_cm"},{"provider":"derived","field":"parse_dimensions_cm_width"}]'::jsonb,   true, 61,  true),
  ('height_cm',    'Height',        'physical',  'number',   'decimal', 'height_cm',    '[{"provider":"product","field":"height_cm"},{"provider":"derived","field":"parse_dimensions_cm_height"}]'::jsonb, true, 62,  true),
  ('dimensions_cm','Dimensions (LxWxH)','physical','text',   'string',  'dimensions_cm','[{"provider":"product","field":"dimensions_cm"},{"provider":"derived","field":"compose_dimensions_cm"}]'::jsonb, true, 63,  true),
  ('age_mark',     'Age Mark',      'marketing', 'text',     'string',  'age_mark',     '[{"provider":"product","field":"age_mark"}]'::jsonb,     true, 40,  true),
  ('age_range',    'Recommended Age','marketing','text',     'string',  'age_range',    '[{"provider":"product","field":"age_range"}]'::jsonb,    true, 220, true),
  ('packaging',    'Packaging',     'marketing', 'text',     'string',  null,           '[{"provider":"constant","field":"Box"}]'::jsonb,         false,230, true),
  ('condition',    'Condition',     'marketing', 'text',     'string',  null,           '[]'::jsonb,                                              false,210, true)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  attribute_group = EXCLUDED.attribute_group,
  editor = EXCLUDED.editor,
  data_type = EXCLUDED.data_type,
  db_column = EXCLUDED.db_column,
  provider_chain = EXCLUDED.provider_chain,
  editable = EXCLUDED.editable,
  sort_order = EXCLUDED.sort_order,
  active = true,
  applies_to_product_types = NULL,
  applies_to_ebay_categories = NULL,
  updated_at = now();

-- LEGO-only attributes
INSERT INTO public.canonical_attribute (key, label, attribute_group, editor, data_type, db_column, provider_chain, editable, sort_order, active, applies_to_product_types)
VALUES
  ('set_number',         'Set Number',     'identity',  'text',   'string',  'set_number',         '[{"provider":"product","field":"set_number"},{"provider":"derived","field":"mpn_base"}]'::jsonb, true, 30,  true,  ARRAY['set','minifigure']),
  ('theme',              'Theme',          'identity',  'text',   'string',  null,                 '[{"provider":"theme","field":"name"},{"provider":"product","field":"subtheme_name"}]'::jsonb,  false,50,  true,  ARRAY['set','minifigure']),
  ('subtheme',           'Subtheme',       'identity',  'text',   'string',  'subtheme_name',      '[{"provider":"product","field":"subtheme_name"}]'::jsonb,                                       true, 60,  true,  ARRAY['set','minifigure']),
  ('piece_count',        'Pieces',         'physical',  'number', 'int',     'piece_count',        '[{"provider":"product","field":"piece_count"},{"provider":"catalog","field":"piece_count"}]'::jsonb, true, 100, true, ARRAY['set','minifigure']),
  ('minifig_count',      'Minifigures',    'physical',  'number', 'int',     'minifigs_count',     '[{"provider":"product","field":"minifigs_count"}]'::jsonb,                                      true, 110, true,  ARRAY['set','minifigure']),
  ('release_year',       'Release Year',   'lifecycle', 'number', 'int',     'release_year',       '[{"provider":"product","field":"release_year"},{"provider":"derived","field":"year_from_released_date"}]'::jsonb, true, 200, true, ARRAY['set','minifigure']),
  ('retired_flag',       'Retired',        'lifecycle', 'select', 'bool',    'retired_flag',       '[{"provider":"product","field":"retired_flag"}]'::jsonb,                                        true, 210, true,  ARRAY['set','minifigure']),
  ('version_descriptor', 'Version',        'lifecycle', 'text',   'string',  'version_descriptor', '[{"provider":"product","field":"version_descriptor"}]'::jsonb,                                  true, 220, true,  ARRAY['set','minifigure'])
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  attribute_group = EXCLUDED.attribute_group,
  editor = EXCLUDED.editor,
  data_type = EXCLUDED.data_type,
  db_column = EXCLUDED.db_column,
  provider_chain = EXCLUDED.provider_chain,
  editable = EXCLUDED.editable,
  sort_order = EXCLUDED.sort_order,
  active = true,
  applies_to_product_types = EXCLUDED.applies_to_product_types,
  updated_at = now();

-- Repoint mappings still referencing old camelCase keys
UPDATE public.channel_attribute_mapping SET canonical_key = 'set_number'    WHERE canonical_key = 'setNumber';
UPDATE public.channel_attribute_mapping SET canonical_key = 'piece_count'   WHERE canonical_key = 'pieceCount';
UPDATE public.channel_attribute_mapping SET canonical_key = 'minifig_count' WHERE canonical_key = 'minifigsCount';
UPDATE public.channel_attribute_mapping SET canonical_key = 'release_year'  WHERE canonical_key IN ('releaseYear','releasedDate');
UPDATE public.channel_attribute_mapping SET canonical_key = 'retired_flag'  WHERE canonical_key = 'retiredDate';
UPDATE public.channel_attribute_mapping SET canonical_key = 'weight_g'      WHERE canonical_key = 'weightG';
UPDATE public.channel_attribute_mapping SET canonical_key = 'dimensions_cm' WHERE canonical_key = 'dimensionsCm';
UPDATE public.channel_attribute_mapping SET canonical_key = 'age_mark'      WHERE canonical_key = 'ageMark';
UPDATE public.channel_attribute_mapping SET canonical_key = 'product_type'  WHERE canonical_key = 'productType';
UPDATE public.channel_attribute_mapping SET canonical_key = 'product_name'  WHERE canonical_key = 'name';

-- Delete duplicate camelCase rows
DELETE FROM public.canonical_attribute
 WHERE key IN (
   'setNumber','pieceCount','minifigsCount','releaseYear','releasedDate',
   'retiredDate','weightG','dimensionsCm','ageMark','productType','retailPrice','name'
 );

-- Replace hard-coded Brand=LEGO global with product-sourced mapping
DELETE FROM public.channel_attribute_mapping
 WHERE channel = 'ebay'
   AND aspect_key = 'Brand'
   AND constant_value = 'LEGO'
   AND category_id IS NULL;

INSERT INTO public.channel_attribute_mapping (channel, marketplace, category_id, aspect_key, canonical_key, constant_value, transform, notes)
SELECT 'ebay', NULL, NULL, 'Brand', 'brand', NULL, NULL, 'Sourced from product.brand'
WHERE NOT EXISTS (
  SELECT 1 FROM public.channel_attribute_mapping
   WHERE channel='ebay' AND aspect_key='Brand' AND category_id IS NULL AND marketplace IS NULL
);

-- Backfill brand on existing LEGO products
UPDATE public.product
   SET brand = 'LEGO'
 WHERE brand IS NULL
   AND product_type IN ('set','minifigure');