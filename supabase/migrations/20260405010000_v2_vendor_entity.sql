-- ============================================================
-- Admin V2 — Migration: Vendor Entity (Phase 2 / Issue #1)
--
-- Problem solved:
-- purchase_batches currently stores supplier_name as free text,
-- so suppliers cannot be queried or classified reliably.
--
-- Solution:
-- 1. Create canonical vendor table with vendor_type classification
-- 2. Add purchase_batches.supplier_id FK -> vendor
-- 3. Add payout_fee.vendor_id FK -> vendor
-- 4. Backfill existing rows and keep future writes synced via triggers
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'vendor_type'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.vendor_type AS ENUM (
      'supplier',
      'marketplace',
      'payment_processor',
      'other'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.normalize_vendor_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    regexp_replace(lower(trim(COALESCE(p_name, ''))), '\s+', ' ', 'g'),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.infer_vendor_type(p_name text)
RETURNS public.vendor_type
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_normalized text := public.normalize_vendor_name(p_name);
BEGIN
  IF v_normalized IS NULL THEN
    RETURN 'other';
  END IF;

  IF v_normalized IN ('ebay', 'etsy', 'bricklink', 'brickowl') THEN
    RETURN 'marketplace';
  END IF;

  IF v_normalized IN ('stripe', 'paypal', 'square', 'shopify payments') THEN
    RETURN 'payment_processor';
  END IF;

  RETURN 'supplier';
END;
$$;

CREATE TABLE IF NOT EXISTS public.vendor (
  id              UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  qbo_vendor_id   TEXT               UNIQUE,
  display_name    TEXT               NOT NULL,
  normalized_name TEXT GENERATED ALWAYS AS (public.normalize_vendor_name(display_name)) STORED,
  company_name    TEXT,
  is_active       BOOLEAN            NOT NULL DEFAULT true,
  vendor_type     public.vendor_type NOT NULL DEFAULT 'other',
  created_at      TIMESTAMPTZ        NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ        NOT NULL DEFAULT now(),
  CONSTRAINT vendor_display_name_not_blank
    CHECK (length(trim(display_name)) > 0),
  CONSTRAINT vendor_normalized_name_key
    UNIQUE (normalized_name)
);

COMMENT ON TABLE public.vendor IS
  'Canonical vendor directory spanning stock suppliers, marketplaces, and payment processors.';

COMMENT ON COLUMN public.vendor.vendor_type IS
  'Classifies the vendor for reporting and downstream payout / procurement linkage.';

DROP TRIGGER IF EXISTS set_vendor_updated_at ON public.vendor;
CREATE TRIGGER set_vendor_updated_at
  BEFORE UPDATE ON public.vendor
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.vendor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_vendor" ON public.vendor;
CREATE POLICY "auth_select_vendor"
  ON public.vendor FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_manage_vendor" ON public.vendor;
CREATE POLICY "auth_manage_vendor"
  ON public.vendor FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_vendor" ON public.vendor;
CREATE POLICY "service_role_all_vendor"
  ON public.vendor FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.ensure_vendor(
  p_display_name text,
  p_vendor_type public.vendor_type DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_display_name text;
  v_vendor_type public.vendor_type;
  v_vendor_id uuid;
BEGIN
  IF public.normalize_vendor_name(p_display_name) IS NULL THEN
    RETURN NULL;
  END IF;

  v_display_name := regexp_replace(trim(p_display_name), '\s+', ' ', 'g');
  v_vendor_type := COALESCE(p_vendor_type, public.infer_vendor_type(v_display_name));

  INSERT INTO public.vendor (display_name, vendor_type)
  VALUES (v_display_name, v_vendor_type)
  ON CONFLICT (normalized_name) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      vendor_type = CASE
        WHEN vendor.vendor_type = 'other' AND EXCLUDED.vendor_type <> 'other'
          THEN EXCLUDED.vendor_type
        ELSE vendor.vendor_type
      END,
      updated_at = now()
  RETURNING id INTO v_vendor_id;

  RETURN v_vendor_id;
END;
$$;

ALTER TABLE public.purchase_batches
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.vendor(id);

CREATE INDEX IF NOT EXISTS idx_purchase_batches_supplier_id
  ON public.purchase_batches(supplier_id);

COMMENT ON COLUMN public.purchase_batches.supplier_id IS
  'Canonical supplier reference. Backfilled from supplier_name and kept in sync by trigger.';

ALTER TABLE public.payout_fee
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES public.vendor(id);

CREATE INDEX IF NOT EXISTS idx_payout_fee_vendor_id
  ON public.payout_fee(vendor_id);

COMMENT ON COLUMN public.payout_fee.vendor_id IS
  'Canonical fee-charging vendor (eBay, Stripe, Etsy, etc.).';

CREATE OR REPLACE FUNCTION public.sync_purchase_batch_supplier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.supplier_name IS NULL OR length(trim(NEW.supplier_name)) = 0 THEN
    NEW.supplier_id := NULL;
    RETURN NEW;
  END IF;

  NEW.supplier_name := regexp_replace(trim(NEW.supplier_name), '\s+', ' ', 'g');
  NEW.supplier_id := public.ensure_vendor(NEW.supplier_name, NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_purchase_batch_supplier_trigger ON public.purchase_batches;
CREATE TRIGGER sync_purchase_batch_supplier_trigger
  BEFORE INSERT OR UPDATE OF supplier_name ON public.purchase_batches
  FOR EACH ROW EXECUTE FUNCTION public.sync_purchase_batch_supplier();

CREATE OR REPLACE FUNCTION public.sync_payout_fee_vendor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel text := lower(COALESCE(NEW.channel, ''));
BEGIN
  IF NEW.vendor_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF v_channel = 'ebay' THEN
    NEW.vendor_id := public.ensure_vendor('eBay', 'marketplace');
  ELSIF v_channel = 'etsy' THEN
    NEW.vendor_id := public.ensure_vendor('Etsy', 'marketplace');
  ELSIF v_channel = 'stripe' THEN
    NEW.vendor_id := public.ensure_vendor('Stripe', 'payment_processor');
  ELSIF v_channel <> '' THEN
    NEW.vendor_id := public.ensure_vendor(initcap(v_channel), 'other');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_payout_fee_vendor_trigger ON public.payout_fee;
CREATE TRIGGER sync_payout_fee_vendor_trigger
  BEFORE INSERT OR UPDATE OF channel, vendor_id ON public.payout_fee
  FOR EACH ROW EXECUTE FUNCTION public.sync_payout_fee_vendor();

-- Seed / backfill canonical vendors from existing purchase batches.
UPDATE public.purchase_batches
SET supplier_id = public.ensure_vendor(supplier_name, NULL)
WHERE supplier_name IS NOT NULL
  AND length(trim(supplier_name)) > 0
  AND supplier_id IS NULL;

-- Seed canonical fee vendors and backfill existing payout_fee rows.
SELECT public.ensure_vendor('eBay', 'marketplace');
SELECT public.ensure_vendor('Stripe', 'payment_processor');

UPDATE public.payout_fee
SET vendor_id = CASE lower(channel)
  WHEN 'ebay' THEN public.ensure_vendor('eBay', 'marketplace')
  WHEN 'etsy' THEN public.ensure_vendor('Etsy', 'marketplace')
  WHEN 'stripe' THEN public.ensure_vendor('Stripe', 'payment_processor')
  ELSE vendor_id
END
WHERE vendor_id IS NULL
  AND channel IS NOT NULL;
