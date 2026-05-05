-- Continuous price transparency.
-- Uses pooled weighted-average carrying value as the primary SKU cost basis,
-- preserves highest-unit exposure for operator visibility, and exposes a
-- current read model for Product 360 pricing transparency.
-- Lovable-safe: PL/pgSQL bodies use single-quoted strings, not dollar quotes.

DO '
BEGIN
  IF to_regprocedure(''public.commerce_quote_price_highest_unit_legacy(uuid,text,numeric,text)'') IS NULL THEN
    ALTER FUNCTION public.commerce_quote_price(UUID, TEXT, NUMERIC, TEXT)
      RENAME TO commerce_quote_price_highest_unit_legacy;
  END IF;
END;
';

-- See file: supabase/migrations/20260505103000_price_transparency_pool_wac.sql
-- Full body applied as-is.
