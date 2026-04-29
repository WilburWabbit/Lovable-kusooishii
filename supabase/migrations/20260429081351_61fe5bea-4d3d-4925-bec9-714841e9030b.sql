ALTER TABLE public.product_attribute
  DROP CONSTRAINT IF EXISTS product_attribute_namespace_check;

ALTER TABLE public.product_attribute
  ADD CONSTRAINT product_attribute_namespace_check
  CHECK (namespace = ANY (ARRAY['core'::text, 'ebay'::text, 'gmc'::text, 'meta'::text, 'web'::text, 'bricklink'::text, 'brickowl'::text, 'brickset'::text]));