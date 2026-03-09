
CREATE TABLE public.brickeconomy_collection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type text NOT NULL,
  item_number text NOT NULL,
  name text,
  theme text,
  subtheme text,
  year integer,
  pieces_count integer,
  minifigs_count integer,
  condition text,
  collection_name text,
  acquired_date date,
  paid_price numeric,
  current_value numeric,
  growth numeric,
  retail_price numeric,
  released_date text,
  retired_date text,
  currency text NOT NULL DEFAULT 'GBP',
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_type, item_number, paid_price, acquired_date)
);
ALTER TABLE public.brickeconomy_collection ENABLE ROW LEVEL SECURITY;
CREATE POLICY "BE collection managed by staff" ON public.brickeconomy_collection FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE TABLE public.brickeconomy_portfolio_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_type text NOT NULL,
  total_count integer,
  unique_count integer,
  current_value numeric,
  currency text NOT NULL DEFAULT 'GBP',
  period_data jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.brickeconomy_portfolio_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY "BE snapshots managed by staff" ON public.brickeconomy_portfolio_snapshot FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
