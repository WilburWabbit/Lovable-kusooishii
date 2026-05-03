-- Backfill COGS from linked stock units
UPDATE sales_order_line sol
SET cogs = su.landed_cost
FROM stock_unit su
WHERE sol.stock_unit_id = su.id
  AND sol.cogs IS NULL
  AND su.landed_cost IS NOT NULL;

-- Backfill net_amount on sales orders
UPDATE sales_order
SET net_amount = gross_total - COALESCE(tax_total, 0)
WHERE net_amount IS NULL
  AND gross_total IS NOT NULL;

-- Link payout_fee rows to orders via origin_reference
UPDATE payout_fee pf
SET sales_order_id = so.id,
    updated_at = now()
FROM sales_order so
WHERE so.origin_reference = pf.external_order_id
  AND pf.sales_order_id IS NULL
  AND pf.external_order_id IS NOT NULL;

-- Fix the v2_link_unmatched_payout_fees function to use origin_reference
CREATE OR REPLACE FUNCTION public.v2_link_unmatched_payout_fees()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE public.payout_fee pf
  SET
    sales_order_id = so.id,
    updated_at     = now()
  FROM public.sales_order so
  WHERE pf.sales_order_id IS NULL
    AND pf.external_order_id IS NOT NULL
    AND so.origin_reference = pf.external_order_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$;