-- Google Merchant Centre connection (singleton pattern, same as ebay_connection)
CREATE TABLE public.google_merchant_connection (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id      text NOT NULL,
  data_source      text,
  access_token     text NOT NULL,
  refresh_token    text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.google_merchant_connection ENABLE ROW LEVEL SECURITY;

-- Admin-only access (same pattern as ebay_connection)
CREATE POLICY "admin_only" ON public.google_merchant_connection
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Auto-update updated_at
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.google_merchant_connection
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
