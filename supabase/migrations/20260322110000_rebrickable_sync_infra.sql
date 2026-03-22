-- Rebrickable API sync infrastructure
-- Adds landing table, sync state tracking, and theme mapping column
-- for automated daily catalog sync from Rebrickable API v3.

-- ─── Theme mapping column ───
-- Rebrickable uses integer theme IDs; the app uses UUID PKs.
-- This column bridges the two for FK mapping during set promotion.
ALTER TABLE public.theme
  ADD COLUMN IF NOT EXISTS rebrickable_theme_id INTEGER UNIQUE;

CREATE INDEX IF NOT EXISTS idx_theme_rebrickable_id
  ON public.theme (rebrickable_theme_id)
  WHERE rebrickable_theme_id IS NOT NULL;

-- ─── Landing table for Rebrickable API responses ───
CREATE TABLE public.landing_raw_rebrickable (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL,           -- e.g. 'themes_page_1', 'sets_page_3', 'sets_incremental_page_1'
  entity_type text NOT NULL DEFAULT 'sets',  -- 'sets' or 'themes'
  raw_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status landing_status NOT NULL DEFAULT 'pending',
  error_message text,
  correlation_id uuid DEFAULT gen_random_uuid(),
  UNIQUE (entity_type, external_id)
);
ALTER TABLE public.landing_raw_rebrickable ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage landing_raw_rebrickable" ON public.landing_raw_rebrickable
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- ─── Sync state tracking ───
-- Stores the last_modified_dt cutoff so incremental syncs only fetch
-- sets modified since the previous run.
CREATE TABLE public.rebrickable_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type text NOT NULL UNIQUE,        -- 'sets' or 'themes'
  last_synced_at timestamptz,
  last_modified_cutoff timestamptz,      -- oldest last_modified_dt processed in last run
  sets_processed integer DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rebrickable_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage rebrickable_sync_state" ON public.rebrickable_sync_state
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- Seed initial rows so upserts work from the first sync
INSERT INTO public.rebrickable_sync_state (sync_type) VALUES ('sets'), ('themes')
  ON CONFLICT (sync_type) DO NOTHING;

-- ============================================================
-- POST-MIGRATION STEPS (pg_cron + pg_net for daily sync)
-- Applied dynamically via Supabase Management API, same pattern
-- as email_infra migration.
-- ============================================================
--
-- 1. VAULT SECRET
--    Store the Rebrickable API key in vault:
--    SELECT vault.create_secret('<REBRICKABLE_API_KEY>', 'rebrickable_api_key');
--
-- 2. CRON JOB (pg_cron)
--    Creates job 'rebrickable-daily-sync' running at 03:00 UTC daily.
--    The job calls the rebrickable-sync Edge Function via net.http_post:
--      a) First call with { "mode": "themes" }
--      b) Second call with { "mode": "sets" } (incremental)
--    Uses vault-stored service_role key for auth header.
--    To revert: SELECT cron.unschedule('rebrickable-daily-sync');
