-- Replace the user-facing subledger workflow with an actionable operations issue inbox.
ALTER TABLE public.channel_pricing_config
  ADD COLUMN IF NOT EXISTS price_issue_tolerance_pct NUMERIC(8,4) NOT NULL DEFAULT 0.05,
  ADD COLUMN IF NOT EXISTS price_issue_tolerance_amount NUMERIC(12,2) NOT NULL DEFAULT 2.00;

CREATE TABLE IF NOT EXISTS public.operations_issue_suppression (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'dismissed'
    CHECK (status IN ('dismissed', 'resolved', 'suppressed')),
  reason TEXT NOT NULL,
  action TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

ALTER TABLE public.operations_issue_suppression ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operations_issue_suppression_staff_all
  ON public.operations_issue_suppression;

CREATE POLICY operations_issue_suppression_staff_all
  ON public.operations_issue_suppression
  FOR ALL TO authenticated
  USING (public.subledger_staff_read_policy())
  WITH CHECK (public.subledger_staff_read_policy());

DROP TRIGGER IF EXISTS set_operations_issue_suppression_updated_at
  ON public.operations_issue_suppression;

CREATE TRIGGER set_operations_issue_suppression_updated_at
  BEFORE UPDATE ON public.operations_issue_suppression
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_operations_issue_suppression_active
  ON public.operations_issue_suppression(issue_key, status, expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.operations_issue_suppression
  TO authenticated, service_role;