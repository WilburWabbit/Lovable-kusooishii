-- Recreate view with security_invoker so it doesn't bypass RLS
DROP VIEW IF EXISTS public.lego_set_minifigs;

CREATE VIEW public.lego_set_minifigs
WITH (security_invoker = true) AS
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

-- Lock down the SECURITY DEFINER allocator: only staff/admin/service role.
REVOKE ALL ON FUNCTION public.get_or_create_rebrickable_inventory(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_rebrickable_inventory(text, integer)
  TO service_role;