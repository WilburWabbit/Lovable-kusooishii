ALTER TABLE public.channel_category_schema
  ADD COLUMN IF NOT EXISTS condition_policy jsonb,
  ADD COLUMN IF NOT EXISTS condition_policy_fetched_at timestamptz;

COMMENT ON COLUMN public.channel_category_schema.condition_policy IS
  'Cached eBay item-condition policy for this category. Shape: { itemConditionRequired: boolean, itemConditions: [{conditionId, conditionDescription}], itemConditionDescriptionEnabled: boolean }';