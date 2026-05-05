INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES
  ('20260505132959', 'fix_vat_risk_reserve_percent_regression', ARRAY['-- applied out-of-band']),
  ('20260505142959', 'correct_pricing_floor_target_vat', ARRAY['-- applied out-of-band'])
ON CONFLICT (version) DO NOTHING;