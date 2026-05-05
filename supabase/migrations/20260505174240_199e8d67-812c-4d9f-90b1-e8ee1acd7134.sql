-- Re-apply 20260505143000_correct_pricing_floor_target_vat.sql (updated)
DO '
BEGIN
  IF to_regprocedure(''public.commerce_quote_price_pool_wac_no_vat(uuid,text,numeric,text)'') IS NULL THEN
    ALTER FUNCTION public.commerce_quote_price(UUID, TEXT, NUMERIC, TEXT)
      RENAME TO commerce_quote_price_pool_wac_no_vat;
  END IF;
END;
';