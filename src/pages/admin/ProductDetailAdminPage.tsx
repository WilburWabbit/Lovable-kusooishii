import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/admin/SortableTableHead";
import {
  ArrowLeft, Package, PoundSterling, ShoppingBag, TrendingUp, Save, CheckCircle2, Circle, Sparkles, Loader2,
} from "lucide-react";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface ChannelListing {
  id: string;
  sku_id: string;
  channel: string;
  external_sku: string;
  offer_status: string | null;
  listed_price: number | null;
  listing_title: string | null;
  listing_description: string | null;
  synced_at: string;
}

interface ProductSku {
  id: string;
  sku_code: string;
  condition_grade: string;
  price: number | null;
  active_flag: boolean;
  stock_available: number;
  carrying_value: number;
  channel_listings: ChannelListing[];
}

interface ProductDetail {
  id: string;
  mpn: string;
  name: string | null;
  theme_name: string | null;
  subtheme_name: string | null;
  piece_count: number | null;
  release_year: number | null;
  retired_flag: boolean;
  img_url: string | null;
  product_hook: string | null;
  description: string | null;
  highlights: string | null;
  call_to_action: string | null;
  seo_title: string | null;
  seo_description: string | null;
  age_range: string | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  stock_available: number;
  carrying_value: number;
  units_sold: number;
  revenue: number;
  skus: ProductSku[];
  channel_listings: ChannelListing[];
}

const CHANNELS = ["ebay", "bricklink", "brickowl", "web"] as const;
const CHANNEL_LABELS: Record<string, string> = {
  ebay: "eBay", bricklink: "BrickLink", brickowl: "BrickOwl", web: "Web",
};
const GRADE_LABELS: Record<string, string> = {
  "1": "Sealed", "2": "Like New", "3": "Good", "4": "Fair", "5": "Poor",
};

function fmt(v: number | null | undefined) {
  if (v == null) return "—";
  return `£${v.toFixed(2)}`;
}

/* ------------------------------------------------------------------ */
/* Content fields config                                               */
/* ------------------------------------------------------------------ */

const CONTENT_FIELDS: { key: string; label: string; type: "input" | "textarea"; maxLen?: number; hint?: string }[] = [
  { key: "product_hook", label: "Product Hook", type: "input", maxLen: 160 },
  { key: "description", label: "Description", type: "textarea" },
  { key: "highlights", label: "Highlights", type: "textarea", hint: "One per line" },
  { key: "call_to_action", label: "Call to Action", type: "input", maxLen: 80 },
  { key: "seo_title", label: "SEO Title", type: "input", maxLen: 60 },
  { key: "seo_description", label: "SEO Description", type: "textarea", maxLen: 160 },
];

/* ------------------------------------------------------------------ */
/* Page Component                                                      */
/* ------------------------------------------------------------------ */

export default function ProductDetailAdminPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: product, isLoading } = useQuery({
    queryKey: ["admin-product", id],
    queryFn: async () => {
      const data = await invokeWithAuth<ProductDetail>("admin-data", { action: "get-product", product_id: id });
      return data;
    },
    enabled: !!user && !!id,
  });

  // Content form state
  const [contentForm, setContentForm] = useState<Record<string, string>>({});
  const [contentDirty, setContentDirty] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Channel override state: { [listing_id]: { listing_title, listing_description } }
  const [channelForms, setChannelForms] = useState<Record<string, { listing_title: string; listing_description: string }>>({});
  const [channelDirty, setChannelDirty] = useState<Record<string, boolean>>({});
  const [savingChannel, setSavingChannel] = useState<string | null>(null);

  // Initialize form when product loads
  useEffect(() => {
    if (!product) return;
    const initial: Record<string, string> = {};
    for (const f of CONTENT_FIELDS) {
      initial[f.key] = (product as any)[f.key] ?? "";
    }
    setContentForm(initial);
    setContentDirty(false);

    // Channel forms
    const cf: Record<string, { listing_title: string; listing_description: string }> = {};
    for (const cl of product.channel_listings) {
      cf[cl.id] = {
        listing_title: cl.listing_title ?? "",
        listing_description: cl.listing_description ?? "",
      };
    }
    setChannelForms(cf);
    setChannelDirty({});
  }, [product]);

  const handleContentChange = useCallback((key: string, value: string) => {
    setContentForm((prev) => ({ ...prev, [key]: value }));
    setContentDirty(true);
  }, []);

  const handleSaveContent = async () => {
    if (!product) return;
    setSavingContent(true);
    try {
      const fields: Record<string, string | null> = {};
      for (const f of CONTENT_FIELDS) {
        fields[f.key] = contentForm[f.key]?.trim() || null;
      }
      await invokeWithAuth("admin-data", { action: "update-product", product_id: product.id, ...fields });
      toast.success("Content saved");
      setContentDirty(false);
      queryClient.invalidateQueries({ queryKey: ["admin-product", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
    } catch (err: any) {
      toast.error(err.message ?? "Save failed");
    } finally {
      setSavingContent(false);
    }
  };

  const handleChannelChange = useCallback((listingId: string, field: "listing_title" | "listing_description", value: string) => {
    setChannelForms((prev) => ({
      ...prev,
      [listingId]: { ...prev[listingId], [field]: value },
    }));
    setChannelDirty((prev) => ({ ...prev, [listingId]: true }));
  }, []);

  const handleSaveChannel = async (listingId: string) => {
    setSavingChannel(listingId);
    try {
      const form = channelForms[listingId];
      await invokeWithAuth("admin-data", {
        action: "update-channel-listing",
        listing_id: listingId,
        listing_title: form.listing_title?.trim() || null,
        listing_description: form.listing_description?.trim() || null,
      });
      toast.success("Channel listing saved");
      setChannelDirty((prev) => ({ ...prev, [listingId]: false }));
      queryClient.invalidateQueries({ queryKey: ["admin-product", id] });
    } catch (err: any) {
      toast.error(err.message ?? "Save failed");
    } finally {
      setSavingChannel(null);
    }
  };

  if (isLoading) {
    return (
      <BackOfficeLayout title="Product">
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading…</div>
      </BackOfficeLayout>
    );
  }

  if (!product) {
    return (
      <BackOfficeLayout title="Product">
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Product not found.</div>
      </BackOfficeLayout>
    );
  }

  // Deduplicate channel listings for the override section
  const uniqueListings = product.channel_listings.reduce<ChannelListing[]>((acc, cl) => {
    if (!acc.find((x) => x.id === cl.id)) acc.push(cl);
    return acc;
  }, []);

  return (
    <BackOfficeLayout title={product.name ?? product.mpn}>
      <div className="space-y-6 animate-fade-in">
        {/* Back button + Header */}
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" className="mt-1" onClick={() => navigate("/admin/products")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h2 className="font-display text-lg font-bold text-foreground">{product.name ?? "Unnamed"}</h2>
              <span className="font-mono text-sm text-muted-foreground">{product.mpn}</span>
              {product.retired_flag && (
                <Badge variant="outline" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 text-[10px]">Retired</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {[product.theme_name, product.subtheme_name].filter(Boolean).join(" › ")}
              {product.release_year ? ` • ${product.release_year}` : ""}
              {product.piece_count ? ` • ${product.piece_count} pcs` : ""}
              {product.age_range ? ` • ${product.age_range}` : ""}
            </p>
          </div>
          {product.img_url && (
            <img src={product.img_url} alt={product.name ?? ""} className="h-16 w-16 rounded-md object-cover border border-border" />
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Stock</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{product.stock_available}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Value</CardTitle>
              <PoundSterling className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{fmt(product.carrying_value)}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Units Sold</CardTitle>
              <ShoppingBag className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{product.units_sold}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Revenue</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold font-display">{fmt(product.revenue)}</p></CardContent>
          </Card>
        </div>

        {/* Dimensions & Specs */}
        {(product.length_cm || product.width_cm || product.height_cm || product.weight_kg) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Dimensions & Weight</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {product.length_cm != null && (
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Length</p>
                    <p className="text-sm font-bold font-display">{product.length_cm} cm</p>
                  </div>
                )}
                {product.width_cm != null && (
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Width</p>
                    <p className="text-sm font-bold font-display">{product.width_cm} cm</p>
                  </div>
                )}
                {product.height_cm != null && (
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Height</p>
                    <p className="text-sm font-bold font-display">{product.height_cm} cm</p>
                  </div>
                )}
                {product.length_cm != null && product.width_cm != null && product.height_cm != null && (
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Girth</p>
                    <p className="text-sm font-bold font-display">{(2 * ((product.width_cm ?? 0) + (product.height_cm ?? 0))).toFixed(1)} cm</p>
                  </div>
                )}
                {product.weight_kg != null && (
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Weight</p>
                    <p className="text-sm font-bold font-display">{product.weight_kg} kg</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Common Content */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Product Content</CardTitle>
            <Button size="sm" disabled={!contentDirty || savingContent} onClick={handleSaveContent}>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              {savingContent ? "Saving…" : "Save"}
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {CONTENT_FIELDS.map((f) => (
              <div key={f.key} className={f.type === "textarea" && f.key === "description" ? "md:col-span-2" : ""}>
                <div className="flex items-center justify-between mb-1.5">
                  <Label htmlFor={f.key} className="text-xs">{f.label}</Label>
                  {f.maxLen && (
                    <span className={`text-[10px] font-mono ${(contentForm[f.key]?.length ?? 0) > f.maxLen ? "text-destructive" : "text-muted-foreground"}`}>
                      {contentForm[f.key]?.length ?? 0}/{f.maxLen}
                    </span>
                  )}
                </div>
                {f.type === "textarea" ? (
                  <Textarea
                    id={f.key}
                    value={contentForm[f.key] ?? ""}
                    onChange={(e) => handleContentChange(f.key, e.target.value)}
                    className="text-sm min-h-[80px]"
                    placeholder={f.hint ?? `Enter ${f.label.toLowerCase()}…`}
                  />
                ) : (
                  <Input
                    id={f.key}
                    value={contentForm[f.key] ?? ""}
                    onChange={(e) => handleContentChange(f.key, e.target.value)}
                    className="text-sm"
                    placeholder={`Enter ${f.label.toLowerCase()}…`}
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Channel Overrides */}
        {uniqueListings.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Channel Listing Overrides</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {uniqueListings.map((cl) => {
                const form = channelForms[cl.id] ?? { listing_title: "", listing_description: "" };
                const dirty = channelDirty[cl.id] ?? false;
                const maxTitle = cl.channel === "ebay" ? 80 : undefined;
                return (
                  <div key={cl.id} className="border border-border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">{CHANNEL_LABELS[cl.channel] ?? cl.channel}</span>
                        {cl.offer_status && (
                          <Badge variant="outline" className="text-[10px]">{cl.offer_status}</Badge>
                        )}
                        <span className="font-mono text-[10px] text-muted-foreground">{cl.external_sku}</span>
                      </div>
                      <Button size="sm" variant="outline" disabled={!dirty || savingChannel === cl.id} onClick={() => handleSaveChannel(cl.id)}>
                        <Save className="h-3 w-3 mr-1" />
                        {savingChannel === cl.id ? "Saving…" : "Save"}
                      </Button>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <Label className="text-xs">Listing Title Override</Label>
                        {maxTitle && (
                          <span className={`text-[10px] font-mono ${(form.listing_title?.length ?? 0) > maxTitle ? "text-destructive" : "text-muted-foreground"}`}>
                            {form.listing_title?.length ?? 0}/{maxTitle}
                          </span>
                        )}
                      </div>
                      <Input
                        value={form.listing_title}
                        onChange={(e) => handleChannelChange(cl.id, "listing_title", e.target.value)}
                        className="text-sm"
                        placeholder={product.name ?? "Use product name…"}
                      />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">Listing Description Override</Label>
                      <Textarea
                        value={form.listing_description}
                        onChange={(e) => handleChannelChange(cl.id, "listing_description", e.target.value)}
                        className="text-sm min-h-[60px]"
                        placeholder="Use product description…"
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* SKUs */}
        {product.skus.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">SKUs</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead columnKey="" label="SKU" sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" />
                    <SortableTableHead columnKey="" label="Grade" sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" />
                    <SortableTableHead columnKey="" label="Price" sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" align="right" />
                    <SortableTableHead columnKey="" label="Stock" sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" align="right" />
                    <SortableTableHead columnKey="" label="Value" sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" align="right" />
                    {CHANNELS.map((ch) => (
                      <SortableTableHead key={ch} columnKey="" label={CHANNEL_LABELS[ch]} sortKey="" sortDir="asc" onToggleSort={() => {}} sortable={false} className="text-xs" align="center" />
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {product.skus.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.sku_code}</TableCell>
                      <TableCell className="text-xs">{GRADE_LABELS[s.condition_grade] ?? s.condition_grade}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmt(s.price)}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{s.stock_available}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmt(s.carrying_value)}</TableCell>
                      {CHANNELS.map((ch) => {
                        const cl = s.channel_listings.find((l) => l.channel === ch);
                        return (
                          <TableCell key={ch} className="text-center">
                            {cl ? (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                                {cl.offer_status ?? "—"}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </BackOfficeLayout>
  );
}
