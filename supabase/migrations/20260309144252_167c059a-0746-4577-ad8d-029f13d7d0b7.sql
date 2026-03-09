-- ========================================
-- KUSO OISHII Core Schema — Phase 1
-- ========================================

-- Condition grade enum
CREATE TYPE public.condition_grade AS ENUM ('1', '2', '3', '4', '5');

-- Stock unit status enum
CREATE TYPE public.stock_unit_status AS ENUM (
  'pending_receipt', 'received', 'awaiting_grade', 'graded', 'available',
  'reserved', 'allocated', 'picked', 'packed', 'shipped', 'delivered',
  'returned', 'awaiting_disposition', 'scrap', 'part_out', 'written_off', 'closed'
);

-- Listing status enum
CREATE TYPE public.listing_status AS ENUM (
  'draft', 'price_pending', 'media_pending', 'copy_pending', 'approval_pending',
  'publish_queued', 'live', 'paused', 'suppressed', 'ended', 'archived'
);

-- Order status enum
CREATE TYPE public.order_status AS ENUM (
  'pending_payment', 'authorised', 'paid', 'picking', 'packed',
  'awaiting_dispatch', 'shipped', 'complete', 'cancelled',
  'partially_refunded', 'refunded', 'exception'
);

-- User roles
CREATE TYPE public.app_role AS ENUM ('admin', 'staff', 'member');

-- ========================================
-- User roles table
-- ========================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can read own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR auth.uid() = user_id);

-- ========================================
-- Themes
-- ========================================
CREATE TABLE public.theme (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  parent_theme_id UUID REFERENCES public.theme(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.theme ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Themes readable by all" ON public.theme FOR SELECT USING (true);
CREATE POLICY "Themes managed by staff" ON public.theme FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

-- ========================================
-- Catalog product
-- ========================================
CREATE TABLE public.catalog_product (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mpn TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  product_type TEXT NOT NULL DEFAULT 'set',
  theme_id UUID REFERENCES public.theme(id),
  retired_flag BOOLEAN NOT NULL DEFAULT false,
  release_year INTEGER,
  version_descriptor TEXT,
  piece_count INTEGER,
  rebrickable_id TEXT,
  brickeconomy_id TEXT,
  bricklink_item_no TEXT,
  brickowl_boid TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.catalog_product ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Products readable by all" ON public.catalog_product FOR SELECT USING (true);
CREATE POLICY "Products managed by staff" ON public.catalog_product FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE INDEX idx_catalog_product_mpn ON public.catalog_product(mpn);
CREATE INDEX idx_catalog_product_theme ON public.catalog_product(theme_id);
CREATE INDEX idx_catalog_product_status ON public.catalog_product(status);

-- ========================================
-- SKU
-- ========================================
CREATE TABLE public.sku (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_product_id UUID NOT NULL REFERENCES public.catalog_product(id),
  sku_code TEXT NOT NULL UNIQUE,
  condition_grade condition_grade NOT NULL,
  saleable_flag BOOLEAN NOT NULL DEFAULT true,
  qbo_item_id TEXT,
  active_flag BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sku ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SKUs readable by all" ON public.sku FOR SELECT USING (true);
CREATE POLICY "SKUs managed by staff" ON public.sku FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE INDEX idx_sku_code ON public.sku(sku_code);
CREATE INDEX idx_sku_product ON public.sku(catalog_product_id);

-- ========================================
-- Stock unit
-- ========================================
CREATE TABLE public.stock_unit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id UUID NOT NULL REFERENCES public.sku(id),
  mpn TEXT NOT NULL,
  condition_grade condition_grade NOT NULL,
  landed_cost NUMERIC(12,2),
  accumulated_impairment NUMERIC(12,2) NOT NULL DEFAULT 0,
  carrying_value NUMERIC(12,2) GENERATED ALWAYS AS (COALESCE(landed_cost, 0) - accumulated_impairment) STORED,
  status stock_unit_status NOT NULL DEFAULT 'received',
  location_id UUID,
  reservation_id UUID,
  supplier_id TEXT,
  serial_or_internal_mark TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_unit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Stock readable by staff" ON public.stock_unit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "Stock managed by staff" ON public.stock_unit FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE INDEX idx_stock_unit_sku ON public.stock_unit(sku_id);
CREATE INDEX idx_stock_unit_mpn ON public.stock_unit(mpn);
CREATE INDEX idx_stock_unit_status ON public.stock_unit(status);

-- ========================================
-- Audit event (immutable)
-- ========================================
CREATE TABLE public.audit_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  trigger_type TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id UUID,
  source_system TEXT,
  correlation_id UUID,
  causation_id UUID,
  before_json JSONB,
  after_json JSONB,
  input_json JSONB,
  output_json JSONB,
  diff_json JSONB,
  checksum TEXT,
  parser_version TEXT,
  job_run_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Audit readable by staff" ON public.audit_event FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "Audit insertable by staff" ON public.audit_event FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE INDEX idx_audit_entity ON public.audit_event(entity_type, entity_id);
CREATE INDEX idx_audit_correlation ON public.audit_event(correlation_id);
CREATE INDEX idx_audit_occurred ON public.audit_event(occurred_at);

-- ========================================
-- Media assets
-- ========================================
CREATE TABLE public.media_asset (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_url TEXT NOT NULL,
  checksum TEXT,
  mime_type TEXT,
  file_size_bytes INTEGER,
  width INTEGER,
  height INTEGER,
  alt_text TEXT,
  caption TEXT,
  provenance TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.media_asset ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Media readable by all" ON public.media_asset FOR SELECT USING (true);
CREATE POLICY "Media managed by staff" ON public.media_asset FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

-- ========================================
-- Timestamp trigger function
-- ========================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_theme_updated_at BEFORE UPDATE ON public.theme
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_catalog_product_updated_at BEFORE UPDATE ON public.catalog_product
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_sku_updated_at BEFORE UPDATE ON public.sku
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_stock_unit_updated_at BEFORE UPDATE ON public.stock_unit
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========================================
-- Storage bucket for media
-- ========================================
INSERT INTO storage.buckets (id, name, public) VALUES ('media', 'media', true);

CREATE POLICY "Media files readable by all" ON storage.objects
  FOR SELECT USING (bucket_id = 'media');
CREATE POLICY "Staff can upload media" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff')
  ));