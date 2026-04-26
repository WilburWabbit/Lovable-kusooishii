-- 1. Add missing identifier columns on product
ALTER TABLE public.product
  ADD COLUMN IF NOT EXISTS upc text,
  ADD COLUMN IF NOT EXISTS isbn text;

-- 2. Redirect Weight aspect mapping off the broken weight_grams key, then drop it.
UPDATE public.channel_attribute_mapping
   SET canonical_key = 'weightG'
 WHERE canonical_key = 'weight_grams';
DELETE FROM public.canonical_attribute WHERE key = 'weight_grams';

-- 3. Rename broken *_mm canonical keys to the correct *_cm ones (FK ON UPDATE CASCADE).
UPDATE public.canonical_attribute SET key = 'length_cm' WHERE key = 'length_mm';
UPDATE public.canonical_attribute SET key = 'width_cm'  WHERE key = 'width_mm';
UPDATE public.canonical_attribute SET key = 'height_cm' WHERE key = 'height_mm';

-- 4. Refresh the renamed physical attributes (data_type must be one of string/int/decimal/date/bool)
UPDATE public.canonical_attribute
   SET label = 'Length', attribute_group = 'physical', editor = 'number',
       data_type = 'decimal', unit = 'cm', db_column = 'length_cm',
       provider_chain = '[{"provider":"product","field":"length_cm"},{"provider":"derived","field":"parse_dimensions_cm_length"}]'::jsonb,
       editable = true, sort_order = 60, active = true, updated_at = now()
 WHERE key = 'length_cm';

UPDATE public.canonical_attribute
   SET label = 'Width', attribute_group = 'physical', editor = 'number',
       data_type = 'decimal', unit = 'cm', db_column = 'width_cm',
       provider_chain = '[{"provider":"product","field":"width_cm"},{"provider":"derived","field":"parse_dimensions_cm_width"}]'::jsonb,
       editable = true, sort_order = 61, active = true, updated_at = now()
 WHERE key = 'width_cm';

UPDATE public.canonical_attribute
   SET label = 'Height', attribute_group = 'physical', editor = 'number',
       data_type = 'decimal', unit = 'cm', db_column = 'height_cm',
       provider_chain = '[{"provider":"product","field":"height_cm"},{"provider":"derived","field":"parse_dimensions_cm_height"}]'::jsonb,
       editable = true, sort_order = 62, active = true, updated_at = now()
 WHERE key = 'height_cm';

-- 5. Refresh the surviving Weight attribute
UPDATE public.canonical_attribute
   SET label = 'Weight', attribute_group = 'physical', editor = 'number',
       data_type = 'int', unit = 'g', db_column = 'weight_g',
       provider_chain = '[{"provider":"product","field":"weight_g"},{"provider":"derived","field":"weight_kg_to_g"}]'::jsonb,
       editable = true, sort_order = 50, active = true, updated_at = now()
 WHERE key = 'weightG';

-- 6. Add Dimensions (LxWxH) composite attribute
INSERT INTO public.canonical_attribute
  (key, label, attribute_group, editor, data_type, unit, db_column, provider_chain, editable, sort_order, active)
VALUES
  ('dimensions_cm', 'Dimensions (LxWxH)', 'physical', 'text', 'string', 'cm', 'dimensions_cm',
    '[{"provider":"product","field":"dimensions_cm"},{"provider":"derived","field":"compose_dimensions_cm"}]'::jsonb,
    true, 63, true)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label, attribute_group = EXCLUDED.attribute_group,
  editor = EXCLUDED.editor, data_type = EXCLUDED.data_type, unit = EXCLUDED.unit,
  db_column = EXCLUDED.db_column, provider_chain = EXCLUDED.provider_chain,
  editable = EXCLUDED.editable, sort_order = EXCLUDED.sort_order,
  active = EXCLUDED.active, updated_at = now();

-- 7. Add missing identity attributes (UPC, ISBN, Age Mark)
INSERT INTO public.canonical_attribute
  (key, label, attribute_group, editor, data_type, unit, db_column, provider_chain, editable, sort_order, active)
VALUES
  ('upc', 'UPC', 'identity', 'text', 'string', NULL, 'upc',
    '[{"provider":"product","field":"upc"}]'::jsonb, true, 30, true),
  ('isbn', 'ISBN', 'identity', 'text', 'string', NULL, 'isbn',
    '[{"provider":"product","field":"isbn"}]'::jsonb, true, 31, true),
  ('age_mark', 'Age Mark', 'marketing', 'text', 'string', NULL, 'age_mark',
    '[{"provider":"product","field":"age_mark"},{"provider":"product","field":"age_range"},{"provider":"catalog","field":"age_range"}]'::jsonb,
    true, 40, true)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label, attribute_group = EXCLUDED.attribute_group,
  editor = EXCLUDED.editor, data_type = EXCLUDED.data_type,
  db_column = EXCLUDED.db_column, provider_chain = EXCLUDED.provider_chain,
  editable = EXCLUDED.editable, sort_order = EXCLUDED.sort_order,
  active = EXCLUDED.active, updated_at = now();

-- 8. Re-anchor EAN to product first, BE second
UPDATE public.canonical_attribute
   SET provider_chain = '[{"provider":"product","field":"ean"},{"provider":"brickeconomy","field":"ean"}]'::jsonb,
       db_column = 'ean', sort_order = 32, updated_at = now()
 WHERE key = 'ean';