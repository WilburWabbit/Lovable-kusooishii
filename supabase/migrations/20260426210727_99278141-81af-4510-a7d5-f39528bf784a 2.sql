
-- 1. Restore LEGO-relevant canonical attributes that were dropped.
INSERT INTO public.canonical_attribute
  (key, label, attribute_group, editor, data_type, unit, db_column, provider_chain, editable, sort_order, active, applies_to_product_types)
VALUES
  ('set_number',         'Set Number',     'identity',  'text',   'string',  NULL,  'set_number',
   '[{"provider":"product","field":"set_number"},{"provider":"derived","field":"mpn_base"}]'::jsonb,
   true, 30,  true, ARRAY['set','minifigure']),
  ('theme',              'Theme',          'identity',  'text',   'string',  NULL,  NULL,
   '[{"provider":"theme","field":"name"},{"provider":"brickeconomy","field":"theme"}]'::jsonb,
   false, 50, true, ARRAY['set','minifigure']),
  ('subtheme',           'Subtheme',       'identity',  'text',   'string',  NULL,  'subtheme_name',
   '[{"provider":"product","field":"subtheme_name"},{"provider":"brickeconomy","field":"subtheme"}]'::jsonb,
   true, 60, true, ARRAY['set','minifigure']),
  ('piece_count',        'Pieces',         'physical',  'number', 'int',     NULL,  'piece_count',
   '[{"provider":"product","field":"piece_count"},{"provider":"brickeconomy","field":"pieces_count"},{"provider":"catalog","field":"piece_count"}]'::jsonb,
   true, 100, true, ARRAY['set','minifigure']),
  ('minifig_count',      'Minifigures',    'physical',  'number', 'int',     NULL,  'minifigs_count',
   '[{"provider":"product","field":"minifigs_count"},{"provider":"brickeconomy","field":"minifigs_count"}]'::jsonb,
   true, 110, true, ARRAY['set','minifigure']),
  ('release_year',       'Release Year',   'lifecycle', 'number', 'int',     NULL,  'release_year',
   '[{"provider":"product","field":"release_year"},{"provider":"brickeconomy","field":"year"},{"provider":"derived","field":"year_from_released_date"}]'::jsonb,
   true, 200, true, ARRAY['set','minifigure']),
  ('retired_flag',       'Retired',        'lifecycle', 'select', 'bool',    NULL,  'retired_flag',
   '[{"provider":"product","field":"retired_flag"}]'::jsonb,
   true, 210, true, ARRAY['set','minifigure']),
  ('version_descriptor', 'Version',        'lifecycle', 'text',   'string',  NULL,  'version_descriptor',
   '[{"provider":"product","field":"version_descriptor"}]'::jsonb,
   true, 220, true, ARRAY['set','minifigure']),
  ('retail_price',       'RRP',            'marketing', 'number', 'decimal', 'GBP', 'retail_price',
   '[{"provider":"product","field":"retail_price"},{"provider":"brickeconomy","field":"retail_price"}]'::jsonb,
   true, 300, true, NULL)
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

-- 2. Remove the orphan item_height column (if it was ever created)
ALTER TABLE public.product DROP COLUMN IF EXISTS item_height;

-- 3. Repoint any duplicate camelCase / item_* keys onto the canonical ones
UPDATE public.channel_attribute_mapping SET canonical_key = 'height_cm'   WHERE canonical_key IN ('item_height','itemheight');
UPDATE public.channel_attribute_mapping SET canonical_key = 'length_cm'   WHERE canonical_key IN ('item_length','itemlength');
UPDATE public.channel_attribute_mapping SET canonical_key = 'width_cm'    WHERE canonical_key IN ('item_width','itemwidth');
UPDATE public.channel_attribute_mapping SET canonical_key = 'weight_g'    WHERE canonical_key IN ('item_weight','itemweight');
UPDATE public.channel_attribute_mapping SET canonical_key = 'piece_count' WHERE canonical_key IN ('number_of_pieces','numberofpieces');
UPDATE public.channel_attribute_mapping SET canonical_key = 'set_number'  WHERE canonical_key IN ('lego_set_number','model');
UPDATE public.channel_attribute_mapping SET canonical_key = 'product_name' WHERE canonical_key IN ('lego_set_name','set_name');
UPDATE public.channel_attribute_mapping SET canonical_key = 'theme'       WHERE canonical_key IN ('lego_theme');
UPDATE public.channel_attribute_mapping SET canonical_key = 'subtheme'    WHERE canonical_key IN ('lego_subtheme');

-- 4. Drop duplicate canonical rows (keep the canonical key)
DELETE FROM public.canonical_attribute
 WHERE key IN (
   'item_height','item_length','item_width','item_weight',
   'itemheight','itemlength','itemwidth','itemweight',
   'number_of_pieces','numberofpieces',
   'lego_set_number','lego_set_name','lego_theme','lego_subtheme','model','set_name'
 );

-- 5. Seed default eBay mappings for the restored fields (only if not present)
INSERT INTO public.channel_attribute_mapping (channel, marketplace, category_id, aspect_key, canonical_key, constant_value, notes)
SELECT 'ebay', NULL, NULL, v.aspect_key, v.canonical_key, NULL, 'Restored default mapping'
FROM (VALUES
  ('Number of Pieces','piece_count'),
  ('LEGO Set Number','set_number'),
  ('Model','set_number'),
  ('LEGO Set Name','product_name'),
  ('Set Name','product_name'),
  ('LEGO Theme','theme'),
  ('Theme','theme'),
  ('LEGO Subtheme','subtheme'),
  ('Year Manufactured','release_year'),
  ('Release Year','release_year'),
  ('Year','release_year'),
  ('Item Height','height_cm'),
  ('Item Length','length_cm'),
  ('Item Width','width_cm'),
  ('Item Weight','weight_g'),
  ('Age Level','age_mark'),
  ('Recommended Age Range','age_mark')
) AS v(aspect_key, canonical_key)
WHERE NOT EXISTS (
  SELECT 1 FROM public.channel_attribute_mapping m
   WHERE m.channel='ebay' AND m.aspect_key=v.aspect_key AND m.category_id IS NULL AND m.marketplace IS NULL
);
