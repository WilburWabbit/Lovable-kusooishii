import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Package } from "lucide-react";
import { usePagination } from "@/hooks/usePagination";
import { PaginationControls } from "@/components/PaginationControls";
import { fetchBrowsableCollectibleMinifigsTheme } from "@/lib/collectible-minifigs-theme";

interface ThemeWithCount {
  theme_id: string;
  theme_name: string;
  product_count: number;
  sample_img: string | null;
}

export function ThemesGrid() {
  const { data: themes, isLoading } = useQuery({
    queryKey: ["storefront_themes_with_counts"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("browse_catalog", {
        search_term: null,
        filter_theme_id: null,
        filter_grade: null,
        filter_retired: null,
      });
      if (error) throw error;
      const rows = data as {
        product_id: string;
        theme_id: string | null;
        theme_name: string | null;
        img_url: string | null;
      }[];

      const themeMap = new Map<string, ThemeWithCount>();
      for (const row of rows) {
        if (!row.theme_id || !row.theme_name) continue;
        const existing = themeMap.get(row.theme_id);
        if (existing) {
          existing.product_count++;
          if (!existing.sample_img && row.img_url) {
            existing.sample_img = row.img_url;
          }
        } else {
          themeMap.set(row.theme_id, {
            theme_id: row.theme_id,
            theme_name: row.theme_name,
            product_count: 1,
            sample_img: row.img_url || null,
          });
        }
      }

      const collectibleMinifigsTheme = await fetchBrowsableCollectibleMinifigsTheme();
      if (collectibleMinifigsTheme) {
        themeMap.set(collectibleMinifigsTheme.theme.id, {
          theme_id: collectibleMinifigsTheme.theme.id,
          theme_name: collectibleMinifigsTheme.theme.name,
          product_count: collectibleMinifigsTheme.rows.length,
          sample_img: collectibleMinifigsTheme.rows.find((row) => row.img_url)?.img_url ?? null,
        });
      }

      return Array.from(themeMap.values()).sort((a, b) =>
        a.theme_name.localeCompare(b.theme_name)
      );
    },
  });

  const {
    paginatedItems: paginatedThemes,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalPages,
    totalItems,
    pageSizeOptions,
  } = usePagination(themes);

  return (
    <div className="bg-background">
      <div className="border-b border-border bg-kuso-paper py-8">
        <div className="container">
          <h1 className="font-display text-2xl font-bold text-foreground">
            Shop by Theme
          </h1>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            {isLoading
              ? "Loading…"
              : `${themes?.length ?? 0} themes available`}
          </p>
        </div>
      </div>

      <div className="container py-8">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="border border-border rounded-lg overflow-hidden">
                <Skeleton className="aspect-[4/3] w-full rounded-none" />
                <div className="p-4 space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : paginatedThemes && paginatedThemes.length > 0 ? (
          <>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {paginatedThemes.map((theme) => (
              <Link
                key={theme.theme_id}
                to={`/browse?theme=${theme.theme_id}`}
                className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-background transition-all hover:shadow-lg hover:border-primary/30"
              >
                <div className="aspect-[4/3] bg-background relative overflow-hidden">
                  {theme.sample_img ? (
                    <img
                      src={theme.sample_img}
                      alt={theme.theme_name}
                      className="h-full w-full object-contain p-6 transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Package className="h-12 w-12 text-muted-foreground/20" />
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between p-4 bg-card">
                  <h3 className="font-display text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                    {theme.theme_name}
                  </h3>
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 font-body text-xs font-medium text-muted-foreground">
                    {theme.product_count}{" "}
                    {theme.product_count === 1 ? "set" : "sets"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
          <PaginationControls
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            pageSizeOptions={pageSizeOptions}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            itemLabel="themes"
          />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="font-display text-lg font-semibold text-foreground">
              No themes found
            </p>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              Check back soon for new arrivals.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
