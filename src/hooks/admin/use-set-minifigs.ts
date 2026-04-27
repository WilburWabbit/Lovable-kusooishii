// ============================================================
// Admin V2 — Set Minifigs hook
//
// Loads the list of minifigs included in a LEGO set (sourced
// from the rebrickable inventory data via the
// `lego_set_minifigs` view) and persists which of those minifig
// images should be included in marketplace listings (eBay etc).
// ============================================================

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { productKeys } from "./use-products";
import type { SetMinifig } from "@/lib/types/admin";

export const setMinifigsKeys = {
  all: ["v2", "set-minifigs"] as const,
  list: (mpn: string) => ["v2", "set-minifigs", mpn] as const,
};

// ─── useSetMinifigs ────────────────────────────────────────

export function useSetMinifigs(mpn: string | undefined) {
  return useQuery({
    queryKey: setMinifigsKeys.list(mpn ?? ""),
    enabled: !!mpn,
    queryFn: async (): Promise<SetMinifig[]> => {
      // Match either the bare set number or the version-suffixed one,
      // since the rebrickable sync stores it suffixed (e.g. "75367-1").
      const base = mpn!.split(".")[0];
      const candidates = Array.from(new Set([base, `${base.split("-")[0]}-1`]));

      const { data, error } = await supabase
        .from("lego_set_minifigs" as never)
        .select("fig_num, minifig_name, bricklink_id, minifig_img_url, quantity")
        .in("set_num" as never, candidates as never);

      if (error) throw error;

      // De-dupe by fig_num (different inventory versions may overlap).
      const seen = new Map<string, SetMinifig>();
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const figNum = row.fig_num as string | null;
        if (!figNum) continue;
        if (seen.has(figNum)) continue;
        seen.set(figNum, {
          figNum,
          name: (row.minifig_name as string | null) ?? null,
          bricklinkId: (row.bricklink_id as string | null) ?? null,
          imgUrl: (row.minifig_img_url as string | null) ?? null,
          quantity: (row.quantity as number) ?? 1,
        });
      }

      return Array.from(seen.values()).sort((a, b) =>
        (a.name ?? a.figNum).localeCompare(b.name ?? b.figNum),
      );
    },
  });
}

// ─── useUpdateMinifigSelection ─────────────────────────────

interface UpdateInput {
  productId: string;
  mpn: string;
  figNums: string[];
}

export function useUpdateMinifigSelection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, figNums }: UpdateInput) => {
      const { error } = await supabase
        .from("product")
        .update({ selected_minifig_fig_nums: figNums } as never)
        .eq("id", productId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: productKeys.detail(vars.mpn) });
    },
  });
}
