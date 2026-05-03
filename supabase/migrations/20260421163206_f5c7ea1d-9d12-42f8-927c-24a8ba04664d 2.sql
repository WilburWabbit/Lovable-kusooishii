DO $$
DECLARE
  v_key text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1;
  SELECT net.http_post(
    url := 'https://gcgrwujfyurgetvqlmbf.supabase.co/functions/v1/ebay-sync',
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
  RAISE NOTICE 'request id=%', v_request_id;
END $$;