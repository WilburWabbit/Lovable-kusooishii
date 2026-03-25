-- ============================================================
-- Admin V2 — Pricing Engine Wiring
-- Creates pricing_settings table, price cascade trigger,
-- and price audit log for full pricing engine integration.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. Pricing settings (configurable thresholds)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pricing_settings (
  key        TEXT PRIMARY KEY,
  value      NUMERIC NOT NULL,
  label      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pricing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage pricing settings" ON public.pricing_settings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

INSERT INTO public.pricing_settings (key, value, label) VALUES
  ('minimum_margin_target', 0.25, 'Minimum margin target (floor price)'),
  ('first_markdown_days', 30, 'Days until first markdown'),
  ('first_markdown_pct', 0.10, 'First markdown percentage'),
  ('clearance_markdown_days', 45, 'Days until clearance markdown'),
  ('clearance_markdown_pct', 0.20, 'Clearance markdown percentage')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2. Price audit log
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.price_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id       UUID NOT NULL REFERENCES public.sku(id),
  sku_code     TEXT NOT NULL,
  old_price    NUMERIC(12,2),
  new_price    NUMERIC(12,2),
  reason       TEXT NOT NULL,
  performed_by UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_audit_sku ON public.price_audit_log(sku_id);
CREATE INDEX IF NOT EXISTS idx_price_audit_created ON public.price_audit_log(created_at DESC);

ALTER TABLE public.price_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read price audit" ON public.price_audit_log
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- ─────────────────────────────────────────────────────────────
-- 3. Price cascade trigger: sku.price → channel_listing.listed_price
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.v2_cascade_sku_price_to_listings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.price IS DISTINCT FROM OLD.price THEN
    -- Cascade to live channel listings
    UPDATE public.channel_listing
    SET listed_price = NEW.price,
        updated_at = now()
    WHERE sku_id = NEW.id
      AND v2_status = 'live';

    -- Write audit log entry
    INSERT INTO public.price_audit_log (sku_id, sku_code, old_price, new_price, reason)
    VALUES (
      NEW.id,
      NEW.sku_code,
      OLD.price,
      NEW.price,
      CASE
        WHEN NEW.v2_markdown_applied IS DISTINCT FROM OLD.v2_markdown_applied
             AND NEW.v2_markdown_applied IS NOT NULL
        THEN 'auto_markdown_' || NEW.v2_markdown_applied
        ELSE 'manual'
      END
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_v2_cascade_sku_price ON public.sku;

CREATE TRIGGER trg_v2_cascade_sku_price
  AFTER UPDATE OF price ON public.sku
  FOR EACH ROW
  EXECUTE FUNCTION public.v2_cascade_sku_price_to_listings();

-- ─────────────────────────────────────────────────────────────
-- 4. Update v2_recalculate_variant_stats to read margin from settings
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.v2_recalculate_variant_stats(p_sku_code TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sku_id UUID;
  v_avg    NUMERIC(12,2);
  v_floor  NUMERIC(12,2);
  v_min    NUMERIC(12,2);
  v_max    NUMERIC(12,2);
  v_range  TEXT;
  v_margin NUMERIC;
BEGIN
  -- Look up sku id
  SELECT id INTO v_sku_id FROM public.sku WHERE sku_code = p_sku_code;
  IF v_sku_id IS NULL THEN RETURN; END IF;

  -- Read margin target from settings (default 0.25)
  SELECT COALESCE(
    (SELECT value FROM public.pricing_settings WHERE key = 'minimum_margin_target'),
    0.25
  ) INTO v_margin;

  -- Compute stats from on-hand stock
  SELECT
    ROUND(AVG(su.landed_cost), 2),
    ROUND(MAX(su.landed_cost) * (1 + v_margin), 2),
    MIN(su.landed_cost),
    MAX(su.landed_cost)
  INTO v_avg, v_floor, v_min, v_max
  FROM public.stock_unit su
  WHERE su.sku_id = v_sku_id
    AND su.v2_status IN ('graded', 'listed')
    AND su.landed_cost IS NOT NULL;

  -- Build cost range string
  IF v_min IS NULL THEN
    v_range := NULL;
  ELSIF v_min = v_max THEN
    v_range := '£' || v_min::text;
  ELSE
    v_range := '£' || v_min::text || '–£' || v_max::text;
  END IF;

  -- Update SKU
  UPDATE public.sku
  SET avg_cost   = v_avg,
      floor_price = v_floor,
      cost_range  = v_range
  WHERE id = v_sku_id;
END;
$$;

COMMIT;
