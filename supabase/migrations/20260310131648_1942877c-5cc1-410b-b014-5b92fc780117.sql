CREATE TABLE public.ebay_connection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ebay_connection ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eBay connection admin only"
  ON public.ebay_connection
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));