
-- ============================================================
-- Phase 1: Multi-source product enrichment schema
-- HARD CONSTRAINT: BrickEconomy value/price tables and pipeline are NOT touched.
-- ============================================================

-- 1. Widen canonical_attribute.attribute_group to include 'value'
ALTER TABLE public.canonical_attribute
  DROP CONSTRAINT canonical_attribute_attribute_group_check;
ALTER TABLE public.canonical_attribute
  ADD CONSTRAINT canonical_attribute_attribute_group_check
  CHECK (attribute_group = ANY (ARRAY[
    'identity','physical','lifecycle','marketing','value','other'
  ]));

UPDATE public.canonical_attribute
   SET attribute_group = 'value'
 WHERE key IN ('retail_price');

-- Seed missing canonical attributes the spec catalogs feed
INSERT INTO public.canonical_attribute
  (key, label, attribute_group, editor, data_type, provider_chain, editable, sort_order, active)
VALUES
  ('image_url','Image URL','marketing','text','string','[]'::jsonb, true, 200, true)
ON CONFLICT (key) DO NOTHING;

-- Value-group attributes BrickEconomy provides (read-only, locked source)
INSERT INTO public.canonical_attribute
  (key, label, attribute_group, editor, data_type, provider_chain, editable, sort_order, active)
VALUES
  ('current_value','Market Value','value','readOnly','decimal',
    '[{"provider":"brickeconomy","field":"current_value"}]'::jsonb, false, 510, true),
  ('value_growth','Value Growth','value','readOnly','decimal',
    '[{"provider":"brickeconomy","field":"growth"}]'::jsonb, false, 520, true),
  ('market_price','Market Price','value','readOnly','decimal',
    '[{"provider":"brickeconomy","field":"current_value"}]'::jsonb, false, 530, true)
ON CONFLICT (key) DO NOTHING;

-- 2. Per-source spec catalog tables (NON-VALUE fields only)
CREATE TABLE IF NOT EXISTS public.bricklink_catalog_item (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mpn             text NOT NULL UNIQUE,
  name            text,
  theme           text,
  subtheme        text,
  release_year    integer,
  piece_count     integer,
  minifig_count   integer,
  weight_g        numeric,
  length_cm       numeric,
  width_cm        numeric,
  height_cm       numeric,
  age_mark        text,
  image_url       text,
  raw_attributes  jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.brickowl_catalog_item     (LIKE public.bricklink_catalog_item INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.brickset_catalog_item     (LIKE public.bricklink_catalog_item INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.brickeconomy_catalog_item (LIKE public.bricklink_catalog_item INCLUDING ALL);

CREATE TRIGGER trg_bricklink_catalog_updated_at    BEFORE UPDATE ON public.bricklink_catalog_item    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_brickowl_catalog_updated_at     BEFORE UPDATE ON public.brickowl_catalog_item     FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_brickset_catalog_updated_at     BEFORE UPDATE ON public.brickset_catalog_item     FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_brickeconomy_catalog_updated_at BEFORE UPDATE ON public.brickeconomy_catalog_item FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.bricklink_catalog_item    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brickowl_catalog_item     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brickset_catalog_item     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brickeconomy_catalog_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spec catalog readable by authenticated" ON public.bricklink_catalog_item    FOR SELECT TO authenticated USING (true);
CREATE POLICY "spec catalog managed by staff"          ON public.bricklink_catalog_item    TO authenticated USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'staff')) WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'staff'));
CREATE POLICY "spec catalog readable by authenticated" ON public.brickowl_catalog_item     FOR SELECT TO authenticated USING (true);
CREATE POLICY "spec catalog managed by staff"          ON public.brickowl_catalog_item     TO authenticated USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'staff')) WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'staff'));
CREATE POLICY "spec catalog readable by authenticated" ON public.brickset_catalog_item     FOR SELECT TO authenticated USING (true);
CREATE POLICY "spec catalog managed by staff"          ON public.brickset_catalog_item     TO authenticated USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'staff')) WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'staff'));
CREATE POLICY "spec catalog readable by authenticated" ON public.brickeconomy_catalog_item FOR SELECT TO authenticated USING (true);
CREATE POLICY "spec catalog managed by staff"          ON public.brickeconomy_catalog_item TO authenticated USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'staff')) WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'staff'));

-- 3. Landing tables for the three new sources
CREATE TABLE IF NOT EXISTS public.landing_raw_bricklink (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id     text NOT NULL UNIQUE,
  entity_type     text NOT NULL DEFAULT 'item',
  raw_payload     jsonb NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  status          public.landing_status NOT NULL DEFAULT 'pending',
  error_message   text,
  correlation_id  uuid DEFAULT gen_random_uuid()
);
CREATE INDEX IF NOT EXISTS idx_landing_bricklink_status ON public.landing_raw_bricklink (status) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS public.landing_raw_brickowl (LIKE public.landing_raw_bricklink INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.landing_raw_brickset (LIKE public.landing_raw_bricklink INCLUDING ALL);

ALTER TABLE public.landing_raw_bricklink ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_raw_brickowl  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_raw_brickset  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "landing managed by staff" ON public.landing_raw_bricklink TO authenticated USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'staff')) WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'staff'));
CREATE POLICY "landing managed by staff" ON public.landing_raw_brickowl  TO authenticated USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'staff')) WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'staff'));
CREATE POLICY "landing managed by staff" ON public.landing_raw_brickset  TO authenticated USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'staff')) WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'staff'));

-- 4. Cross-source field equivalence registry
CREATE TABLE IF NOT EXISTS public.source_field_mapping (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source        text NOT NULL CHECK (source IN ('bricklink','brickowl','brickset','brickeconomy')),
  source_field  text NOT NULL,
  canonical_key text NOT NULL REFERENCES public.canonical_attribute(key) ON UPDATE CASCADE ON DELETE CASCADE,
  transform     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_field, canonical_key)
);
CREATE INDEX idx_source_field_mapping_canonical ON public.source_field_mapping (canonical_key);

CREATE TRIGGER trg_source_field_mapping_updated_at BEFORE UPDATE ON public.source_field_mapping FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.source_field_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY "source_field_mapping readable by authenticated" ON public.source_field_mapping FOR SELECT TO authenticated USING (true);
CREATE POLICY "source_field_mapping managed by staff"          ON public.source_field_mapping TO authenticated USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'staff')) WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'staff'));

-- 5. Guardrail: value-group canonical attributes can ONLY be sourced from BrickEconomy.
CREATE OR REPLACE FUNCTION public.enforce_value_attr_brickeconomy_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_group text;
BEGIN
  SELECT attribute_group INTO v_group FROM public.canonical_attribute WHERE key = NEW.canonical_key;
  IF v_group = 'value' AND NEW.source <> 'brickeconomy' THEN
    RAISE EXCEPTION 'Value-group canonical attribute % may only be sourced from BrickEconomy (got %)',
      NEW.canonical_key, NEW.source USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_source_field_mapping_value_lock
  BEFORE INSERT OR UPDATE ON public.source_field_mapping
  FOR EACH ROW EXECUTE FUNCTION public.enforce_value_attr_brickeconomy_only();

CREATE OR REPLACE FUNCTION public.enforce_value_group_no_external_mappings()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.attribute_group = 'value' AND EXISTS (
    SELECT 1 FROM public.source_field_mapping
     WHERE canonical_key = NEW.key AND source <> 'brickeconomy'
  ) THEN
    RAISE EXCEPTION 'Cannot mark % as value group: non-BrickEconomy source mappings exist', NEW.key
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_canonical_attribute_value_group_check
  BEFORE INSERT OR UPDATE OF attribute_group ON public.canonical_attribute
  FOR EACH ROW EXECUTE FUNCTION public.enforce_value_group_no_external_mappings();

-- 6. Extend product_attribute
ALTER TABLE public.product_attribute
  ADD COLUMN IF NOT EXISTS chosen_source       text,
  ADD COLUMN IF NOT EXISTS custom_value        text,
  ADD COLUMN IF NOT EXISTS source_values_jsonb jsonb;

ALTER TABLE public.product_attribute
  DROP CONSTRAINT IF EXISTS product_attribute_chosen_source_check;
ALTER TABLE public.product_attribute
  ADD CONSTRAINT product_attribute_chosen_source_check
  CHECK (chosen_source IS NULL OR chosen_source IN
    ('product','catalog','brickeconomy','bricklink','brickowl','brickset','rebrickable','custom','none'));

UPDATE public.product_attribute
   SET chosen_source = source
 WHERE chosen_source IS NULL
   AND source IN ('brickeconomy','catalog');

-- 7. Seed default field-name mappings (spec attributes only — value attrs intentionally absent)
INSERT INTO public.source_field_mapping (source, source_field, canonical_key) VALUES
  ('bricklink','name','product_name'),
  ('bricklink','category_name','theme'),
  ('bricklink','year_released','release_year'),
  ('bricklink','weight','weight_g'),
  ('bricklink','dim_x','length_cm'),
  ('bricklink','dim_y','width_cm'),
  ('bricklink','dim_z','height_cm'),
  ('bricklink','image_url','image_url'),
  ('brickowl','name','product_name'),
  ('brickowl','category_name','theme'),
  ('brickowl','year','release_year'),
  ('brickowl','weight','weight_g'),
  ('brickowl','dimensions_x','length_cm'),
  ('brickowl','dimensions_y','width_cm'),
  ('brickowl','dimensions_z','height_cm'),
  ('brickowl','image_small','image_url'),
  ('brickset','name','product_name'),
  ('brickset','theme','theme'),
  ('brickset','subtheme','subtheme'),
  ('brickset','year','release_year'),
  ('brickset','pieces','piece_count'),
  ('brickset','minifigs','minifig_count'),
  ('brickset','height','height_cm'),
  ('brickset','width','width_cm'),
  ('brickset','depth','length_cm'),
  ('brickset','weight','weight_g'),
  ('brickset','ageRange_min','age_mark'),
  ('brickset','image_imageURL','image_url'),
  ('brickeconomy','name','product_name'),
  ('brickeconomy','theme','theme'),
  ('brickeconomy','subtheme','subtheme'),
  ('brickeconomy','year','release_year'),
  ('brickeconomy','pieces_count','piece_count'),
  ('brickeconomy','minifigs_count','minifig_count')
ON CONFLICT (source, source_field, canonical_key) DO NOTHING;
