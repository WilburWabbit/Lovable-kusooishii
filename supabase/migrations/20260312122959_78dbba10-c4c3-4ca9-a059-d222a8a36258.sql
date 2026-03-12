
CREATE TABLE public.channel_pricing_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  channel text NOT NULL UNIQUE,
  auto_price_enabled boolean NOT NULL DEFAULT false,
  max_increase_pct numeric DEFAULT NULL,
  max_increase_amount numeric DEFAULT NULL,
  max_decrease_pct numeric DEFAULT NULL,
  max_decrease_amount numeric DEFAULT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.channel_pricing_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Channel pricing config managed by staff"
ON public.channel_pricing_config
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE TRIGGER update_channel_pricing_config_updated_at
  BEFORE UPDATE ON public.channel_pricing_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Seed default rows for each channel
INSERT INTO public.channel_pricing_config (channel) VALUES ('ebay'), ('bricklink'), ('brickowl'), ('web');
