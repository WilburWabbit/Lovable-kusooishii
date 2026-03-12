-- Seed condition multipliers and explicit pricing defaults
INSERT INTO public.selling_cost_defaults (key, value) VALUES
  ('minimum_profit_amount', 1),
  ('minimum_margin_rate', 0.15),
  ('condition_multiplier_1', 1.00),
  ('condition_multiplier_2', 0.85),
  ('condition_multiplier_3', 0.70),
  ('condition_multiplier_4', 0.55),
  ('condition_multiplier_5', 0.40)
ON CONFLICT (key) DO NOTHING;
