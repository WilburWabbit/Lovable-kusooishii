
ALTER TABLE public.inbound_receipt ADD COLUMN tax_total numeric NOT NULL DEFAULT 0;
ALTER TABLE public.inbound_receipt ADD COLUMN global_tax_calculation text;

ALTER TABLE public.inbound_receipt_line ADD COLUMN qbo_tax_code_ref text;

ALTER TABLE public.sales_order ADD COLUMN global_tax_calculation text;

ALTER TABLE public.sales_order_line ADD COLUMN qbo_tax_code_ref text;
ALTER TABLE public.sales_order_line ADD COLUMN vat_rate_id uuid REFERENCES public.vat_rate(id);
