-- ─── 1. New table: BrickLink-sourced minifigs per set ─────
CREATE TABLE IF NOT EXISTS public.bricklink_set_minifig (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_no text NOT NULL,        -- BrickLink set number incl. version, e.g. "75367-1"
  bl_mpn text NOT NULL,        -- BrickLink minifig MPN, e.g. "sw0001"
  name text,
  image_url text,
  quantity integer NOT NULL DEFAULT 1,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bricklink_set_minifig_set_mpn_uniq UNIQUE (set_no, bl_mpn)
);

CREATE INDEX IF NOT EXISTS idx_bricklink_set_minifig_set_no
  ON public.bricklink_set_minifig (set_no);

ALTER TABLE public.bricklink_set_minifig ENABLE ROW LEVEL SECURITY;

CREATE POLICY "BL set minifigs readable by authenticated"
  ON public.bricklink_set_minifig
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "BL set minifigs managed by staff"
  ON public.bricklink_set_minifig
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_bricklink_set_minifig_updated_at ON public.bricklink_set_minifig;
CREATE TRIGGER trg_bricklink_set_minifig_updated_at
  BEFORE UPDATE ON public.bricklink_set_minifig
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── 2. Redefine lego_set_minifigs view ───────────────────
-- Strategy: union BrickLink (source='bricklink') with Rebrickable rows that
-- have no matching BL row for the same set. The `fig_num` column emits the
-- BrickLink MPN when sourced from BL, otherwise the Rebrickable fig_num.
-- This keeps existing callers working but transparently flips the canonical
-- identifier to BL MPN whenever BL data exists.
DROP VIEW IF EXISTS public.lego_set_minifigs;

CREATE VIEW public.lego_set_minifigs
WITH (security_invoker = true) AS
-- BrickLink rows (preferred)
SELECT
  bl.set_no                          AS set_num,
  NULL::integer                      AS inventory_version,
  bl.bl_mpn                          AS fig_num,
  bl.name                            AS minifig_name,
  bl.bl_mpn                          AS bricklink_id,
  bl.image_url                       AS minifig_img_url,
  NULL::integer                      AS minifig_num_parts,
  bl.quantity                        AS quantity,
  'bricklink'::text                  AS source
FROM public.bricklink_set_minifig bl

UNION ALL

-- Rebrickable fallback (only if no BrickLink rows exist for that set)
SELECT
  inv.set_num,
  inv.version       AS inventory_version,
  m.fig_num,
  m.name            AS minifig_name,
  m.bricklink_id,
  m.img_url         AS minifig_img_url,
  m.num_parts       AS minifig_num_parts,
  link.quantity,
  'rebrickable'::text AS source
FROM public.rebrickable_inventory_minifigs link
JOIN public.rebrickable_inventories inv ON inv.id = link.inventory_id
JOIN public.rebrickable_minifigs m      ON m.fig_num = link.fig_num
WHERE NOT EXISTS (
  SELECT 1 FROM public.bricklink_set_minifig bl
  WHERE bl.set_no = inv.set_num
);

GRANT SELECT ON public.lego_set_minifigs TO anon, authenticated;