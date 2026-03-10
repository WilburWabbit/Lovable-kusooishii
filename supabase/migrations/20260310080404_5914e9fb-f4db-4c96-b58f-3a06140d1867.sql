
CREATE TABLE public.vat_rate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qbo_tax_rate_id text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  rate_percent numeric NOT NULL,
  agency_ref text,
  active boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vat_rate ENABLE ROW LEVEL SECURITY;

CREATE POLICY "VAT rates managed by staff" ON public.vat_rate FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "VAT rates public read" ON public.vat_rate FOR SELECT TO public
  USING (true);
