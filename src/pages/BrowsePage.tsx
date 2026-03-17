import { StorefrontLayout } from "@/components/StorefrontLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Link, useSearchParams } from "react-router-dom";
import { Search, SlidersHorizontal } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo, useEffect } from "react";
import { ThemesGrid } from "@/components/ThemesGrid";
import { GRADE_OPTIONS, GRADE_LABELS } from "@/lib/grades";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { usePagination } from "@/hooks/usePagination";
import { PaginationControls } from "@/components/PaginationControls";

export default function BrowsePage() {
  const [searchParams] = useSearchParams();
  const viewMode = searchParams.get("view");
  const themeFromUrl = searchParams.get("theme");
  const isNewMode = searchParams.get("new") === "true";
  const isDealsMode = searchParams.get("deals") === "true";

  const searchFromUrl = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(searchFromUrl);
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(themeFromUrl);
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null);
  const [retiredFilter, setRetiredFilter] = useState<boolean | null>(null);
  const [yearRange, setYearRange] = useState<[number, number] | null>(null);

  // Sync theme filter from URL
  useEffect(() => {
    setSelectedThemeId(themeFromUrl);
  }, [themeFromUrl]);

  // Sync search from URL query param
  useEffect(() => {
    if (searchFromUrl) setSearch(searchFromUrl);
  }, [searchFromUrl]);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
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
        filter_retired: null,
      });
      if (error) throw error;
      const rows = data as any[];
      const themeMap = new Map<string, { id: string; name: string }>();
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
        yearMax: maxYear === -Infinity ? null : maxYear,
      };
    },
    enabled: viewMode !== "themes",
  });

  const themes = filterMeta?.themes;
  const yearMin = filterMeta?.yearMin ?? 2000;
  const yearMax = filterMeta?.yearMax ?? new Date().getFullYear();

  // Fetch browse data
  const { data: products, isLoading } = useQuery({
    queryKey: ["browse_catalog", debouncedSearch, selectedThemeId, selectedGrade, retiredFilter, isDealsMode],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("browse_catalog", {
        search_term: debouncedSearch || null,
        filter_theme_id: selectedThemeId || null,
        filter_grade: selectedGrade || null,
        filter_retired: retiredFilter,
      });
      if (error) throw error;
      return data as {
        product_id: string; mpn: string; name: string; theme_name: string | null;
        theme_id: string | null; retired_flag: boolean; release_year: number | null;
        piece_count: number | null; min_price: number | null; best_grade: string | null;
        total_stock: number; img_url: string | null;
      }[];
    },
    enabled: viewMode !== "themes",
  });

  // Fetch product created_at dates for "Just Landed" mode
  const { data: productDates } = useQuery({
    queryKey: ["product_dates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product")
        .select("id, created_at")
        .eq("status", "active");
      if (error) throw error;
      const map = new Map<string, string>();
      for (const row of data ?? []) map.set(row.id, row.created_at);
      return map;
    },
    enabled: isNewMode,
  });

  const filteredProducts = useMemo(() => {
    if (!products) return products;
    let result = products;

    // Deals: only items where best grade is worse than Mint (grade > 1)
    if (isDealsMode) {
      result = result.filter(
        (p) => p.best_grade != null && parseInt(p.best_grade, 10) > 1
      );
    }

    // Just Landed: items added within last month, minimum 12
    if (isNewMode && productDates) {
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      const cutoff = oneMonthAgo.toISOString();

      // Sort all by created_at descending
      const withDates = result
        .map((p) => ({ ...p, _createdAt: productDates.get(p.product_id) ?? "" }))
        .sort((a, b) => b._createdAt.localeCompare(a._createdAt));

      const recent = withDates.filter((p) => p._createdAt >= cutoff);
      if (recent.length >= 12) {
        result = recent;
      } else {
        // Pad with next most recent items up to 12
        result = withDates.slice(0, Math.max(12, recent.length));
      }
    }

    if (yearRange) {
      result = result.filter(
        (p) => p.release_year != null && p.release_year >= yearRange[0] && p.release_year <= yearRange[1]
      );
    }
    return result;
  }, [products, yearRange, isNewMode, isDealsMode, productDates]);

  const {
    paginatedItems: paginatedProducts,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalPages,
    totalItems,
    pageSizeOptions,
  } = usePagination(filteredProducts);

  if (viewMode === "themes") {
    return (
      <StorefrontLayout>
        <ThemesGrid />
      </StorefrontLayout>
    );
  }

  const pageTitle = isNewMode ? "Just Landed" : isDealsMode ? "Deals" : "Browse Sets";
  const pageSubtitle = isNewMode
    ? "Newest arrivals, sorted by release year"
    : isDealsMode
    ? "Retired sets — collectible bargains"
    : `${filteredProducts?.length ?? 0} sets available · condition graded · version tracked`;

  const filterContent = (
    <div className="space-y-6">
      {/* Search */}
      <div>
        <label className="font-display text-xs font-semibold uppercase tracking-widest text-foreground">
          Search
        </label>
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Set name or MPN..."
            className="pl-8 font-body text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Theme filter */}
      <div>
        <label className="font-display text-xs font-semibold uppercase tracking-widest text-foreground">
          Theme
        </label>
        <div className="mt-2 flex flex-col gap-1">
          <button
            onClick={() => setSelectedThemeId(null)}
            className={`rounded px-2 py-1.5 text-left font-body text-sm transition-colors ${
              selectedThemeId === null
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            All
          </button>
          {themes?.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedThemeId(t.id)}
              className={`rounded px-2 py-1.5 text-left font-body text-sm transition-colors ${
                selectedThemeId === t.id
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {/* Grade filter */}
      <div>
        <label className="font-display text-xs font-semibold uppercase tracking-widest text-foreground">
          Condition
        </label>
        <div className="mt-2 flex flex-col gap-1">
          {GRADE_OPTIONS.map((g) => (
            <button
              key={g.label}
              onClick={() => setSelectedGrade(g.value)}
              className={`rounded px-2 py-1.5 text-left font-body text-sm transition-colors ${
                selectedGrade === g.value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {g.label}
            </button>
          ))}
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
            { value: false, label: "Current" },
          ] as const).map((opt) => (
            <button
              key={String(opt.value)}
              onClick={() => setRetiredFilter(opt.value)}
              className={`rounded px-3 py-1.5 font-body text-xs transition-colors ${
                retiredFilter === opt.value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Release Year slider */}
      {yearMin !== yearMax && (
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
              className="w-full"
            />
            <div className="mt-2 flex justify-between font-body text-xs text-muted-foreground">
              <span>{yearRange ? yearRange[0] : yearMin}</span>
              <span>{yearRange ? yearRange[1] : yearMax}</span>
            </div>
          </div>
          {yearRange && (
            <button
              onClick={() => setYearRange(null)}
              className="mt-1 font-body text-xs text-muted-foreground hover:text-foreground"
            >
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <StorefrontLayout>
      <div className="bg-background">
        {/* Header */}
        <div className="border-b border-border bg-kuso-paper py-8">
          <div className="container">
            <h1 className="font-display text-2xl font-bold text-foreground">{pageTitle}</h1>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              {isLoading ? "Loading…" : pageSubtitle}
            </p>
          </div>
        </div>

        <div className="container py-8">
          <div className="flex flex-col gap-8 lg:flex-row">
            {/* Filters sidebar */}
            <aside className="w-full shrink-0 lg:w-56">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm" className="font-display text-xs lg:hidden">
                    <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" /> Filters
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="overflow-y-auto">
                  <SheetHeader>
                    <SheetTitle className="font-display">Filters</SheetTitle>
                  </SheetHeader>
                  <div className="mt-6">
                    {filterContent}
                  </div>
                </SheetContent>
              </Sheet>

              <div className="hidden lg:block">
                {filterContent}
              </div>
            </aside>

            {/* Product grid */}
            <div className="flex-1">
              {isLoading ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="border border-border">
                      <Skeleton className="aspect-square w-full rounded-none" />
                      <div className="p-3 space-y-2">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-5 w-16" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : paginatedProducts && paginatedProducts.length > 0 ? (
                <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {paginatedProducts.map((set) => (
                    <Link
                      key={set.product_id}
                      to={`/sets/${set.mpn}`}
                      className="group relative flex flex-col overflow-hidden border border-border bg-card transition-all hover:shadow-md"
                    >
                      <div className="aspect-square bg-white">
                        {set.img_url ? (
                          <img
                            src={set.img_url}
                            alt={set.name}
                            className="h-full w-full object-contain p-4"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center p-6">
                            <span className="font-display text-3xl font-bold text-muted-foreground/20">
                              {set.mpn.split("-")[0]}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Badges — grade first, then retired */}
                      <div className="absolute left-2 top-2 flex gap-1">
                        {set.best_grade && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="bg-foreground px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wider text-background">
                                {GRADE_LABELS[set.best_grade] ?? `Grade ${set.best_grade}`}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">
                              Condition Grade: {set.best_grade} — {GRADE_LABELS[set.best_grade] ?? `Grade ${set.best_grade}`}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {set.retired_flag && (
                          <span className="bg-primary px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wider text-primary-foreground">
                            Retired
                          </span>
                        )}
                      </div>

                      <div className="flex flex-1 flex-col p-3">
                        <h3 className="font-display text-sm font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2">
                          {set.name}
                        </h3>
                        <p className="mt-0.5 font-body text-[11px] text-muted-foreground">
                          {set.theme_name ?? "Uncategorised"} · {set.mpn}
                        </p>
                        <div className="mt-auto flex items-baseline justify-between pt-2">
                          <span className="font-display text-base font-bold text-foreground">
                            {set.min_price != null ? `£${Number(set.min_price).toFixed(2)}` : "—"}
                          </span>
                          <span className="font-body text-[11px] text-muted-foreground">
                            {set.total_stock} in stock
                          </span>
                        </div>
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
                  itemLabel="sets"
                />
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <p className="font-display text-lg font-semibold text-foreground">No sets found</p>
                  <p className="mt-1 font-body text-sm text-muted-foreground">
                    Try adjusting your filters or search term.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </StorefrontLayout>
  );
}
