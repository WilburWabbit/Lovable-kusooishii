-- Modular payout-adapter support
-- 1. Track per-fee QBO Purchase id so the stripe adapter (and any future
--    channel without its own tx table) can cache QBO sync results on the
--    fee row itself.
ALTER TABLE public.payout_fee
  ADD COLUMN IF NOT EXISTS qbo_purchase_id text;

COMMENT ON COLUMN public.payout_fee.qbo_purchase_id IS
  'QBO Purchase Id for this fee row, when synced via the channel-agnostic qbo-sync-payout core. Channels with their own tx table (eBay) continue to store the id on that tx table.';