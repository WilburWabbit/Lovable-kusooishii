import { supabase } from "@/integrations/supabase/client";

export const COLLECTIBLE_MINIFIGURES_THEME_NAME = "Collectible Minifigures";
const COLLECTIBLE_MINIFIGURES_THEME_SLUG = "collectible-minifigures";

export interface StorefrontThemeOption {
  id: string;
  name: string;
}

export async function fetchCollectibleMinifigsTheme(): Promise<StorefrontThemeOption | null> {
  const { data, error } = await supabase
    .from("theme")
    .select("id, name")
    .eq("slug", COLLECTIBLE_MINIFIGURES_THEME_SLUG)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export async function fetchBrowsableCollectibleMinifigsTheme(): Promise<{
  theme: StorefrontThemeOption;
  rows: { product_id: string; img_url: string | null }[];
} | null> {
  const theme = await fetchCollectibleMinifigsTheme();
  if (!theme) return null;

  const { data, error } = await supabase.rpc("browse_catalog", {
    search_term: null,
    filter_theme_id: theme.id,
    filter_grade: null,
    filter_retired: null,
  });

  if (error) throw error;

  const rows = ((data ?? []) as { product_id: string; img_url: string | null }[]);
  if (rows.length === 0) return null;

  return { theme, rows };
}

export function getStorefrontThemeName(themeName: string | null | undefined, productType: string | null | undefined) {
  if (themeName) return themeName;
  return productType === "minifig" ? COLLECTIBLE_MINIFIGURES_THEME_NAME : null;
}
