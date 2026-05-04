-- Safety-net cron: drain any pending QBO landing records every minute.
-- Protects against webhook background-task aborts and covers manual qbo-sync-* backfills.
SELECT cron.schedule(
  'qbo-process-pending-safety-net',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://gcgrwujfyurgetvqlmbf.supabase.co/functions/v1/qbo-process-pending',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjZ3J3dWpmeXVyZ2V0dnFsbWJmIiwicm9sZSI6c2VydmljZV9yb2xlIiwiaWF0IjoxNzczMDY0ODE0LCJleHAiOjIwODg2NDA4MTR9',
      'x-webhook-trigger', 'true'
    ),
    body := '{"batch_size": 50}'::jsonb
  ) AS request_id;
  $$
);