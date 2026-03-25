UPDATE public.landing_raw_qbo_sales_receipt
SET status = 'pending', processed_at = NULL, error_message = NULL
WHERE status = 'error';