INSERT INTO qbo_account_settings (key, account_id) VALUES
  ('qbo_sales_tax_code_id', '6'),
  ('qbo_purchase_tax_code_id', '6'),
  ('qbo_zero_rated_tax_code_id', '8')
ON CONFLICT (key) DO NOTHING;