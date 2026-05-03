DELETE FROM public.payout_orders
WHERE payout_id = '0897f8ac-e681-4d6c-b306-f9179fd27b06'
  AND sales_order_id = 'e0bcd08a-7288-4703-bc39-a92dacd138c6';

UPDATE public.payout_fee
SET sales_order_id = NULL
WHERE id = 'e3104e34-21a1-430a-afd1-c095f1849ce6';

UPDATE public.payouts
SET order_count = (SELECT COUNT(*) FROM public.payout_orders WHERE payout_id = '0897f8ac-e681-4d6c-b306-f9179fd27b06')
WHERE id = '0897f8ac-e681-4d6c-b306-f9179fd27b06';