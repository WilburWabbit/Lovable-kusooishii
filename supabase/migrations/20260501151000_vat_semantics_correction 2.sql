-- VAT semantics correction.
-- Lovable SQL runner note: no dollar-quoted function bodies and no slash comments.

CREATE TABLE IF NOT EXISTS public.vat_semantics_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id UUID NOT NULL REFERENCES public.sales_order(id) ON DELETE CASCADE,
  classification TEXT NOT NULL CHECK (classification IN (
    'canonical_ex_vat_lines',
    'suspected_gross_lines',
    'qbo_double_vat_header',
    'mixed_or_needs_review'
  )),
  reason TEXT NOT NULL,
  original_header JSONB NOT NULL DEFAULT '{}'::jsonb,
  original_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  qbo_snapshot JSONB,
  repair_status TEXT NOT NULL DEFAULT 'not_required' CHECK (repair_status IN (
    'not_required',
    'repaired',
    'review_required'
  )),
  repaired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sales_order_id)
);

ALTER TABLE public.vat_semantics_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vat_semantics_audit_staff_all" ON public.vat_semantics_audit;
CREATE POLICY "vat_semantics_audit_staff_all" ON public.vat_semantics_audit
  FOR ALL TO authenticated
  USING (public.subledger_staff_read_policy())
  WITH CHECK (public.subledger_staff_read_policy());

CREATE INDEX IF NOT EXISTS idx_vat_semantics_audit_classification
  ON public.vat_semantics_audit(classification, repair_status);

COMMENT ON COLUMN public.sales_order_line.unit_price IS
  'Canonical ex-VAT unit price. Customer-facing gross values must be derived from line/order VAT splits.';

COMMENT ON COLUMN public.sales_order_line.line_total IS
  'Canonical ex-VAT line total. Do not store VAT-inclusive transaction amounts here.';

COMMENT ON COLUMN public.sales_order.gross_total IS
  'Customer-paid VAT-inclusive order total. For QBO imports, this is QBO TotalAmt.';

COMMENT ON COLUMN public.sales_order.net_amount IS
  'Ex-VAT order revenue. Normally gross_total minus tax_total.';

COMMENT ON COLUMN public.sales_order.global_tax_calculation IS
  'Compatibility metadata only. QBO outbound writers must always send TaxExcluded with ex-VAT lines.';

WITH line_summary AS (
  SELECT
    sol.sales_order_id,
    ROUND(SUM(COALESCE(sol.line_total, sol.unit_price * sol.quantity, 0))::numeric, 2) AS stored_line_total,
    jsonb_agg(
      jsonb_build_object(
        'sales_order_line_id', sol.id,
        'quantity', sol.quantity,
        'unit_price', sol.unit_price,
        'line_total', sol.line_total,
        'line_discount', sol.line_discount,
        'stock_unit_id', sol.stock_unit_id,
        'sku_id', sol.sku_id
      )
      ORDER BY sol.created_at, sol.id
    ) AS line_snapshot
  FROM public.sales_order_line sol
  GROUP BY sol.sales_order_id
),
qbo_receipts AS (
  SELECT
    q.external_id,
    q.raw_payload,
    ROUND(COALESCE(NULLIF(q.raw_payload->>'TotalAmt', '')::numeric, 0), 2) AS qbo_total_amt,
    ROUND(COALESCE(NULLIF(q.raw_payload#>>'{TxnTaxDetail,TotalTax}', '')::numeric, 0), 2) AS qbo_tax_total
  FROM public.landing_raw_qbo_sales_receipt q
),
classified AS (
  SELECT
    so.id AS sales_order_id,
    COALESCE(ls.stored_line_total, 0) AS stored_line_total,
    ROUND(COALESCE(so.gross_total, 0)::numeric, 2) AS gross_total,
    ROUND(COALESCE(so.tax_total, so.vat_amount, 0)::numeric, 2) AS tax_total,
    ROUND(COALESCE(so.net_amount, so.merchandise_subtotal, COALESCE(so.gross_total, 0) - COALESCE(so.tax_total, so.vat_amount, 0))::numeric, 2) AS expected_net_total,
    q.qbo_total_amt,
    q.qbo_tax_total,
    CASE
      WHEN q.qbo_total_amt IS NOT NULL
        AND q.qbo_tax_total <> 0
        AND ABS(ROUND(COALESCE(so.gross_total, 0)::numeric, 2) - ROUND(q.qbo_total_amt + q.qbo_tax_total, 2)) <= 0.01
        THEN 'qbo_double_vat_header'
      WHEN COALESCE(ls.stored_line_total, 0) > 0
        AND ABS(COALESCE(ls.stored_line_total, 0) - ROUND(COALESCE(so.gross_total, 0)::numeric, 2)) <= 0.02
        AND ABS(COALESCE(ls.stored_line_total, 0) - ROUND(COALESCE(so.net_amount, so.merchandise_subtotal, COALESCE(so.gross_total, 0) - COALESCE(so.tax_total, so.vat_amount, 0))::numeric, 2)) > 0.02
        THEN 'suspected_gross_lines'
      WHEN COALESCE(ls.stored_line_total, 0) = 0
        OR ABS(COALESCE(ls.stored_line_total, 0) - ROUND(COALESCE(so.net_amount, so.merchandise_subtotal, COALESCE(so.gross_total, 0) - COALESCE(so.tax_total, so.vat_amount, 0))::numeric, 2)) <= 0.02
        THEN 'canonical_ex_vat_lines'
      ELSE 'mixed_or_needs_review'
    END AS classification,
    CASE
      WHEN q.qbo_total_amt IS NOT NULL
        AND q.qbo_tax_total <> 0
        AND ABS(ROUND(COALESCE(so.gross_total, 0)::numeric, 2) - ROUND(q.qbo_total_amt + q.qbo_tax_total, 2)) <= 0.01
        THEN 'Order gross total equals QBO TotalAmt plus VAT. QBO TotalAmt is already gross, so VAT was double-added during import.'
      WHEN COALESCE(ls.stored_line_total, 0) > 0
        AND ABS(COALESCE(ls.stored_line_total, 0) - ROUND(COALESCE(so.gross_total, 0)::numeric, 2)) <= 0.02
        AND ABS(COALESCE(ls.stored_line_total, 0) - ROUND(COALESCE(so.net_amount, so.merchandise_subtotal, COALESCE(so.gross_total, 0) - COALESCE(so.tax_total, so.vat_amount, 0))::numeric, 2)) > 0.02
        THEN 'Stored order-line totals match gross order value and need conversion to ex-VAT canonical line values.'
      WHEN COALESCE(ls.stored_line_total, 0) = 0
        OR ABS(COALESCE(ls.stored_line_total, 0) - ROUND(COALESCE(so.net_amount, so.merchandise_subtotal, COALESCE(so.gross_total, 0) - COALESCE(so.tax_total, so.vat_amount, 0))::numeric, 2)) <= 0.02
        THEN 'Stored order-line totals already reconcile to ex-VAT order revenue.'
      ELSE 'Order header and line totals do not clearly identify a safe VAT repair. Manual review is required.'
    END AS reason,
    jsonb_build_object(
      'order_number', so.order_number,
      'origin_channel', so.origin_channel,
      'origin_reference', so.origin_reference,
      'qbo_sales_receipt_id', so.qbo_sales_receipt_id,
      'doc_number', so.doc_number,
      'gross_total', so.gross_total,
      'tax_total', so.tax_total,
      'vat_amount', so.vat_amount,
      'net_amount', so.net_amount,
      'merchandise_subtotal', so.merchandise_subtotal,
      'discount_total', so.discount_total,
      'shipping_total', so.shipping_total,
      'global_tax_calculation', so.global_tax_calculation
    ) AS original_header,
    COALESCE(ls.line_snapshot, '[]'::jsonb) AS original_lines,
    CASE
      WHEN q.external_id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'external_id', q.external_id,
        'TotalAmt', q.qbo_total_amt,
        'TotalTax', q.qbo_tax_total,
        'GlobalTaxCalculation', q.raw_payload->>'GlobalTaxCalculation',
        'DocNumber', q.raw_payload->>'DocNumber'
      )
    END AS qbo_snapshot
  FROM public.sales_order so
  LEFT JOIN line_summary ls ON ls.sales_order_id = so.id
  LEFT JOIN qbo_receipts q ON q.external_id = so.qbo_sales_receipt_id
)
INSERT INTO public.vat_semantics_audit (
  sales_order_id,
  classification,
  reason,
  original_header,
  original_lines,
  qbo_snapshot,
  repair_status,
  updated_at
)
SELECT
  sales_order_id,
  classification,
  reason,
  original_header,
  original_lines,
  qbo_snapshot,
  CASE
    WHEN classification = 'mixed_or_needs_review' THEN 'review_required'
    ELSE 'not_required'
  END,
  now()
FROM classified
ON CONFLICT (sales_order_id) DO UPDATE
SET classification = EXCLUDED.classification,
    reason = EXCLUDED.reason,
    original_header = EXCLUDED.original_header,
    original_lines = EXCLUDED.original_lines,
    qbo_snapshot = EXCLUDED.qbo_snapshot,
    repair_status = CASE
      WHEN vat_semantics_audit.repair_status = 'repaired' THEN vat_semantics_audit.repair_status
      ELSE EXCLUDED.repair_status
    END,
    updated_at = now();

WITH qbo_repairs AS (
  SELECT
    va.sales_order_id,
    ROUND((va.qbo_snapshot->>'TotalAmt')::numeric, 2) AS qbo_total_amt,
    ROUND((va.qbo_snapshot->>'TotalTax')::numeric, 2) AS qbo_tax_total
  FROM public.vat_semantics_audit va
  WHERE va.classification = 'qbo_double_vat_header'
    AND va.qbo_snapshot IS NOT NULL
)
UPDATE public.sales_order so
SET gross_total = qr.qbo_total_amt,
    tax_total = qr.qbo_tax_total,
    vat_amount = qr.qbo_tax_total,
    net_amount = ROUND(qr.qbo_total_amt - qr.qbo_tax_total, 2),
    merchandise_subtotal = ROUND(qr.qbo_total_amt - qr.qbo_tax_total, 2),
    global_tax_calculation = COALESCE(so.global_tax_calculation, 'TaxExcluded'),
    updated_at = now()
FROM qbo_repairs qr
WHERE so.id = qr.sales_order_id;

WITH gross_line_repairs AS (
  SELECT sol.id
  FROM public.sales_order_line sol
  JOIN public.vat_semantics_audit va ON va.sales_order_id = sol.sales_order_id
  WHERE va.classification = 'suspected_gross_lines'
)
UPDATE public.sales_order_line sol
SET unit_price = ROUND(sol.unit_price / 1.2, 2),
    line_total = ROUND(sol.line_total / 1.2, 2),
    line_discount = ROUND(COALESCE(sol.line_discount, 0) / 1.2, 2)
FROM gross_line_repairs glr
WHERE sol.id = glr.id;

UPDATE public.sales_order so
SET net_amount = ROUND(COALESCE(so.gross_total, 0) - COALESCE(so.tax_total, so.vat_amount, 0), 2),
    merchandise_subtotal = ROUND(COALESCE(so.gross_total, 0) - COALESCE(so.tax_total, so.vat_amount, 0), 2),
    global_tax_calculation = 'TaxExcluded',
    updated_at = now()
FROM public.vat_semantics_audit va
WHERE va.sales_order_id = so.id
  AND va.classification = 'suspected_gross_lines';

UPDATE public.vat_semantics_audit
SET repair_status = 'repaired',
    repaired_at = now(),
    updated_at = now()
WHERE classification IN ('qbo_double_vat_header', 'suspected_gross_lines');

UPDATE public.expected_settlement_line esl
SET amount = ROUND(so.gross_total, 2),
    metadata = esl.metadata || jsonb_build_object('vat_semantics_refreshed_at', now())
FROM public.sales_order so
JOIN public.vat_semantics_audit va ON va.sales_order_id = so.id
WHERE esl.sales_order_id = so.id
  AND esl.category = 'gross'
  AND va.repair_status = 'repaired';

SELECT public.refresh_order_line_economics(va.sales_order_id)
FROM public.vat_semantics_audit va
WHERE va.repair_status = 'repaired';

SELECT public.record_order_accounting_events(va.sales_order_id, 'vat_semantics_repair')
FROM public.vat_semantics_audit va
WHERE va.repair_status = 'repaired';

SELECT public.refresh_order_settlement_lines(va.sales_order_id, false)
FROM public.vat_semantics_audit va
WHERE va.repair_status = 'repaired';

SELECT public.refresh_actual_settlement_lines(va.sales_order_id, NULL::uuid, false)
FROM public.vat_semantics_audit va
WHERE va.repair_status = 'repaired';

SELECT public.rebuild_reconciliation_cases(va.sales_order_id)
FROM public.vat_semantics_audit va
WHERE va.repair_status = 'repaired';

INSERT INTO public.reconciliation_case (
  case_type,
  severity,
  status,
  sales_order_id,
  related_entity_type,
  related_entity_id,
  suspected_root_cause,
  recommended_action,
  amount_expected,
  amount_actual,
  variance_amount,
  evidence
)
SELECT
  'amount_mismatch',
  'medium',
  'open',
  so.id,
  'sales_order',
  so.id,
  'VAT semantics audit could not safely classify this order.',
  'Open the order, compare app gross/VAT/net, line totals, QBO DocNumber, and payout evidence, then correct the header or line values with supporting evidence.',
  ROUND(COALESCE(so.net_amount, so.merchandise_subtotal, 0), 2),
  ROUND(COALESCE(ls.stored_line_total, 0), 2),
  ROUND(COALESCE(ls.stored_line_total, 0) - COALESCE(so.net_amount, so.merchandise_subtotal, 0), 2),
  jsonb_build_object(
    'source', 'vat_semantics_audit',
    'audit_id', va.id,
    'classification', va.classification,
    'reason', va.reason,
    'app_reference', so.order_number,
    'qbo_sales_receipt_id', so.qbo_sales_receipt_id,
    'qbo_doc_number', so.doc_number
  )
FROM public.vat_semantics_audit va
JOIN public.sales_order so ON so.id = va.sales_order_id
LEFT JOIN (
  SELECT sales_order_id, ROUND(SUM(COALESCE(line_total, unit_price * quantity, 0))::numeric, 2) AS stored_line_total
  FROM public.sales_order_line
  GROUP BY sales_order_id
) ls ON ls.sales_order_id = so.id
WHERE va.classification = 'mixed_or_needs_review'
  AND NOT EXISTS (
    SELECT 1
    FROM public.reconciliation_case rc
    WHERE rc.sales_order_id = so.id
      AND rc.case_type = 'amount_mismatch'
      AND rc.evidence->>'source' = 'vat_semantics_audit'
      AND rc.status IN ('open', 'in_progress')
  );

CREATE OR REPLACE VIEW public.v_order_line_economics AS
WITH base AS (
  SELECT
    sol.id AS sales_order_line_id,
    sol.sales_order_id,
    sol.sku_id,
    sol.stock_unit_id,
    sol.quantity,
    sol.unit_price,
    sol.line_discount,
    sol.line_total,
    sol.costing_method,
    sol.cogs_amount,
    sol.cogs_source_unit_id,
    sol.fee_snapshot,
    COALESCE((sol.fee_snapshot->>'total_fee_amount')::numeric, 0) AS total_fee_amount,
    sol.program_discount_amount,
    sol.program_commission_amount,
    sol.gross_margin_amount,
    sol.net_margin_amount,
    sol.net_margin_rate,
    sol.economics_status,
    so.origin_channel,
    so.order_number,
    so.created_at AS order_created_at,
    ROUND(COALESCE(sol.line_total, sol.unit_price * sol.quantity, 0)::numeric, 2) AS line_net_amount,
    ROUND(COALESCE(so.tax_total, so.vat_amount, 0)::numeric, 2) AS order_tax_total,
    ROUND(COALESCE(so.net_amount, so.merchandise_subtotal, COALESCE(so.gross_total, 0) - COALESCE(so.tax_total, so.vat_amount, 0))::numeric, 2) AS order_net_total,
    ROUND(COALESCE(so.gross_total, 0)::numeric, 2) AS order_gross_total,
    SUM(ROUND(COALESCE(sol.line_total, sol.unit_price * sol.quantity, 0)::numeric, 2)) OVER (PARTITION BY sol.sales_order_id) AS order_line_net_total
  FROM public.sales_order_line sol
  JOIN public.sales_order so ON so.id = sol.sales_order_id
),
enriched AS (
  SELECT
    base.*,
    CASE
      WHEN base.order_line_net_total > 0
        AND ABS(base.order_line_net_total - base.order_net_total) <= 0.02
        THEN ROUND(base.order_tax_total * (base.line_net_amount / NULLIF(base.order_line_net_total, 0)), 2)
      ELSE ROUND(base.line_net_amount * 0.2, 2)
    END AS line_vat_amount
  FROM base
)
SELECT
  sales_order_line_id,
  sales_order_id,
  sku_id,
  stock_unit_id,
  quantity,
  unit_price,
  line_discount,
  line_total,
  costing_method,
  cogs_amount,
  cogs_source_unit_id,
  fee_snapshot,
  total_fee_amount,
  program_discount_amount,
  program_commission_amount,
  gross_margin_amount,
  net_margin_amount,
  net_margin_rate,
  economics_status,
  origin_channel,
  order_number,
  order_created_at,
  line_net_amount,
  line_vat_amount,
  ROUND(line_net_amount + line_vat_amount, 2) AS line_gross_amount,
  order_net_total,
  order_tax_total,
  order_gross_total
FROM enriched;

CREATE OR REPLACE VIEW public.v_unit_profit_v2 AS
SELECT
  su.id AS stock_unit_id,
  su.uid,
  COALESCE(sk.sku_code, su.mpn || '.' || su.condition_grade::text) AS sku,
  su.v2_status,
  su.batch_id,
  su.payout_id,
  ole.sales_order_id,
  ole.sales_order_line_id,
  COALESCE(ole.line_gross_amount, ROUND(ole.line_total * 1.2, 2)) AS gross_revenue,
  COALESCE(ole.cogs_amount, su.carrying_value, su.landed_cost, 0) AS landed_cost,
  ole.total_fee_amount,
  ole.program_commission_amount,
  ole.net_margin_amount AS net_profit,
  ROUND(ole.net_margin_rate * 100, 2) AS net_margin_pct,
  CASE WHEN ole.line_total > 0 THEN ROUND((ole.line_total - COALESCE(ole.cogs_amount, su.carrying_value, su.landed_cost, 0)) / ole.line_total * 100, 2) ELSE NULL END AS gross_margin_pct,
  CASE WHEN ole.line_total > 0 THEN ROUND(ole.total_fee_amount / ole.line_total * 100, 2) ELSE NULL END AS fee_pct,
  ole.line_total AS net_revenue,
  ole.line_vat_amount AS vat_amount,
  ole.line_gross_amount
FROM public.v_order_line_economics ole
JOIN public.stock_unit su ON su.id = ole.stock_unit_id
LEFT JOIN public.sku sk ON sk.id = su.sku_id;

DROP VIEW IF EXISTS public.unit_profit_view;

CREATE VIEW public.unit_profit_view AS
WITH order_unit_counts AS (
  SELECT sol.sales_order_id, count(sol.stock_unit_id) AS unit_count
  FROM public.sales_order_line sol
  WHERE sol.stock_unit_id IS NOT NULL
  GROUP BY sol.sales_order_id
),
order_fee_totals AS (
  SELECT
    pf.sales_order_id,
    sum(pf.amount) FILTER (WHERE pf.fee_category = 'selling_fee') AS selling_fee,
    sum(pf.amount) FILTER (WHERE pf.fee_category = 'shipping_label') AS shipping_fee,
    sum(pf.amount) FILTER (WHERE pf.fee_category = 'payment_processing') AS processing_fee,
    sum(pf.amount) FILTER (WHERE pf.fee_category = 'advertising') AS advertising_fee,
    sum(pf.amount) AS total_fees
  FROM public.payout_fee pf
  WHERE pf.sales_order_id IS NOT NULL
  GROUP BY pf.sales_order_id
),
line_base AS (
  SELECT
    sol.*,
    so.tax_total,
    COALESCE(so.net_amount, so.merchandise_subtotal, so.gross_total - so.tax_total) AS order_net_total,
    SUM(COALESCE(sol.line_total, sol.unit_price * sol.quantity, 0)) OVER (PARTITION BY sol.sales_order_id) AS order_line_net_total
  FROM public.sales_order_line sol
  JOIN public.sales_order so ON so.id = sol.sales_order_id
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
  lb.sales_order_id,
  ROUND(
    COALESCE(lb.line_total, lb.unit_price * lb.quantity, 0)
    + CASE
      WHEN lb.order_line_net_total > 0 AND ABS(lb.order_line_net_total - lb.order_net_total) <= 0.02
        THEN COALESCE(lb.tax_total, 0) * (COALESCE(lb.line_total, lb.unit_price * lb.quantity, 0) / NULLIF(lb.order_line_net_total, 0))
      ELSE COALESCE(lb.line_total, lb.unit_price * lb.quantity, 0) * 0.2
    END,
    2
  ) AS gross_revenue,
  COALESCE(su.landed_cost, 0) AS landed_cost,
  round(COALESCE(oft.selling_fee / NULLIF(ouc.unit_count, 0)::numeric, 0), 4) AS selling_fee,
  round(COALESCE(oft.shipping_fee / NULLIF(ouc.unit_count, 0)::numeric, 0), 4) AS shipping_fee,
  round(COALESCE(oft.processing_fee / NULLIF(ouc.unit_count, 0)::numeric, 0), 4) AS processing_fee,
  round(COALESCE(oft.advertising_fee / NULLIF(ouc.unit_count, 0)::numeric, 0), 4) AS advertising_fee,
  round(COALESCE(oft.total_fees / NULLIF(ouc.unit_count, 0)::numeric, 0), 4) AS total_fees_per_unit,
  ROUND(COALESCE(lb.line_total, lb.unit_price * lb.quantity, 0), 2) AS net_revenue,
  COALESCE(su.landed_cost, 0) AS net_landed_cost,
  round(COALESCE(oft.total_fees / NULLIF(ouc.unit_count, 0)::numeric, 0) / 1.2, 2) AS net_total_fees,
  round(
    COALESCE(lb.line_total, lb.unit_price * lb.quantity, 0)
    - COALESCE(su.landed_cost, 0)
    - COALESCE(oft.total_fees / NULLIF(ouc.unit_count, 0)::numeric, 0) / 1.2,
    4
  ) AS net_profit,
  CASE WHEN COALESCE(lb.line_total, lb.unit_price * lb.quantity, 0) > 0
    THEN round(
      (COALESCE(lb.line_total, lb.unit_price * lb.quantity, 0)
       - COALESCE(su.landed_cost, 0)
       - COALESCE(oft.total_fees / NULLIF(ouc.unit_count, 0)::numeric, 0) / 1.2)
      / COALESCE(lb.line_total, lb.unit_price * lb.quantity, 0) * 100,
      2
    )
    ELSE NULL
  END AS net_margin_pct,
  CASE WHEN COALESCE(lb.line_total, lb.unit_price * lb.quantity, 0) > 0
    THEN round((COALESCE(lb.line_total, lb.unit_price * lb.quantity, 0) - COALESCE(su.landed_cost, 0)) / COALESCE(lb.line_total, lb.unit_price * lb.quantity, 0) * 100, 2)
    ELSE NULL
  END AS gross_margin_pct,
  CASE WHEN COALESCE(lb.line_total, lb.unit_price * lb.quantity, 0) > 0
    THEN round(COALESCE(oft.total_fees / NULLIF(ouc.unit_count, 0)::numeric, 0) / COALESCE(lb.line_total, lb.unit_price * lb.quantity, 0) * 100, 2)
    ELSE NULL
  END AS fee_pct
FROM line_base lb
JOIN public.stock_unit su ON su.id = lb.stock_unit_id
LEFT JOIN public.sku sk ON sk.id = su.sku_id
LEFT JOIN order_unit_counts ouc ON ouc.sales_order_id = lb.sales_order_id
LEFT JOIN order_fee_totals oft ON oft.sales_order_id = lb.sales_order_id
WHERE lb.stock_unit_id IS NOT NULL;

CREATE OR REPLACE VIEW public.v_vat_semantics_audit WITH (security_invoker = true) AS
SELECT
  va.id,
  so.order_number AS app_reference,
  so.origin_channel,
  so.origin_reference,
  so.qbo_sales_receipt_id,
  so.doc_number AS qbo_doc_number,
  va.sales_order_id,
  va.classification,
  va.reason,
  va.repair_status,
  va.repaired_at,
  ROUND(COALESCE(so.gross_total, 0)::numeric, 2) AS current_gross_total,
  ROUND(COALESCE(so.tax_total, so.vat_amount, 0)::numeric, 2) AS current_tax_total,
  ROUND(COALESCE(so.net_amount, so.merchandise_subtotal, 0)::numeric, 2) AS current_net_total,
  va.original_header,
  va.original_lines,
  va.qbo_snapshot,
  va.created_at,
  va.updated_at
FROM public.vat_semantics_audit va
JOIN public.sales_order so ON so.id = va.sales_order_id;

GRANT SELECT ON public.v_order_line_economics TO authenticated;
GRANT SELECT ON public.v_unit_profit_v2 TO authenticated;
GRANT SELECT ON public.unit_profit_view TO authenticated;
GRANT SELECT ON public.v_vat_semantics_audit TO authenticated;
