-- Reset listings marked "ended" by the previous (lenient) helper between
-- 15:50 and 16:00 on 2026-04-21. Some of these may still be live on eBay
-- (e.g. 31058-1.1, 60438-1.1). Set them back to 'live' so the new strict
-- helper can verify their actual state and either truly withdraw them or
-- flag them as failures in the audit log.
UPDATE public.channel_listing
SET v2_status = 'live'
WHERE channel = 'ebay'
  AND external_listing_id IS NOT NULL
  AND v2_status = 'ended'
  AND synced_at BETWEEN '2026-04-21 15:50:00+00' AND '2026-04-21 16:00:00+00';