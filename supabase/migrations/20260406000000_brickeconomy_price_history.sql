-- =============================================================
-- BrickEconomy price history & channel overrides
-- =============================================================
-- brickeconomy_price_history: append-only table that captures
--   current_value snapshots every time BE data is synced (bulk
--   or individual). Powers the per-product price chart.
-- brickeconomy_channel_overrides: per-channel price overrides
--   that persist across BE refreshes. Keyed by
--   (item_type, item_number, channel).
-- =============================================================

-- Price history (append-only snapshots)
CREATE TABLE IF NOT EXISTS public.brickeconomy_price_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type     text NOT NULL CHECK (item_type IN ('set', 'minifig')),
  item_number   text NOT NULL,
  current_value numeric,
  growth        numeric,
  retail_price  numeric,
  currency      text NOT NULL DEFAULT 'GBP',
  source        text NOT NULL DEFAULT 'bulk_sync'  -- 'bulk_sync' | 'individual'
    CHECK (source IN ('bulk_sync', 'individual')),
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brickeconomy_price_history_item_idx
  ON public.brickeconomy_price_history (item_type, item_number, recorded_at DESC);

-- Channel-specific price overrides (persist across BE refreshes)
CREATE TABLE IF NOT EXISTS public.brickeconomy_channel_overrides (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type    text NOT NULL CHECK (item_type IN ('set', 'minifig')),
  item_number  text NOT NULL,
  channel      text NOT NULL
    CHECK (channel IN ('website', 'ebay', 'bricklink', 'brickowl')),
  price_override numeric NOT NULL,
  notes        text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_type, item_number, channel)
);

-- RLS: staff and admin only
ALTER TABLE public.brickeconomy_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brickeconomy_channel_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff and admin can manage brickeconomy_price_history"
  ON public.brickeconomy_price_history
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('admin', 'staff')
    )
  );

CREATE POLICY "Staff and admin can manage brickeconomy_channel_overrides"
  ON public.brickeconomy_channel_overrides
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('admin', 'staff')
    )
  );
