import { StorefrontLayout } from "@/components/StorefrontLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useSearchParams } from "react-router-dom";
import { Search, SlidersHorizontal } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo, useEffect } from "react";
import { ThemesGrid } from "@/components/ThemesGrid";

const gradeOptions = [
{ value: null, label: "All" },
{ value: "1", label: "1 — Mint" },
{ value: "2", label: "2 — Excellent" },
{ value: "3", label: "3 — Good" },
{ value: "4", label: "4 — Acceptable" }];


const gradeLabels: Record<string, string> = {
  "1": "Mint", "2": "Excellent", "3": "Good", "4": "Acceptable", "5": "Fair"
};

export default function BrowsePage() {
  const [searchParams] = useSearchParams();
  const viewMode = searchParams.get("view");
  const themeFromUrl = searchParams.get("theme");

  const [search, setSearch] = useState("");
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(themeFromUrl);
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null);
  const [retiredFilter, setRetiredFilter] = useState<boolean | null>(null);
  const [yearRange, setYearRange] = useState<[number, number] | null>(null);

  // Sync theme filter from URL
  useEffect(() => {
    setSelectedThemeId(themeFromUrl);
  }, [themeFromUrl]);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useMemo(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch themes and year range from in-stock products
  const { data: filterMeta } = useQuery({
    queryKey: ["browse_filter_meta"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("browse_catalog", {
        search_term: null,
        filter_theme_id: null,
        filter_grade: null,
        filter_retired: null
      });
      if (error) throw error;
      const rows = data as any[];
      const themeMap = new Map<string, {id: string;name: string;}>();
      let minYear = Infinity;
      let maxYear = -Infinity;
      for (const row of rows) {
        if (row.theme_id && row.theme_name && !themeMap.has(row.theme_id)) {
          themeMap.set(row.theme_id, { id: row.theme_id, name: row.theme_name });
        }
        if (row.release_year != null) {
          if (row.release_year < minYear) minYear = row.release_year;
          if (row.release_year > maxYear) maxYear = row.release_year;
        }
      }
      return {
        themes: Array.from(themeMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
        yearMin: minYear === Infinity ? null : minYear,
        yearMax: maxYear === -Infinity ? null : maxYear
      };
    },
    enabled: viewMode !== "themes"
  });

  const themes = filterMeta?.themes;
  const yearMin = filterMeta?.yearMin ?? 2000;
  const yearMax = filterMeta?.yearMax ?? new Date().getFullYear();

  // Fetch browse data
  const { data: products, isLoading } = useQuery({
    queryKey: ["browse_catalog", debouncedSearch, selectedThemeId, selectedGrade, retiredFilter],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("browse_catalog", {
        search_term: debouncedSearch || null,
        filter_theme_id: selectedThemeId || null,
        filter_grade: selectedGrade || null,
        filter_retired: retiredFilter
      });
      if (error) throw error;
      return data as {
        product_id: string;mpn: string;name: string;theme_name: string | null;
        theme_id: string | null;retired_flag: boolean;release_year: number | null;
        piece_count: number | null;min_price: number | null;best_grade: string | null;
        total_stock: number;img_url: string | null;
      }[];
    },
    enabled: viewMode !== "themes"
  });

  const filteredProducts = useMemo(() => {
    if (!products) return products;
    if (!yearRange) return products;
    return products.filter(
      (p) => p.release_year != null && p.release_year >= yearRange[0] && p.release_year <= yearRange[1]
    );
  }, [products, yearRange]);

  if (viewMode === "themes") {
    return (
      <StorefrontLayout>
        <ThemesGrid />
      </StorefrontLayout>);

  }

  return (
    <StorefrontLayout>
      <div className="bg-background">
        {/* Header */}
        <div className="border-b border-border bg-kuso-paper py-8">
          <div className="container">
            <h1 className="font-display text-2xl font-bold text-foreground">Browse Sets</h1>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              {isLoading ? "Loading…" : `${filteredProducts?.length ?? 0} sets available`} · condition graded · version tracked
            </p>
          </div>
        </div>

        <div className="container py-8">
          <div className="flex flex-col gap-8 lg:flex-row">
            {/* Filters sidebar */}
            <aside className="w-full shrink-0 lg:w-56">
              <div className="flex items-center gap-2 lg:hidden">
                <Button variant="outline" size="sm" className="font-display text-xs">
                  <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" /> Filters
                </Button>
              </div>

              <div className="hidden space-y-6 lg:block">
                {/* Search */}
                <div>
                  <label className="font-display font-semibold uppercase tracking-widest text-foreground text-sm">
                    Search
                  </label>
                  <div className="relative mt-2">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Set name or MPN..."
                      className="pl-8 font-body text-sm"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)} />
                    
                  </div>
                </div>

                {/* Theme filter */}
                <div>
                  <label className="font-display font-semibold uppercase tracking-widest text-foreground text-lg">
                    Theme
                  </label>
                  <div className="mt-2 flex flex-col gap-1">
                    <button
                      onClick={() => setSelectedThemeId(null)}
                      className={`rounded px-2 py-1.5 text-left font-body text-sm transition-colors ${
                      selectedThemeId === null ?
                      "bg-foreground text-background" :
                      "text-muted-foreground hover:bg-muted hover:text-foreground"}`
                      }>
                      
                      All
                    </button>
                    {themes?.map((t) =>
                    <button
                      key={t.id}
                      onClick={() => setSelectedThemeId(t.id)}
                      className={`rounded px-2 py-1.5 text-left font-body text-sm transition-colors ${
                      selectedThemeId === t.id ?
                      "bg-foreground text-background" :
                      "text-muted-foreground hover:bg-muted hover:text-foreground"}`
                      }>
                      
                        {t.name}
                      </button>
                    )}
                  </div>
                </div>

                {/* Grade filter */}
                <div>
                  <label className="font-display font-semibold uppercase tracking-widest text-foreground text-lg">
                    Condition
                  </label>
                  <div className="mt-2 flex flex-col gap-1">
                    {gradeOptions.map((g) =>
                    <button
                      key={g.label}
                      onClick={() => setSelectedGrade(g.value)}
                      className={`rounded px-2 py-1.5 text-left font-body text-sm transition-colors ${
                      selectedGrade === g.value ?
                      "bg-foreground text-background" :
                      "text-muted-foreground hover:bg-muted hover:text-foreground"}`
                      }>
                      
                        {g.label}
                      </button>
                    )}
                  </div>
                </div>

                {/* Retired toggle */}
                <div>
                  <label className="font-display text-xs font-semibold uppercase tracking-widest text-foreground">
                    Status
                  </label>
                  <div className="mt-2 flex gap-1">
                    {([
                    { value: null, label: "All" },
                    { value: true, label: "Retired" },
                    { value: false, label: "Current" }] as
                    const).map((opt) =>
                    <button
                      key={String(opt.value)}
                      onClick={() => setRetiredFilter(opt.value)}
                      className={`rounded px-3 py-1.5 font-body text-xs transition-colors ${
                      retiredFilter === opt.value ?
                      "bg-foreground text-background" :
                      "text-muted-foreground hover:bg-muted"}`
                      }>
                      
                        {opt.label}
                      </button>
                    )}
                  </div>
                </div>

                {/* Release Year slider */}
                {yearMin !== yearMax &&
                <div>
                    <label className="font-display text-xs font-semibold uppercase tracking-widest text-foreground">
                      Release Year
                    </label>
                    <div className="mt-3 px-1">
                      <Slider
                      min={yearMin}
                      max={yearMax}
                      step={1}
                      value={yearRange ?? [yearMin, yearMax]}
                      onValueChange={(v) => setYearRange([v[0], v[1]])}
                      className="w-full" />
                    
                      <div className="mt-2 flex justify-between font-body text-xs text-muted-foreground">
                        <span>{yearRange ? yearRange[0] : yearMin}</span>
                        <span>{yearRange ? yearRange[1] : yearMax}</span>
                      </div>
                    </div>
                    {yearRange &&
                  <button
                    onClick={() => setYearRange(null)}
                    className="mt-1 font-body text-xs text-muted-foreground hover:text-foreground">
                    
                        Reset
                      </button>
                  }
                  </div>
                }
              </div>
            </aside>

            {/* Product grid */}
            <div className="flex-1">
              {isLoading ?
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) =>
                <div key={i} className="border border-border">
                      <Skeleton className="aspect-square w-full rounded-none" />
                      <div className="p-3 space-y-2">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-5 w-16" />
                      </div>
                    </div>
                )}
                </div> :
              filteredProducts && filteredProducts.length > 0 ?
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredProducts.map((set) =>
                <Link
                  key={set.product_id}
                  to={`/sets/${set.mpn}`}
                  className="group relative flex flex-col overflow-hidden border border-border bg-card transition-all hover:shadow-md">
                  
                      <div className="aspect-square bg-white">
                        {set.img_url ?
                    <img
                      src={set.img_url}
                      alt={set.name}
                      className="h-full w-full object-contain p-4" /> :


                    <div className="flex h-full items-center justify-center p-6">
                            <span className="font-display text-3xl font-bold text-muted-foreground/20">
                              {set.mpn.split("-")[0]}
                            </span>
                          </div>
                    }
                      </div>

                      <div className="absolute left-2 top-2 flex gap-1">
                        {set.retired_flag &&
                    <span className="bg-primary px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wider text-primary-foreground">
                            Retired
                          </span>
                    }
                        {set.best_grade &&
                    <span className="bg-foreground px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wider text-background">
                            {gradeLabels[set.best_grade] ?? `Grade ${set.best_grade}`}
                          </span>
                    }
                      </div>

                      <div className="flex flex-1 flex-col p-3">
                        <h3 className="font-display font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2 text-lg">
                          {set.name}
                        </h3>
                        <p className="mt-0.5 font-body text-muted-foreground text-base">
                          {set.theme_name ?? "Uncategorised"} · {set.mpn}
                        </p>
                        <div className="mt-auto flex items-baseline justify-between pt-2">
                          <span className="font-display font-bold text-foreground text-lg">
                            {set.min_price != null ? `£${Number(set.min_price).toFixed(2)}` : "—"}
                          </span>
                          <span className="font-body text-muted-foreground text-sm">
                            {set.total_stock} in stock
                          </span>
                        </div>
                      </div>
                    </Link>
                )}
                </div> :

              <div className="flex flex-col items-center justify-center py-20 text-center">
                  <p className="font-display text-lg font-semibold text-foreground">No sets found</p>
                  <p className="mt-1 font-body text-sm text-muted-foreground">
                    Try adjusting your filters or search term.
                  </p>
                </div>
              }
            </div>
          </div>
        </div>
      </div>
    </StorefrontLayout>);

}