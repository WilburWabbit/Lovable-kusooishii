
-- 1. Add column to track which minifigs are included in listings
ALTER TABLE public.product
  ADD COLUMN IF NOT EXISTS selected_minifig_fig_nums jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.product.selected_minifig_fig_nums IS
  'Array of rebrickable fig_num values whose images should be included in marketplace listings (e.g. eBay).';

-- 2. Update the LEGO Character canonical attribute so the auto-resolved
--    value is derived from the set's included minifigs (Name (fig_num)
--    per line). The existing product.lego_character text column remains
--    the manual override fallback.
UPDATE public.canonical_attribute
SET provider_chain = '[
        {"provider": "derived", "field": "minifigs_lego_character"},
        {"provider": "product", "field": "lego_character"}
      ]'::jsonb,
    updated_at = now()
WHERE key = 'lego_character';
