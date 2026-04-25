-- Per-product attribute store (channel-aware, free-form key/value)
CREATE TABLE public.product_attribute (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.product(id) ON DELETE CASCADE,
  namespace text NOT NULL CHECK (namespace IN ('core','ebay','gmc','meta')),
  key text NOT NULL,
  value text,
  value_json jsonb,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','brickeconomy','catalog','inferred')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, namespace, key)
);

CREATE INDEX idx_product_attribute_product_ns
  ON public.product_attribute (product_id, namespace);

ALTER TABLE public.product_attribute ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Product attributes managed by staff"
  ON public.product_attribute FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));

CREATE POLICY "Product attributes readable by all"
  ON public.product_attribute FOR SELECT
  TO public
  USING (true);

CREATE TRIGGER trg_product_attribute_updated_at
  BEFORE UPDATE ON public.product_attribute
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Cached category schemas per channel
CREATE TABLE public.channel_category_schema (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('ebay','gmc','meta')),
  marketplace text NOT NULL DEFAULT 'EBAY_GB',
  category_id text NOT NULL,
  category_name text NOT NULL,
  parent_id text,
  leaf boolean NOT NULL DEFAULT true,
  raw_payload jsonb,
  schema_fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, marketplace, category_id)
);

CREATE INDEX idx_channel_category_schema_lookup
  ON public.channel_category_schema (channel, marketplace, parent_id);

ALTER TABLE public.channel_category_schema ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Channel schemas managed by staff"
  ON public.channel_category_schema FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));

CREATE POLICY "Channel schemas readable by all"
  ON public.channel_category_schema FOR SELECT
  TO public
  USING (true);

CREATE TRIGGER trg_channel_category_schema_updated_at
  BEFORE UPDATE ON public.channel_category_schema
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Per-category attribute schema (aspect definitions)
CREATE TABLE public.channel_category_attribute (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_id uuid NOT NULL REFERENCES public.channel_category_schema(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text,
  required boolean NOT NULL DEFAULT false,
  cardinality text NOT NULL DEFAULT 'single' CHECK (cardinality IN ('single','multi')),
  data_type text NOT NULL DEFAULT 'string',
  allowed_values jsonb,
  allows_custom boolean NOT NULL DEFAULT true,
  help_text text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schema_id, key)
);

CREATE INDEX idx_channel_category_attribute_schema
  ON public.channel_category_attribute (schema_id);

ALTER TABLE public.channel_category_attribute ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Schema attrs managed by staff"
  ON public.channel_category_attribute FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));

CREATE POLICY "Schema attrs readable by all"
  ON public.channel_category_attribute FOR SELECT
  TO public
  USING (true);

-- Product channel-category selection columns (additive)
ALTER TABLE public.product
  ADD COLUMN IF NOT EXISTS ebay_category_id text,
  ADD COLUMN IF NOT EXISTS ebay_marketplace text DEFAULT 'EBAY_GB',
  ADD COLUMN IF NOT EXISTS gmc_product_category text,
  ADD COLUMN IF NOT EXISTS meta_category text;