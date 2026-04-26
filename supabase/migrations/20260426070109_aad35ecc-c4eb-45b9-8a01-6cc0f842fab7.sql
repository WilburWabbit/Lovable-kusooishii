-- ============================================================
-- Canonical attribute registry
-- ============================================================
CREATE TABLE public.canonical_attribute (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  attribute_group text NOT NULL DEFAULT 'identity'
    CHECK (attribute_group IN ('identity','physical','lifecycle','marketing','other')),
  editor text NOT NULL DEFAULT 'text'
    CHECK (editor IN ('text','number','date','textarea','readOnly','select')),
  data_type text NOT NULL DEFAULT 'string'
    CHECK (data_type IN ('string','int','decimal','date','bool')),
  unit text,
  db_column text,
  provider_chain jsonb NOT NULL DEFAULT '[]'::jsonb,
  editable boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_canonical_attribute_active_sort
  ON public.canonical_attribute (active, sort_order);

ALTER TABLE public.canonical_attribute ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Canonical attributes readable by authenticated"
  ON public.canonical_attribute
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Canonical attributes managed by staff"
  ON public.canonical_attribute
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE TRIGGER trg_canonical_attribute_updated_at
  BEFORE UPDATE ON public.canonical_attribute
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Channel attribute mapping
-- ============================================================
CREATE TABLE public.channel_attribute_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('ebay','gmc','meta')),
  marketplace text,
  category_id text,
  aspect_key text NOT NULL,
  canonical_key text REFERENCES public.canonical_attribute(key) ON UPDATE CASCADE ON DELETE SET NULL,
  constant_value text,
  transform text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CHECK (canonical_key IS NOT NULL OR constant_value IS NOT NULL)
);

CREATE UNIQUE INDEX idx_channel_attribute_mapping_unique
  ON public.channel_attribute_mapping (
    channel,
    COALESCE(marketplace, ''),
    COALESCE(category_id, ''),
    aspect_key
  );

CREATE INDEX idx_channel_attribute_mapping_lookup
  ON public.channel_attribute_mapping (channel, marketplace, category_id);

ALTER TABLE public.channel_attribute_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Channel mappings readable by authenticated"
  ON public.channel_attribute_mapping
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Channel mappings managed by staff"
  ON public.channel_attribute_mapping
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE TRIGGER trg_channel_attribute_mapping_updated_at
  BEFORE UPDATE ON public.channel_attribute_mapping
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Seed canonical attributes (mirrors today's hardcoded registry)
-- ============================================================
INSERT INTO public.canonical_attribute
  (key, label, attribute_group, editor, data_type, unit, db_column, provider_chain, editable, sort_order)
VALUES
  ('mpn','MPN','identity','readOnly','string',NULL,'mpn',
    '[{"provider":"product","field":"mpn"}]'::jsonb,false,10),
  ('name','Set Name','identity','text','string',NULL,'name',
    '[{"provider":"product","field":"name"},{"provider":"catalog","field":"name"},{"provider":"brickeconomy","field":"name"}]'::jsonb,true,20),
  ('setNumber','Set Number','identity','text','string',NULL,'set_number',
    '[{"provider":"product","field":"set_number"},{"provider":"derived","field":"mpn_base"}]'::jsonb,true,30),
  ('brand','Brand','identity','text','string',NULL,'brand',
    '[{"provider":"product","field":"brand"},{"provider":"constant","field":"LEGO"}]'::jsonb,true,40),
  ('theme','Theme','identity','readOnly','string',NULL,NULL,
    '[{"provider":"theme","field":"name"},{"provider":"brickeconomy","field":"theme"}]'::jsonb,false,50),
  ('subtheme','Subtheme','identity','text','string',NULL,'subtheme_name',
    '[{"provider":"product","field":"subtheme_name"},{"provider":"brickeconomy","field":"subtheme"},{"provider":"catalog","field":"subtheme_name"}]'::jsonb,true,60),
  ('pieceCount','Pieces','physical','number','int',NULL,'piece_count',
    '[{"provider":"product","field":"piece_count"},{"provider":"brickeconomy","field":"pieces_count"},{"provider":"catalog","field":"piece_count"}]'::jsonb,true,100),
  ('minifigsCount','Minifigures','physical','number','int',NULL,'minifigs_count',
    '[{"provider":"product","field":"minifigs_count"},{"provider":"brickeconomy","field":"minifigs_count"}]'::jsonb,true,110),
  ('ageMark','Age Mark','physical','text','string',NULL,'age_mark',
    '[{"provider":"product","field":"age_mark"},{"provider":"product","field":"age_range"}]'::jsonb,true,120),
  ('dimensionsCm','Dimensions (cm)','physical','text','string','cm','dimensions_cm',
    '[{"provider":"product","field":"dimensions_cm"}]'::jsonb,true,130),
  ('weightG','Weight','physical','number','int','g','weight_g',
    '[{"provider":"product","field":"weight_g"},{"provider":"derived","field":"weight_kg_to_g"}]'::jsonb,true,140),
  ('ean','EAN','identity','text','string',NULL,'ean',
    '[{"provider":"product","field":"ean"}]'::jsonb,true,150),
  ('releasedDate','Released','lifecycle','date','date',NULL,'released_date',
    '[{"provider":"product","field":"released_date"},{"provider":"brickeconomy","field":"released_date"}]'::jsonb,true,200),
  ('retiredDate','Retired','lifecycle','date','date',NULL,'retired_date',
    '[{"provider":"product","field":"retired_date"},{"provider":"brickeconomy","field":"retired_date"}]'::jsonb,true,210),
  ('releaseYear','Year Manufactured','lifecycle','number','int',NULL,'release_year',
    '[{"provider":"product","field":"release_year"},{"provider":"brickeconomy","field":"year"},{"provider":"derived","field":"year_from_released_date"}]'::jsonb,true,220),
  ('retailPrice','RRP','marketing','number','decimal','GBP','retail_price',
    '[{"provider":"product","field":"retail_price"},{"provider":"brickeconomy","field":"retail_price"}]'::jsonb,true,300),
  ('productType','Product Type','identity','select','string',NULL,'product_type',
    '[{"provider":"product","field":"product_type"}]'::jsonb,true,15);

-- ============================================================
-- Seed channel mappings (channel-wide eBay defaults)
--   category_id = NULL means "applies to every eBay category
--   that doesn't have a per-category override"
-- ============================================================
INSERT INTO public.channel_attribute_mapping
  (channel, marketplace, category_id, aspect_key, canonical_key, constant_value)
VALUES
  -- Constants
  ('ebay', NULL, NULL, 'Brand', NULL, 'LEGO'),
  ('ebay', NULL, NULL, 'Type', 'productType', NULL),
  ('ebay', NULL, NULL, 'Packaging', NULL, 'Box'),
  -- Identity
  ('ebay', NULL, NULL, 'MPN', 'mpn', NULL),
  ('ebay', NULL, NULL, 'Set Name', 'name', NULL),
  ('ebay', NULL, NULL, 'Model', 'setNumber', NULL),
  ('ebay', NULL, NULL, 'LEGO Set Number', 'setNumber', NULL),
  ('ebay', NULL, NULL, 'LEGO Theme', 'theme', NULL),
  ('ebay', NULL, NULL, 'Theme', 'theme', NULL),
  ('ebay', NULL, NULL, 'LEGO Subtheme', 'subtheme', NULL),
  -- Physical
  ('ebay', NULL, NULL, 'Number of Pieces', 'pieceCount', NULL),
  ('ebay', NULL, NULL, 'Recommended Age Range', 'ageMark', NULL),
  ('ebay', NULL, NULL, 'Age Level', 'ageMark', NULL),
  ('ebay', NULL, NULL, 'EAN', 'ean', NULL),
  -- Lifecycle
  ('ebay', NULL, NULL, 'Year Manufactured', 'releaseYear', NULL),
  ('ebay', NULL, NULL, 'Year', 'releaseYear', NULL);
