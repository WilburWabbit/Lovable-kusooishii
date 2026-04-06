
CREATE TABLE public.landing_raw_qbo_deposit (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  external_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  processed_at timestamp with time zone,
  status public.landing_status NOT NULL DEFAULT 'pending'::public.landing_status,
  error_message text,
  correlation_id uuid DEFAULT gen_random_uuid(),
  cloud_event_id text,
  event_time timestamp with time zone
);

ALTER TABLE public.landing_raw_qbo_deposit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage landing_raw_qbo_deposit"
  ON public.landing_raw_qbo_deposit
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE INDEX idx_landing_raw_qbo_deposit_status ON public.landing_raw_qbo_deposit(status);
CREATE INDEX idx_landing_raw_qbo_deposit_external_id ON public.landing_raw_qbo_deposit(external_id);
