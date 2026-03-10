
CREATE TABLE public.ebay_notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  notification_id text,
  payload jsonb,
  read boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ebay_notification ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Notifications managed by staff"
  ON public.ebay_notification
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

ALTER PUBLICATION supabase_realtime ADD TABLE public.ebay_notification;
