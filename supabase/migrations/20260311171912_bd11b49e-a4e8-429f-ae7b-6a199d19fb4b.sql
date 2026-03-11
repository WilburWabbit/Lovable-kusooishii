
-- Step 1: Identify QBO duplicate orders (origin_channel='qbo' whose doc_number matches an eBay order's origin_reference)
-- Step 2: Reopen stock_units that were closed by the duplicate QBO order lines
UPDATE stock_unit
SET status = 'available', updated_at = now()
WHERE id IN (
  SELECT sol.stock_unit_id
  FROM sales_order_line sol
  JOIN sales_order so ON so.id = sol.sales_order_id
  WHERE so.origin_channel = 'qbo'
    AND so.doc_number IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM sales_order ebay
      WHERE ebay.origin_channel = 'ebay'
        AND ebay.origin_reference = so.doc_number
    )
    AND sol.stock_unit_id IS NOT NULL
);

-- Step 3: Delete order lines for QBO duplicates
DELETE FROM sales_order_line
WHERE sales_order_id IN (
  SELECT so.id
  FROM sales_order so
  WHERE so.origin_channel = 'qbo'
    AND so.doc_number IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM sales_order ebay
      WHERE ebay.origin_channel = 'ebay'
        AND ebay.origin_reference = so.doc_number
    )
);

-- Step 4: Delete the QBO duplicate orders themselves
DELETE FROM sales_order
WHERE origin_channel = 'qbo'
  AND doc_number IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM sales_order ebay
    WHERE ebay.origin_channel = 'ebay'
      AND ebay.origin_reference = doc_number
  );

-- Step 5: Backfill QBO metadata (customer_id, global_tax_calculation) onto surviving eBay orders
-- using the landed QBO sales receipt data
UPDATE sales_order ebay_order
SET
  global_tax_calculation = COALESCE(ebay_order.global_tax_calculation,
    (landing.raw_payload->>'GlobalTaxCalculation')),
  customer_id = COALESCE(ebay_order.customer_id,
    (SELECT c.id FROM customer c
     WHERE c.qbo_customer_id = (landing.raw_payload->'CustomerRef'->>'value')
     LIMIT 1)),
  updated_at = now()
FROM landing_raw_qbo_sales_receipt landing
WHERE ebay_order.origin_channel = 'ebay'
  AND ebay_order.origin_reference IS NOT NULL
  AND landing.raw_payload->>'DocNumber' = ebay_order.origin_reference
  AND landing.status = 'committed'
  AND (ebay_order.global_tax_calculation IS NULL OR ebay_order.customer_id IS NULL);
