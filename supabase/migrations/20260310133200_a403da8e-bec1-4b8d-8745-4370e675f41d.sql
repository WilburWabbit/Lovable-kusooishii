CREATE TABLE public.channel_listing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL DEFAULT 'ebay',
  external_sku text NOT NULL,
  external_listing_id text,
  sku_id uuid REFERENCES public.sku(id),
  listed_price numeric,
  listed_quantity integer,
  offer_status text,
  raw_data jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(channel, external_sku)
);

ALTER TABLE public.channel_listing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Channel listings managed by staff" ON public.channel_listing
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

CREATE TRIGGER set_channel_listing_updated_at
  BEFORE UPDATE ON public.channel_listing
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();