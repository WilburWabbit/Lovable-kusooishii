import { GRADE_DETAILS } from "@/lib/grades";
import type { Product } from "@/lib/store";

export const MAX_CART_PREFILL_QTY = 10;
export const DEFAULT_SITE_URL = "https://www.kusooishii.com";

export interface CartPrefillRequest {
  skuCode: string;
  quantity: number;
}

export interface CartPrefillProductResult {
  ok: true;
  product: Product;
}

export interface CartPrefillErrorResult {
  ok: false;
  reason: "missing_sku" | "unavailable" | "missing_live_listing" | "missing_price" | "out_of_stock";
}

export type CartPrefillResult = CartPrefillProductResult | CartPrefillErrorResult;

export interface CartPrefillSkuRow {
  id?: string | null;
  sku_code?: string | null;
  name?: string | null;
  condition_grade?: number | string | null;
  active_flag?: boolean | null;
  saleable_flag?: boolean | null;
  product?: Record<string, unknown> | Record<string, unknown>[] | null;
}

export interface CartPrefillListingRow {
  listed_price?: number | string | null;
  offer_status?: string | null;
  v2_status?: string | null;
}

export interface CartPrefillStockRow {
  status?: string | null;
  v2_status?: string | null;
}

interface ApplyCartPrefillInput {
  product: Product;
  quantity: number;
  cart: Array<{ id: string; quantity: number }>;
  addToCart: (product: Product) => void;
  updateQuantity: (id: string, quantity: number) => void;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSiteUrl(value: unknown): string {
  const text = cleanText(value);
  if (!text) return DEFAULT_SITE_URL;
  try {
    const parsed = new URL(text);
    if (parsed.hostname.endsWith(".supabase.co") || !parsed.hostname.includes(".")) {
      return DEFAULT_SITE_URL;
    }
    return `${parsed.protocol}//${parsed.host}`.replace(/\/$/, "");
  } catch {
    return DEFAULT_SITE_URL;
  }
}

export function buildCheckoutLinkTemplate(siteUrl: unknown, skuCode: unknown): string {
  const sku = cleanText(skuCode);
  return sku ? `${normalizeSiteUrl(siteUrl)}/cart?sku=${encodeURIComponent(sku)}` : "";
}

export function parseCartPrefillParams(params: URLSearchParams): CartPrefillRequest | null {
  const skuCode = cleanText(params.get("sku"));
  if (!skuCode) return null;

  const requested = Number(params.get("qty") ?? 1);
  const quantity = Number.isInteger(requested) && requested > 0
    ? Math.min(requested, MAX_CART_PREFILL_QTY)
    : 1;

  return { skuCode, quantity };
}

export function clampCartPrefillQuantity(quantity: number, stock: number): number {
  const requested = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
  const available = Number.isInteger(stock) && stock > 0 ? stock : 0;
  return Math.max(0, Math.min(requested, MAX_CART_PREFILL_QTY, available));
}

function firstProduct(productRelation: CartPrefillSkuRow["product"]): Record<string, unknown> | null {
  if (Array.isArray(productRelation)) return productRelation[0] ?? null;
  return productRelation ?? null;
}

function isLiveWebListing(listing: CartPrefillListingRow): boolean {
  const offerStatus = String(listing.offer_status ?? "").toLowerCase();
  return listing.v2_status === "live" || ["live", "published"].includes(offerStatus);
}

function isSaleableStock(row: CartPrefillStockRow): boolean {
  return row.status === "available" || ["graded", "listed", "restocked"].includes(String(row.v2_status ?? ""));
}

export function cartPrefillProductFromRows(
  sku: CartPrefillSkuRow | null | undefined,
  webListings: CartPrefillListingRow[],
  stockRows: CartPrefillStockRow[],
): CartPrefillResult {
  if (!sku?.id || !sku.sku_code) return { ok: false, reason: "missing_sku" };
  if (!sku.active_flag || !sku.saleable_flag) return { ok: false, reason: "unavailable" };

  const liveListing = webListings.find(isLiveWebListing);
  if (!liveListing) return { ok: false, reason: "missing_live_listing" };

  const price = Number(liveListing.listed_price ?? 0);
  if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: "missing_price" };

  const stock = stockRows.filter(isSaleableStock).length;
  if (stock <= 0) return { ok: false, reason: "out_of_stock" };

  const product = firstProduct(sku.product);
  if (!product) return { ok: false, reason: "unavailable" };
  const theme = product.theme as { name?: string | null } | null;
  const grade = Number(sku.condition_grade ?? 3);
  const mpn = cleanText(product.mpn) || sku.sku_code.split(".")[0] || sku.sku_code;
  const productName = cleanText(product.name) || cleanText(sku.name) || `LEGO ${mpn}`;

  return {
    ok: true,
    product: {
      id: sku.id,
      name: productName,
      setNumber: mpn,
      price,
      rrp: 0,
      image: cleanText(product.img_url),
      images: cleanText(product.img_url) ? [cleanText(product.img_url)] : [],
      theme: cleanText(theme?.name) || cleanText(product.product_type) || "Uncategorised",
      themeId: null,
      pieceCount: Number(product.piece_count ?? 0) || 0,
      condition: GRADE_DETAILS[grade]?.label ?? `Grade ${grade}`,
      conditionGrade: grade,
      ageRange: cleanText(product.age_range),
      hook: cleanText(product.product_hook),
      description: cleanText(product.description),
      highlights: [],
      stock,
      retired: Boolean(product.retired_flag),
      yearReleased: Number(product.release_year ?? 0) || null,
      subtheme: cleanText(product.subtheme_name) || undefined,
      weightKg: Number(product.weight_kg ?? 0) || undefined,
    },
  };
}

export function applyCartPrefill({ product, quantity, cart, addToCart, updateQuantity }: ApplyCartPrefillInput): number {
  const finalQuantity = clampCartPrefillQuantity(quantity, product.stock);
  if (finalQuantity <= 0) return 0;

  const existing = cart.find((item) => item.id === product.id);
  if (!existing) addToCart(product);
  updateQuantity(product.id, finalQuantity);
  return finalQuantity;
}

export async function loadCartPrefillProduct(
  supabaseClient: any,
  skuCode: string,
): Promise<CartPrefillResult> {
  const { data: sku, error: skuError } = await supabaseClient
    .from("sku")
    .select("id, sku_code, name, condition_grade, active_flag, saleable_flag, product:product_id(id, mpn, name, description, img_url, product_hook, piece_count, release_year, retired_flag, product_type, age_range, subtheme_name, weight_kg, theme:theme_id(name))")
    .eq("sku_code", skuCode)
    .maybeSingle();
  if (skuError) throw skuError;

  if (!sku?.id) return { ok: false, reason: "missing_sku" };

  const [{ data: webListings, error: listingError }, { data: stockRows, error: stockError }] = await Promise.all([
    supabaseClient
      .from("channel_listing")
      .select("listed_price, offer_status, v2_status")
      .eq("sku_id", sku.id)
      .eq("channel", "web")
      .order("updated_at", { ascending: false }),
    supabaseClient
      .from("stock_unit")
      .select("status, v2_status")
      .eq("sku_id", sku.id),
  ]);
  if (listingError) throw listingError;
  if (stockError) throw stockError;

  return cartPrefillProductFromRows(
    sku,
    (webListings ?? []) as CartPrefillListingRow[],
    (stockRows ?? []) as CartPrefillStockRow[],
  );
}
