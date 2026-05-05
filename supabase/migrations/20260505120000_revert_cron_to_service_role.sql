
-- ============================================================
-- Revert cron job auth to vault-stored service_role_key
--
-- Migration 20260504131708 switched all cron jobs to anon key +
-- x-internal-shared-secret. That pattern requires coordinated
-- setup of both vault rows AND Edge Function env vars and broke
-- two functions that were never updated to accept the secret.
-- This migration reverts all 12 jobs to the simpler, working
-- approach: service_role_key read from vault at invocation time.
--
-- Lovable SQL runner: do NOT use dollar-quoted function bodies.
-- ============================================================

-- Guard: warn if service_role_key is missing from vault.
DO '
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets
    WHERE name IN (''service_role_key'', ''SUPABASE_SERVICE_ROLE_KEY'')
  ) THEN
    RAISE NOTICE ''Vault row service_role_key missing. Cron jobs will fail. Add it via vault.create_secret(''''<value>'''', ''''service_role_key'''').'';
  END IF;
END;
';

-- ============================================================
-- 1. Revert invoke_subledger_scheduled_job() to service_role_key
--    (used by the 4 subledger cron jobs)
-- ============================================================

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
  v_supabase_url TEXT;
  v_service_role_key TEXT;
  v_request_id BIGINT;
BEGIN
  SELECT decrypted_secret
  INTO v_supabase_url
  FROM vault.decrypted_secrets
  WHERE name IN (''supabase_url'', ''SUPABASE_URL'')
  ORDER BY CASE WHEN name = ''supabase_url'' THEN 0 ELSE 1 END
  LIMIT 1;

  IF NULLIF(v_supabase_url, '''') IS NULL THEN
    v_supabase_url := ''https://gcgrwujfyurgetvqlmbf.supabase.co'';
  END IF;

  SELECT decrypted_secret
  INTO v_service_role_key
  FROM vault.decrypted_secrets
  WHERE name IN (''service_role_key'', ''SUPABASE_SERVICE_ROLE_KEY'')
  ORDER BY CASE WHEN name = ''service_role_key'' THEN 0 ELSE 1 END
  LIMIT 1;

  IF NULLIF(v_service_role_key, '''') IS NULL THEN
    RAISE EXCEPTION ''Missing service_role_key for scheduled subledger job. Store it in vault as service_role_key.'';
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

COMMENT ON FUNCTION public.invoke_subledger_scheduled_job(TEXT, JSONB)
IS 'Invokes the subledger-scheduled-jobs Edge Function for pg_cron automation using the service_role_key stored in Supabase Vault.';

-- ============================================================
-- 2. Reschedule the 8 directly-called cron jobs
--    All use service_role_key from vault as Bearer token.
-- ============================================================

-- 2a. ebay-import-payouts-weekly
SELECT cron.unschedule('ebay-import-payouts-weekly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebay-import-payouts-weekly');

SELECT cron.schedule(
  'ebay-import-payouts-weekly',
  '0 5 * * 2',
  '
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''supabase_url'' LIMIT 1) || ''/functions/v1/ebay-import-payouts'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''service_role_key'' LIMIT 1)
    ),
    body := ''{}''::jsonb
  ) AS request_id;
  '
);

-- 2b. ebay-nightly-stock-drift-check
SELECT cron.unschedule('ebay-nightly-stock-drift-check')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebay-nightly-stock-drift-check');

SELECT cron.schedule(
  'ebay-nightly-stock-drift-check',
  '15 2 * * *',
  '
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''supabase_url'' LIMIT 1) || ''/functions/v1/ebay-sync'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''service_role_key'' LIMIT 1)
    ),
    body := jsonb_build_object(''action'', ''push_stock'', ''source'', ''cron:nightly-drift-check'', ''time'', now())
  ) AS request_id;
  '
);

-- 2c. ebay-retry-order-every-5min
SELECT cron.unschedule('ebay-retry-order-every-5min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebay-retry-order-every-5min');

SELECT cron.schedule(
  'ebay-retry-order-every-5min',
  '*/5 * * * *',
  '
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''supabase_url'' LIMIT 1) || ''/functions/v1/ebay-retry-order'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''service_role_key'' LIMIT 1)
    ),
    body := jsonb_build_object(''source'', ''cron:ebay-retry-order-every-5min'', ''time'', now())
  ) AS request_id;
  '
);

-- 2d. process-email-queue (preserve rate-limit guard)
SELECT cron.unschedule('process-email-queue')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue');

SELECT cron.schedule(
  'process-email-queue',
  '5 seconds',
  '
  SELECT CASE
    WHEN (SELECT retry_after_until FROM public.email_send_state WHERE id = 1) > now()
      THEN NULL
    WHEN EXISTS (SELECT 1 FROM pgmq.q_auth_emails LIMIT 1)
      OR EXISTS (SELECT 1 FROM pgmq.q_transactional_emails LIMIT 1)
      THEN net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''supabase_url'' LIMIT 1) || ''/functions/v1/process-email-queue'',
        headers := jsonb_build_object(
          ''Content-Type'', ''application/json'',
          ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''service_role_key'' LIMIT 1)
        ),
        body := ''{}''::jsonb
      )
    ELSE NULL
  END;
  '
);

-- 2e. qbo-process-pending-safety-net (preserve x-webhook-trigger header)
SELECT cron.unschedule('qbo-process-pending-safety-net')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'qbo-process-pending-safety-net');

SELECT cron.schedule(
  'qbo-process-pending-safety-net',
  '* * * * *',
  '
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''supabase_url'' LIMIT 1) || ''/functions/v1/qbo-process-pending'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''service_role_key'' LIMIT 1),
      ''x-webhook-trigger'', ''true''
    ),
    body := ''{"batch_size": 50}''::jsonb
  ) AS request_id;
  '
);

-- 2f. rebrickable-daily-incremental
SELECT cron.unschedule('rebrickable-daily-incremental')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rebrickable-daily-incremental');

SELECT cron.schedule(
  'rebrickable-daily-incremental',
  '0 3 * * *',
  '
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''supabase_url'' LIMIT 1) || ''/functions/v1/rebrickable-sync'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''service_role_key'' LIMIT 1)
    ),
    body := ''{"mode": "incremental"}''::jsonb
  ) AS request_id;
  '
);

-- 2g. v2-auto-markdown-prices
SELECT cron.unschedule('v2-auto-markdown-prices')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'v2-auto-markdown-prices');

SELECT cron.schedule(
  'v2-auto-markdown-prices',
  '0 7 * * *',
  '
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''supabase_url'' LIMIT 1) || ''/functions/v1/auto-markdown-prices'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''service_role_key'' LIMIT 1)
    ),
    body := ''{}''::jsonb
  ) AS request_id;
  '
);

-- 2h. v2-auto-progress-orders
SELECT cron.unschedule('v2-auto-progress-orders')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'v2-auto-progress-orders');

SELECT cron.schedule(
  'v2-auto-progress-orders',
  '0 6 * * *',
  '
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''supabase_url'' LIMIT 1) || ''/functions/v1/auto-progress-orders'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''service_role_key'' LIMIT 1)
    ),
    body := ''{}''::jsonb
  ) AS request_id;
  '
);
