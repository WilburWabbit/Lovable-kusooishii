WITH latest_ebay_order AS (
  SELECT DISTINCT ON (so.customer_id)
    so.customer_id,
    so.id AS sales_order_id,
    so.shipping_name,
    so.shipping_line_1,
    so.shipping_line_2,
    so.shipping_city,
    so.shipping_county,
    so.shipping_postcode,
    so.shipping_country,
    so.guest_name,
    so.guest_email,
    so.origin_reference,
    so.created_at
  FROM public.sales_order so
  WHERE so.customer_id IS NOT NULL
    AND so.origin_channel = 'ebay'
  ORDER BY so.customer_id, so.created_at DESC
),
repair_candidates AS (
  SELECT
    c.id AS customer_id,
    leo.sales_order_id,
    COALESCE(
      NULLIF(regexp_replace(leo.shipping_name, '\s+', ' ', 'g'), ''),
      NULLIF(c.channel_ids->>'ebay', ''),
      NULLIF(regexp_replace(leo.guest_name, '\s+', ' ', 'g'), ''),
      c.display_name
    ) AS repaired_display_name,
    leo.shipping_line_1,
    leo.shipping_line_2,
    leo.shipping_city,
    leo.shipping_county,
    leo.shipping_postcode,
    COALESCE(NULLIF(leo.shipping_country, ''), 'GB') AS shipping_country
  FROM public.customer c
  JOIN latest_ebay_order leo ON leo.customer_id = c.id
  WHERE c.display_name ILIKE '%@members.ebay.%'
     OR c.email ILIKE '%@members.ebay.%'
     OR NULLIF(c.channel_ids->>'ebay', '') IS NOT NULL
)
UPDATE public.customer c
SET display_name = CASE
      WHEN rc.repaired_display_name ILIKE '%@members.ebay.%'
        THEN COALESCE(NULLIF(c.channel_ids->>'ebay', ''), c.display_name)
      ELSE rc.repaired_display_name
    END,
    billing_line_1 = COALESCE(NULLIF(rc.shipping_line_1, ''), c.billing_line_1),
    billing_line_2 = COALESCE(NULLIF(rc.shipping_line_2, ''), c.billing_line_2),
    billing_city = COALESCE(NULLIF(rc.shipping_city, ''), c.billing_city),
    billing_county = COALESCE(NULLIF(rc.shipping_county, ''), c.billing_county),
    billing_postcode = COALESCE(NULLIF(rc.shipping_postcode, ''), c.billing_postcode),
    billing_country = COALESCE(NULLIF(rc.shipping_country, ''), c.billing_country, 'GB'),
    active = true,
    updated_at = now()
FROM repair_candidates rc
WHERE c.id = rc.customer_id;

WITH latest_ebay_order AS (
  SELECT DISTINCT ON (so.customer_id)
    so.customer_id,
    so.id AS sales_order_id
  FROM public.sales_order so
  WHERE so.customer_id IS NOT NULL
    AND so.origin_channel = 'ebay'
  ORDER BY so.customer_id, so.created_at DESC
),
queue_candidates AS (
  SELECT c.id AS customer_id, leo.sales_order_id
  FROM public.customer c
  JOIN latest_ebay_order leo ON leo.customer_id = c.id
  WHERE c.qbo_customer_id IS NOT NULL
    AND (
      c.display_name NOT ILIKE '%@members.ebay.%'
      OR NULLIF(c.channel_ids->>'ebay', '') IS NOT NULL
    )
)
SELECT public.queue_qbo_customer_posting_intent(
  qc.customer_id,
  jsonb_build_object(
    'customer_id', qc.customer_id,
    'sales_order_id', qc.sales_order_id,
    'origin', 'repair_ebay_customer_identity_for_qbo',
    'dependency_for', 'repair_qbo_customer'
  )
)
FROM queue_candidates qc;