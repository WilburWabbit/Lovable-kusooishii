-- Backfill missing Stripe link for in-person order KO-0009636
-- (Stripe Terminal sale on 2026-04-15 for £55, charge ch_3TMRClHDItV5mfAy0SPaXEvT)
-- This unblocks the qbo-sync-payout for payout 0897f8ac.
UPDATE public.sales_order
SET payment_reference = 'pi_3TMRClHDItV5mfAy06IWTJ6E'
WHERE id = 'e0bcd08a-7288-4703-bc39-a92dacd138c6'
  AND payment_reference IS NULL;

-- Link the order to the payout (so it appears as a SALE tx for qbo-sync-payout)
INSERT INTO public.payout_orders (payout_id, sales_order_id, order_gross)
SELECT '0897f8ac-e681-4d6c-b306-f9179fd27b06', 'e0bcd08a-7288-4703-bc39-a92dacd138c6', 55.00
WHERE NOT EXISTS (
  SELECT 1 FROM public.payout_orders
  WHERE payout_id = '0897f8ac-e681-4d6c-b306-f9179fd27b06'
    AND sales_order_id = 'e0bcd08a-7288-4703-bc39-a92dacd138c6'
);

-- Re-link the orphan processing-fee row to this sales order
UPDATE public.payout_fee
SET sales_order_id = 'e0bcd08a-7288-4703-bc39-a92dacd138c6'
WHERE id = 'e3104e34-21a1-430a-afd1-c095f1849ce6';

-- Recompute payout aggregates (in case order_count was stale)
UPDATE public.payouts
SET order_count = (SELECT COUNT(*) FROM public.payout_orders WHERE payout_id = '0897f8ac-e681-4d6c-b306-f9179fd27b06')
WHERE id = '0897f8ac-e681-4d6c-b306-f9179fd27b06';