UPDATE public.channel_listing
SET v2_status   = 'draft',
    listed_at   = NULL,
    updated_at  = now()
WHERE id = '80a44cf1-edb3-458e-93ad-28e02a694657'
  AND external_listing_id IS NULL;