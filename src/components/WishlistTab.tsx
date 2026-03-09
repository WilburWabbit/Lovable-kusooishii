import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Heart, Search, X, Loader2, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";

interface WishlistTabProps {
  userId: string;
}

interface CatalogResult {
  product_id: string;
  mpn: string;
  name: string;
  theme_name: string | null;
  subtheme_name: string | null;
  release_year: number | null;
  img_url: string | null;
}

interface FilterOptions {
  themes: string[];
  subthemes: string[];
  years: number[];
}

interface WishlistItemRow {
  id: string;
  catalog_product_id: string;
  notify_on_stock: boolean;
  preferred_grade: string | null;
  max_price: number | null;
  notes: string | null;
  catalog_product: {
    mpn: string;
    name: string;
    retired_flag: boolean;
    img_url: string | null;
    subtheme_name: string | null;
    release_year: number | null;
    theme_id: string | null;
  } | null;
}

type SortKey = "mpn" | "name" | "theme_name" | "subtheme_name" | "release_year";
type SortDir = "asc" | "desc";

const ALL_VALUE = "__all__";

export default function WishlistTab({ userId }: WishlistTabProps) {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedTheme, setSelectedTheme] = useState("");
  const [selectedSubtheme, setSelectedSubtheme] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }, [sortKey]);


  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Fetch user's wishlist ID
  const { data: wishlistId } = useQuery({
    queryKey: ["my_wishlist_id", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("wishlist")
        .select("id")
        .eq("user_id", userId)
        .limit(1);
      return data?.[0]?.id ?? null;
    },
  });

  // Fetch wishlist items
  const { data: wishlistItems = [] } = useQuery<WishlistItemRow[]>({
    queryKey: ["my_wishlist", wishlistId],
    enabled: !!wishlistId,
    queryFn: async () => {
      const { data } = await supabase
        .from("wishlist_item")
        .select("id, catalog_product_id, notify_on_stock, preferred_grade, max_price, notes, catalog_product:catalog_product_id(mpn, name, retired_flag, img_url, subtheme_name, release_year, theme:theme_id(name))")
        .eq("wishlist_id", wishlistId!);
      return (data as any) || [];
    },
  });

  const wishlistProductIds = useMemo(
    () => new Set(wishlistItems.map((i) => i.catalog_product_id)),
    [wishlistItems]
  );

  const hasActiveFilters = debouncedSearch || selectedTheme || selectedSubtheme || selectedYear;

  // Fetch filter options (cascading)
  const { data: filterOptions } = useQuery<FilterOptions>({
    queryKey: ["wishlist_filter_options", debouncedSearch, selectedTheme, selectedSubtheme, selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("catalog_filter_options", {
        search_term: debouncedSearch || null,
        filter_theme: selectedTheme || null,
        filter_subtheme: selectedSubtheme || null,
        filter_year: selectedYear ? parseInt(selectedYear) : null,
      });
      if (error) throw error;
      const row = (data as any)?.[0] || { themes: [], subthemes: [], years: [] };
      return {
        themes: (row.themes || []).filter(Boolean),
        subthemes: (row.subthemes || []).filter(Boolean),
        years: (row.years || []).filter(Boolean),
      };
    },
  });

  // Fetch search results
  const { data: searchResults = [], isFetching: searching } = useQuery<CatalogResult[]>({
    queryKey: ["wishlist_search", debouncedSearch, selectedTheme, selectedSubtheme, selectedYear],
    enabled: !!hasActiveFilters,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_catalog_for_wishlist", {
        search_term: debouncedSearch || null,
        filter_theme: selectedTheme || null,
        filter_subtheme: selectedSubtheme || null,
        filter_year: selectedYear ? parseInt(selectedYear) : null,
      });
      if (error) throw error;
      return (data as CatalogResult[]) || [];
    },
  });

  const sortedResults = useMemo(() => {
    if (!sortKey) return searchResults;
    return [...searchResults].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [searchResults, sortKey, sortDir]);

  // Add to wishlist
  const addMutation = useMutation({
    mutationFn: async (catalogProductId: string) => {
      if (!wishlistId) throw new Error("No wishlist");
      const { error } = await supabase.from("wishlist_item").insert({
        wishlist_id: wishlistId,
        catalog_product_id: catalogProductId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my_wishlist"] });
      toast.success("Added to wishlist");
    },
    onError: () => toast.error("Failed to add"),
  });

  // Remove from wishlist
  const removeMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.from("wishlist_item").delete().eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my_wishlist"] });
      toast.success("Removed from wishlist");
    },
    onError: () => toast.error("Failed to remove"),
  });

  const clearFilters = () => {
    setSearchInput("");
    setDebouncedSearch("");
    setSelectedTheme("");
    setSelectedSubtheme("");
    setSelectedYear("");
  };

  return (
    <div className="space-y-6">
      {/* Find a Set */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-display text-sm font-semibold">Find a Set</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search + Filters Row */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or set #..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9 font-body text-sm"
              />
            </div>

            <Select
              value={selectedTheme || ALL_VALUE}
              onValueChange={(v) => {
                setSelectedTheme(v === ALL_VALUE ? "" : v);
                setSelectedSubtheme("");
              }}
            >
              <SelectTrigger className="font-body text-sm">
                <SelectValue placeholder="Theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All Themes</SelectItem>
                {filterOptions?.themes.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={selectedSubtheme || ALL_VALUE}
              onValueChange={(v) => setSelectedSubtheme(v === ALL_VALUE ? "" : v)}
            >
              <SelectTrigger className="font-body text-sm">
                <SelectValue placeholder="Subtheme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All Subthemes</SelectItem>
                {filterOptions?.subthemes.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={selectedYear || ALL_VALUE}
              onValueChange={(v) => setSelectedYear(v === ALL_VALUE ? "" : v)}
            >
              <SelectTrigger className="font-body text-sm">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All Years</SelectItem>
                {filterOptions?.years.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {hasActiveFilters && (
            <div className="flex items-center justify-between">
              <p className="font-body text-xs text-muted-foreground">
                {searching ? "Searching..." : `${searchResults.length} results (max 100)`}
              </p>
              <Button variant="ghost" size="sm" onClick={clearFilters} className="font-display text-xs">
                <X className="mr-1 h-3 w-3" /> Clear filters
              </Button>
            </div>
          )}

          {!hasActiveFilters && (
            <p className="font-body text-sm text-muted-foreground">
              Use the search or filters above to find sets to add to your wishlist.
            </p>
          )}

          {/* Results table */}
          {hasActiveFilters && sortedResults.length > 0 && (
            <div className="max-h-96 overflow-auto border border-border">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="px-3 py-2" />
                    {([
                      ["mpn", "Set #", ""],
                      ["name", "Name", ""],
                      ["theme_name", "Theme", "hidden sm:table-cell"],
                      ["subtheme_name", "Subtheme", "hidden md:table-cell"],
                      ["release_year", "Year", "hidden sm:table-cell"],
                    ] as [SortKey, string, string][]).map(([key, label, hide]) => {
                      const active = sortKey === key;
                      const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                      return (
                        <th
                          key={key}
                          className={`${hide} cursor-pointer select-none px-3 py-2 font-display text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground`}
                          onClick={() => toggleSort(key)}
                        >
                          <span className="inline-flex items-center gap-1">
                            {label}
                            <Icon className={`h-3 w-3 ${active ? "text-foreground" : "opacity-40"}`} />
                          </span>
                        </th>
                      );
                    })}
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {sortedResults.map((r) => {
                    const inWishlist = wishlistProductIds.has(r.product_id);
                    return (
                      <tr key={r.product_id} className="border-t border-border hover:bg-muted/50">
                        <td className="px-3 py-2">
                          {r.img_url ? (
                            <img src={r.img_url} alt={r.name} className="h-10 w-10 object-contain" loading="lazy" />
                          ) : (
                            <div className="h-10 w-10 bg-muted" />
                          )}
                        </td>
                        <td className="px-3 py-2 font-body text-xs font-medium text-foreground">{r.mpn}</td>
                        <td className="px-3 py-2 font-body text-xs text-foreground">{r.name}</td>
                        <td className="hidden px-3 py-2 font-body text-xs text-muted-foreground sm:table-cell">{r.theme_name}</td>
                        <td className="hidden px-3 py-2 font-body text-xs text-muted-foreground md:table-cell">{r.subtheme_name}</td>
                        <td className="hidden px-3 py-2 font-body text-xs text-muted-foreground sm:table-cell">{r.release_year}</td>
                        <td className="px-3 py-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={inWishlist || addMutation.isPending}
                            onClick={() => addMutation.mutate(r.product_id)}
                          >
                            <Heart className={`h-4 w-4 ${inWishlist ? "fill-primary text-primary" : "text-muted-foreground"}`} />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {hasActiveFilters && !searching && searchResults.length === 0 && (
            <p className="py-6 text-center font-body text-sm text-muted-foreground">
              No sets found matching your criteria.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Your Wishlist */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-display text-sm font-semibold">
            Your Wishlist
          </CardTitle>
          {wishlistItems.length > 0 && (
            <p className="font-body text-xs text-muted-foreground">{wishlistItems.length} sets saved</p>
          )}
        </CardHeader>
        <CardContent>
          {wishlistItems.length === 0 ? (
            <p className="font-body text-sm text-muted-foreground">
              Your wishlist is empty. Use the search above to find sets and add them.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {wishlistItems.map((item) => {
                const cp = item.catalog_product as any;
                const themeName = cp?.theme?.name;
                return (
                  <div key={item.id} className="flex items-center rounded-md border border-border p-3 gap-3">
                    {cp?.img_url ? (
                      <img src={cp.img_url} alt={cp.name} className="h-16 w-16 shrink-0 object-contain" loading="lazy" />
                    ) : (
                      <div className="h-16 w-16 shrink-0 bg-muted rounded" />
                    )}
                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-display text-xs font-semibold text-foreground leading-snug line-clamp-2">
                          {cp?.name}
                        </p>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          disabled={removeMutation.isPending}
                          onClick={() => removeMutation.mutate(item.id)}
                        >
                          <Heart className="h-3.5 w-3.5 fill-destructive text-destructive" />
                        </Button>
                      </div>
                      <p className="font-body text-[11px] text-muted-foreground">
                        #{cp?.mpn}
                        {themeName && ` · ${themeName}`}
                        {cp?.subtheme_name && ` · ${cp.subtheme_name}`}
                        {cp?.release_year && ` · ${cp.release_year}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
