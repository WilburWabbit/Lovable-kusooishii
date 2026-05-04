
DROP VIEW IF EXISTS public.unit_profit_view;

CREATE VIEW public.unit_profit_view AS
WITH order_unit_counts AS (
  SELECT sol.sales_order_id, count(sol.stock_unit_id) AS unit_count
  FROM sales_order_line sol
  WHERE sol.stock_unit_id IS NOT NULL
  GROUP BY sol.sales_order_id
),
order_fee_totals AS (
  SELECT pf.sales_order_id,
    sum(pf.amount) FILTER (WHERE pf.fee_category = 'selling_fee') AS selling_fee,
    sum(pf.amount) FILTER (WHERE pf.fee_category = 'shipping_label') AS shipping_fee,
    sum(pf.amount) FILTER (WHERE pf.fee_category = 'payment_processing') AS processing_fee,
    sum(pf.amount) FILTER (WHERE pf.fee_category = 'advertising') AS advertising_fee,
    sum(pf.amount) AS total_fees
  FROM payout_fee pf
  WHERE pf.sales_order_id IS NOT NULL
  GROUP BY pf.sales_order_id
)
SELECT
  su.id AS stock_unit_id,
  su.uid,
  COALESCE(sk.sku_code,
    CASE WHEN su.condition_grade IS NOT NULL
      THEN su.mpn || '.' || su.condition_grade::text
      ELSE su.mpn
    END
  ) AS sku,
  su.v2_status,
  su.batch_id,
  su.payout_id,
  sol.sales_order_id,
  sol.unit_price AS gross_revenue,
  COALESCE(su.landed_cost, 0) AS landed_cost,
  round(COALESCE(oft.selling_fee / NULLIF(ouc.unit_count, 0)::numeric, 0), 4) AS selling_fee,
  round(COALESCE(oft.shipping_fee / NULLIF(ouc.unit_count, 0)::numeric, 0), 4) AS shipping_fee,
  round(COALESCE(oft.processing_fee / NULLIF(ouc.unit_count, 0)::numeric, 0), 4) AS processing_fee,
  round(COALESCE(oft.advertising_fee / NULLIF(ouc.unit_count, 0)::numeric, 0), 4) AS advertising_fee,
  round(COALESCE(oft.total_fees / NULLIF(ouc.unit_count, 0)::numeric, 0), 4) AS total_fees_per_unit,
  round(sol.unit_price / 1.2, 2) AS net_revenue,
  COALESCE(su.landed_cost, 0) AS net_landed_cost,
  round(COALESCE(oft.total_fees / NULLIF(ouc.unit_count, 0)::numeric, 0) / 1.2, 2) AS net_total_fees,
  round(
    sol.unit_price / 1.2
    - COALESCE(su.landed_cost, 0)
    - COALESCE(oft.total_fees / NULLIF(ouc.unit_count, 0)::numeric, 0) / 1.2,
    4
  ) AS net_profit,
  CASE WHEN sol.unit_price > 0
    THEN round(
      (sol.unit_price / 1.2
       - COALESCE(su.landed_cost, 0)
       - COALESCE(oft.total_fees / NULLIF(ouc.unit_count, 0)::numeric, 0) / 1.2)
      / (sol.unit_price / 1.2) * 100,
      2
    )
    ELSE NULL
  END AS net_margin_pct
FROM sales_order_line sol
JOIN stock_unit su ON su.id = sol.stock_unit_id
LEFT JOIN sku sk ON sk.id = su.sku_id
LEFT JOIN order_unit_counts ouc ON ouc.sales_order_id = sol.sales_order_id
LEFT JOIN order_fee_totals oft ON oft.sales_order_id = sol.sales_order_id
WHERE sol.stock_unit_id IS NOT NULL;
