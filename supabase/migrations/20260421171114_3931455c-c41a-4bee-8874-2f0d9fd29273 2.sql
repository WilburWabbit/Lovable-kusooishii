WITH dupes AS (
  SELECT
    web.id   AS web_id,
    site.id  AS site_id,
    site.listing_title,
    site.listing_description,
    site.listed_price,
    site.fee_adjusted_price,
    site.estimated_fees,
    site.estimated_net,
    site.external_listing_id,
    site.external_url,
    site.listed_at,
    site.v2_status,
    site.offer_status
  FROM public.channel_listing site
  JOIN public.channel_listing web
    ON web.sku_id = site.sku_id
   AND web.channel = 'web'
  WHERE site.channel = 'website'
)
UPDATE public.channel_listing cl
SET
  v2_channel          = 'website',
  v2_status           = COALESCE(d.v2_status, cl.v2_status),
  offer_status        = COALESCE(d.offer_status, cl.offer_status),
  listing_title       = COALESCE(d.listing_title, cl.listing_title),
  listing_description = COALESCE(d.listing_description, cl.listing_description),
  listed_price        = COALESCE(d.listed_price, cl.listed_price),
  fee_adjusted_price  = COALESCE(d.fee_adjusted_price, cl.fee_adjusted_price),
  estimated_fees      = COALESCE(d.estimated_fees, cl.estimated_fees),
  estimated_net       = COALESCE(d.estimated_net, cl.estimated_net),
  external_listing_id = COALESCE(d.external_listing_id, cl.external_listing_id),
  external_url        = COALESCE(d.external_url, cl.external_url),
  listed_at           = COALESCE(d.listed_at, cl.listed_at),
  updated_at          = now()
FROM dupes d
WHERE cl.id = d.web_id;

DELETE FROM public.channel_listing
WHERE channel = 'website'
  AND sku_id IN (
    SELECT sku_id FROM public.channel_listing WHERE channel = 'web'
  );

UPDATE public.channel_listing
SET v2_channel = 'website', updated_at = now()
WHERE channel = 'web' AND v2_channel IS NULL;

UPDATE public.channel_listing
SET v2_channel = 'ebay', updated_at = now()
WHERE channel = 'ebay' AND v2_channel IS NULL;