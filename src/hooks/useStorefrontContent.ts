import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { deepMerge } from "@/lib/deep-merge";
import { toast } from "sonner";

export function useStorefrontContent<T extends Record<string, unknown>>(
  pageKey: string,
  defaults: T,
) {
  return useQuery({
    queryKey: ["storefront-content", pageKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("storefront_content" as any)
        .select("content")
        .eq("page_key", pageKey)
        .maybeSingle();
      if (error) throw error;
      if (!data) return defaults;
      return deepMerge(defaults, (data as any).content as Partial<T>);
    },
    placeholderData: defaults,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveContent<T>(pageKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: T) => {
      const { error } = await (supabase as any)
        .from("storefront_content")
        .upsert(
          { page_key: pageKey, content, updated_at: new Date().toISOString() },
          { onConflict: "page_key" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["storefront-content", pageKey] });
      toast.success("Content saved.");
    },
    onError: (err: Error) => {
      toast.error(`Save failed: ${err.message}`);
    },
  });
}
