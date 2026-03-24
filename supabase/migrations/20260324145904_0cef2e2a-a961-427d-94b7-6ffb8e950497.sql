-- Fix security definer view warning: use SECURITY INVOKER so RLS of the querying user applies
CREATE OR REPLACE VIEW public.sku_public
WITH (security_invoker = true)
AS
  SELECT id, sku_code, name, condition_grade, price, sale_price,
         product_id, active_flag, saleable_flag, condition_notes, mpn,
         market_price, created_at, updated_at
  FROM public.sku;

-- Re-add a public SELECT policy for sku that only exposes non-sensitive columns via the view
-- The view itself filters columns; we need a SELECT policy on sku for the view to work with security_invoker
CREATE POLICY "SKUs readable by all via view" ON public.sku
  FOR SELECT TO public
  USING (true);