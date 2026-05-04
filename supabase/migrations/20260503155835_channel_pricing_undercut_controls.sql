ALTER TABLE public.channel_pricing_config
  ADD COLUMN IF NOT EXISTS market_undercut_min_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS market_undercut_min_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS market_undercut_max_pct numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS market_undercut_max_amount numeric DEFAULT NULL;

COMMENT ON COLUMN public.channel_pricing_config.market_undercut_min_pct IS
  'Minimum market-value undercut percentage, stored as a decimal fraction per channel.';
COMMENT ON COLUMN public.channel_pricing_config.market_undercut_min_amount IS
  'Minimum market-value undercut amount in GBP per channel.';
COMMENT ON COLUMN public.channel_pricing_config.market_undercut_max_pct IS
  'Maximum market-value undercut percentage, stored as a decimal fraction per channel.';
COMMENT ON COLUMN public.channel_pricing_config.market_undercut_max_amount IS
  'Maximum market-value undercut amount in GBP per channel.';
