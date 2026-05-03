-- 1. Unique constraint so we can upsert by (set_num, version)
ALTER TABLE public.rebrickable_inventories
  ADD CONSTRAINT rebrickable_inventories_set_num_version_key
  UNIQUE (set_num, version);

-- 2. Allocator: returns the inventory_id for a (set_num, version), creating one
--    with the next free integer id if it doesn't yet exist. SECURITY DEFINER so
--    the edge function (service role) and any future RPC calls behave the same.
CREATE OR REPLACE FUNCTION public.get_or_create_rebrickable_inventory(
  p_set_num text,
  p_version integer DEFAULT 1
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id integer;
BEGIN
  SELECT id INTO v_id
  FROM public.rebrickable_inventories
  WHERE set_num = p_set_num AND version = p_version;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- Allocate next id. Lock the table briefly to avoid a race between
  -- concurrent edge-function invocations.
  LOCK TABLE public.rebrickable_inventories IN SHARE ROW EXCLUSIVE MODE;

  SELECT COALESCE(MAX(id), 0) + 1 INTO v_id
  FROM public.rebrickable_inventories;

  INSERT INTO public.rebrickable_inventories (id, set_num, version)
  VALUES (v_id, p_set_num, p_version)
  ON CONFLICT (set_num, version) DO UPDATE SET set_num = EXCLUDED.set_num
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 3. Convenience view: minifigs included in each set, with the names/images
--    needed for product descriptions and eBay item specifics.
CREATE OR REPLACE VIEW public.lego_set_minifigs AS
SELECT
  inv.set_num,
  inv.version       AS inventory_version,
  m.fig_num,
  m.name            AS minifig_name,
  m.bricklink_id,
  m.img_url         AS minifig_img_url,
  m.num_parts       AS minifig_num_parts,
  link.quantity
FROM public.rebrickable_inventory_minifigs link
JOIN public.rebrickable_inventories inv ON inv.id = link.inventory_id
JOIN public.rebrickable_minifigs m      ON m.fig_num = link.fig_num;

GRANT SELECT ON public.lego_set_minifigs TO anon, authenticated;