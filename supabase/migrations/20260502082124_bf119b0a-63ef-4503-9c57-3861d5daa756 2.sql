-- Defensive default for channel_listing.external_sku.
-- The column is NOT NULL but has no default, which caused first-time
-- publishes from the admin UI to fail when external_sku wasn't supplied.
-- This trigger fills it from the related sku.sku_code when the caller
-- doesn't provide a value, while still allowing marketplace sync code
-- to set a marketplace-assigned SKU explicitly.

CREATE OR REPLACE FUNCTION public.channel_listing_default_external_sku()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS '
BEGIN
  IF NEW.external_sku IS NULL OR NEW.external_sku = '''' THEN
    IF NEW.sku_id IS NOT NULL THEN
      SELECT sku_code INTO NEW.external_sku
      FROM public.sku
      WHERE id = NEW.sku_id;
    END IF;
  END IF;
  RETURN NEW;
END;
';

DROP TRIGGER IF EXISTS trg_channel_listing_default_external_sku ON public.channel_listing;

CREATE TRIGGER trg_channel_listing_default_external_sku
BEFORE INSERT ON public.channel_listing
FOR EACH ROW
EXECUTE FUNCTION public.channel_listing_default_external_sku();