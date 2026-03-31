-- Data repair: fix ghost stock units where legacy status=closed but v2_status still shows graded/listed
-- These are units that were sold via Stripe or eBay webhooks which only updated the legacy status column
UPDATE stock_unit
SET v2_status = 'sold',
    sold_at = COALESCE(sold_at, now())
WHERE status = 'closed'
  AND v2_status IN ('graded', 'listed');