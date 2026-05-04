-- Remove unbound duplicate channel_listing rows that shadow a canonical row
-- for the same (sku_id, channel). "Unbound" = no external_listing_id AND
-- empty/null listing_title. We only delete if a sibling row for the same
-- (sku_id, channel) exists that DOES have an external_listing_id.
WITH canonical AS (
  SELECT sku_id, channel
  FROM public.channel_listing
  WHERE external_listing_id IS NOT NULL
  GROUP BY sku_id, channel
)
DELETE FROM public.channel_listing cl
USING canonical c
WHERE cl.sku_id = c.sku_id
  AND cl.channel = c.channel
  AND cl.external_listing_id IS NULL
  AND (cl.listing_title IS NULL OR btrim(cl.listing_title) = '');