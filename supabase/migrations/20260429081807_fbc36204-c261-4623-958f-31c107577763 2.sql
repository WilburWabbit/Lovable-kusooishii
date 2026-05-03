CREATE TABLE public.brickowl_mpn_alias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mpn text NOT NULL UNIQUE,
  boid text NOT NULL,
  confidence text NOT NULL DEFAULT 'auto'
    CHECK (confidence IN ('auto', 'verified', 'manual')),
  source text NOT NULL DEFAULT 'lookup'
    CHECK (source IN ('lookup', 'manual', 'import')),
  last_verified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_brickowl_alias_mpn ON public.brickowl_mpn_alias (mpn);
CREATE INDEX idx_brickowl_alias_boid ON public.brickowl_mpn_alias (boid);

ALTER TABLE public.brickowl_mpn_alias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "BrickOwl aliases managed by staff"
  ON public.brickowl_mpn_alias
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE TRIGGER trg_brickowl_alias_updated_at
  BEFORE UPDATE ON public.brickowl_mpn_alias
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();