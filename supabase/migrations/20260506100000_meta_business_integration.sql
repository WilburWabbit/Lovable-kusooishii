-- Meta business integration: OAuth connection, discovered assets, and raw catalog sync evidence.
-- Keep this migration Lovable SQL-runner friendly: no dollar-quoted function bodies.

CREATE TABLE IF NOT EXISTS public.meta_connection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_user_id TEXT,
  meta_user_name TEXT,
  access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  selected_business_id TEXT,
  selected_catalog_id TEXT,
  selected_page_id TEXT,
  selected_instagram_account_id TEXT,
  selected_ad_account_id TEXT,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.meta_connection ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage Meta connection" ON public.meta_connection;
CREATE POLICY "Admins can manage Meta connection"
  ON public.meta_connection FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.meta_business_asset (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type TEXT NOT NULL CHECK (asset_type IN ('business','page','instagram_account','ad_account','product_catalog')),
  external_id TEXT NOT NULL,
  business_id TEXT,
  name TEXT,
  username TEXT,
  access_token TEXT,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_type, external_id)
);

ALTER TABLE public.meta_business_asset ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage Meta assets" ON public.meta_business_asset;
CREATE POLICY "Admins can manage Meta assets"
  ON public.meta_business_asset FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX IF NOT EXISTS meta_business_asset_type_idx
  ON public.meta_business_asset(asset_type, business_id, name);

CREATE TABLE IF NOT EXISTS public.meta_catalog_sync_run (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','partial','failed')),
  total_items INTEGER NOT NULL DEFAULT 0,
  sent_items INTEGER NOT NULL DEFAULT 0,
  skipped_items INTEGER NOT NULL DEFAULT 0,
  error_items INTEGER NOT NULL DEFAULT 0,
  dry_run BOOLEAN NOT NULL DEFAULT false,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

ALTER TABLE public.meta_catalog_sync_run ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read Meta catalog sync runs" ON public.meta_catalog_sync_run;
CREATE POLICY "Staff can read Meta catalog sync runs"
  ON public.meta_catalog_sync_run FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'staff'::public.app_role)
  );

DROP POLICY IF EXISTS "Admins can manage Meta catalog sync runs" ON public.meta_catalog_sync_run;
CREATE POLICY "Admins can manage Meta catalog sync runs"
  ON public.meta_catalog_sync_run FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX IF NOT EXISTS meta_catalog_sync_run_catalog_started_idx
  ON public.meta_catalog_sync_run(catalog_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.landing_raw_meta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id UUID REFERENCES public.meta_catalog_sync_run(id) ON DELETE SET NULL,
  operation TEXT NOT NULL,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','sent','committed','error')),
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

ALTER TABLE public.landing_raw_meta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read Meta landing rows" ON public.landing_raw_meta;
CREATE POLICY "Staff can read Meta landing rows"
  ON public.landing_raw_meta FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'staff'::public.app_role)
  );

DROP POLICY IF EXISTS "Admins can manage Meta landing rows" ON public.landing_raw_meta;
CREATE POLICY "Admins can manage Meta landing rows"
  ON public.landing_raw_meta FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX IF NOT EXISTS landing_raw_meta_operation_created_idx
  ON public.landing_raw_meta(operation, created_at DESC);

CREATE INDEX IF NOT EXISTS landing_raw_meta_sync_run_idx
  ON public.landing_raw_meta(sync_run_id);
