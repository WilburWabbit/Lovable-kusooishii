-- Diagnostic: call ebay-sync check_offer to see actual eBay state
DO $$
DECLARE
  v_url text := current_setting('app.settings.supabase_url', true);
  v_key text := current_setting('app.settings.service_role_key', true);
  v_request_id bigint;
BEGIN
  IF v_url IS NULL THEN v_url := 'https://gcgrwujfyurgetvqlmbf.supabase.co'; END IF;
  IF v_key IS NULL THEN
    -- Fallback: read from vault if available
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  END IF;

  SELECT net.http_post(
    url := v_url || '/functions/v1/ebay-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object(
      'action','check_offer',
      '_triggered_by','notification',
      'offerIds', ARRAY['205909093672','205906621862'],
      'skus', ARRAY['31058-1.1','60438-1.1']
    )
  ) INTO v_request_id;
  RAISE NOTICE 'Sent check_offer request id=%', v_request_id;
END $$;