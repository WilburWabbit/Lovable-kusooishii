-- Schedule safe subledger automation jobs through one service-role Edge Function.
-- Lovable SQL runner note: do not use dollar-quoted function bodies in this file.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.invoke_subledger_scheduled_job(
  p_job TEXT,
  p_body JSONB DEFAULT '{}'::jsonb
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS '
DECLARE
  v_supabase_url TEXT := current_setting(''app.settings.supabase_url'', true);
  v_service_role_key TEXT := current_setting(''app.settings.service_role_key'', true);
  v_request_id BIGINT;
BEGIN
  IF NULLIF(v_supabase_url, '''') IS NULL THEN
    SELECT decrypted_secret
    INTO v_supabase_url
    FROM vault.decrypted_secrets
    WHERE name IN (''supabase_url'', ''SUPABASE_URL'')
    ORDER BY CASE WHEN name = ''supabase_url'' THEN 0 ELSE 1 END
    LIMIT 1;
  END IF;

  IF NULLIF(v_supabase_url, '''') IS NULL THEN
    v_supabase_url := ''https://gcgrwujfyurgetvqlmbf.supabase.co'';
  END IF;

  IF NULLIF(v_service_role_key, '''') IS NULL THEN
    SELECT decrypted_secret
    INTO v_service_role_key
    FROM vault.decrypted_secrets
    WHERE name IN (''service_role_key'', ''SUPABASE_SERVICE_ROLE_KEY'')
    ORDER BY CASE WHEN name = ''service_role_key'' THEN 0 ELSE 1 END
    LIMIT 1;
  END IF;

  IF NULLIF(v_service_role_key, '''') IS NULL THEN
    RAISE EXCEPTION ''Missing service role key for scheduled subledger job. Store it in vault as service_role_key.'';
  END IF;

  SELECT net.http_post(
    url := rtrim(v_supabase_url, ''/'') || ''/functions/v1/subledger-scheduled-jobs'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || v_service_role_key
    ),
    body := COALESCE(p_body, ''{}''::jsonb) || jsonb_build_object(''job'', p_job)
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
';

GRANT EXECUTE ON FUNCTION public.invoke_subledger_scheduled_job(TEXT, JSONB) TO postgres, service_role;

DO '
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = ''subledger-listing-outbox-processor'') THEN
    PERFORM cron.unschedule(''subledger-listing-outbox-processor'');
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = ''subledger-qbo-posting-outbox-processor'') THEN
    PERFORM cron.unschedule(''subledger-qbo-posting-outbox-processor'');
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = ''subledger-settlement-reconciliation-refresh'') THEN
    PERFORM cron.unschedule(''subledger-settlement-reconciliation-refresh'');
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = ''subledger-market-intelligence-refresh'') THEN
    PERFORM cron.unschedule(''subledger-market-intelligence-refresh'');
  END IF;
END;
';

SELECT cron.schedule(
  'subledger-listing-outbox-processor',
  '*/5 * * * *',
  'SELECT public.invoke_subledger_scheduled_job(''listing_outbox'', ''{"batchSize":25}''::jsonb);'
);

SELECT cron.schedule(
  'subledger-qbo-posting-outbox-processor',
  '1-59/5 * * * *',
  'SELECT public.invoke_subledger_scheduled_job(''qbo_posting_outbox'', ''{"batchSize":25}''::jsonb);'
);

SELECT cron.schedule(
  'subledger-settlement-reconciliation-refresh',
  '17 * * * *',
  'SELECT public.invoke_subledger_scheduled_job(''settlement_reconciliation'', ''{}''::jsonb);'
);

SELECT cron.schedule(
  'subledger-market-intelligence-refresh',
  '30 3 * * *',
  'SELECT public.invoke_subledger_scheduled_job(''market_intelligence'', ''{"marketLimit":60}''::jsonb);'
);

COMMENT ON FUNCTION public.invoke_subledger_scheduled_job(TEXT, JSONB)
IS 'Invokes the subledger-scheduled-jobs Edge Function for pg_cron automation. Requires Supabase URL and service_role_key in app settings or vault.';
