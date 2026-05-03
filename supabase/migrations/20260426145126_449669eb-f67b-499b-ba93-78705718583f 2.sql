
-- 1. Cleanup
DELETE FROM public.channel_attribute_mapping cam
 WHERE cam.canonical_key IN (
   SELECT key FROM public.canonical_attribute
    WHERE applies_to_ebay_categories IS NOT NULL
      AND array_length(applies_to_ebay_categories, 1) > 0
 );

DELETE FROM public.channel_attribute_mapping
 WHERE notes = 'Auto-bootstrapped from eBay category schema';

DELETE FROM public.canonical_attribute
 WHERE applies_to_ebay_categories IS NOT NULL
   AND array_length(applies_to_ebay_categories, 1) > 0;

-- 2. product_attribute schema extension
ALTER TABLE public.product_attribute
  ADD COLUMN IF NOT EXISTS channel        text,
  ADD COLUMN IF NOT EXISTS marketplace    text,
  ADD COLUMN IF NOT EXISTS category_id    text,
  ADD COLUMN IF NOT EXISTS aspect_key     text,
  ADD COLUMN IF NOT EXISTS is_override    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_value   text;

ALTER TABLE public.product_attribute
  DROP CONSTRAINT IF EXISTS product_attribute_product_id_namespace_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS product_attribute_unique_scope
  ON public.product_attribute (
    product_id,
    namespace,
    COALESCE(channel, ''),
    COALESCE(marketplace, ''),
    COALESCE(category_id, ''),
    key
  );

CREATE INDEX IF NOT EXISTS product_attribute_lookup
  ON public.product_attribute (product_id, channel, marketplace, category_id);

-- 3. Bulk category assignment
CREATE OR REPLACE FUNCTION public.bulk_set_ebay_category(
  p_product_ids uuid[],
  p_category_id text,
  p_marketplace text DEFAULT 'EBAY_GB'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'staff'::app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden: admin or staff role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.product
     SET ebay_category_id = p_category_id,
         ebay_marketplace = COALESCE(p_marketplace, ebay_marketplace, 'EBAY_GB')
   WHERE id = ANY(p_product_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_set_ebay_category(uuid[], text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.bulk_set_ebay_category(uuid[], text, text)
  TO authenticated, service_role;

-- 4. Schema fetch helper
CREATE OR REPLACE FUNCTION public.get_ebay_category_schema(
  p_marketplace text,
  p_category_id text
)
RETURNS TABLE (
  aspect_key      text,
  label           text,
  required        boolean,
  cardinality     text,
  data_type       text,
  allowed_values  jsonb,
  allows_custom   boolean,
  sort_order      integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cca.key,
    cca.label,
    cca.required,
    cca.cardinality,
    cca.data_type,
    cca.allowed_values,
    cca.allows_custom,
    cca.sort_order
  FROM public.channel_category_schema   ccs
  JOIN public.channel_category_attribute cca ON cca.schema_id = ccs.id
  WHERE ccs.channel       = 'ebay'
    AND ccs.marketplace   = p_marketplace
    AND ccs.category_id   = p_category_id
  ORDER BY cca.sort_order;
$$;

REVOKE ALL ON FUNCTION public.get_ebay_category_schema(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_ebay_category_schema(text, text)
  TO authenticated, service_role;
