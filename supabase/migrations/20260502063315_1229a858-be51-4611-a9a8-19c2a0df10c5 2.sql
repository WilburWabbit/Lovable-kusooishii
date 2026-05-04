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