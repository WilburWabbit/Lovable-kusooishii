export interface MetaProductSource {
  mpn?: string | null;
  name?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  description?: string | null;
  img_url?: string | null;
  primary_image_url?: string | null;
  website_image_url?: string | null;
  product_type?: string | null;
  lego_theme?: string | null;
  lego_subtheme?: string | null;
  subtheme_name?: string | null;
  piece_count?: number | string | null;
  release_year?: number | string | null;
  retired_flag?: boolean | string | null;
  ean?: string | null;
  upc?: string | null;
  isbn?: string | null;
  gmc_product_category?: string | null;
}

export interface MetaSkuSource {
  sku_code?: string | null;
  condition_grade?: number | string | null;
}

export interface MetaListingSource {
  external_sku?: string | null;
  listing_title?: string | null;
  listing_description?: string | null;
  listed_price?: number | string | null;
}

export interface MetaCatalogItemResult {
  retailerId: string;
  data: Record<string, unknown>;
  warnings: string[];
}

const DEFAULT_PUBLIC_SITE_URL = "https://www.kusooishii.com";

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanBarcode(value: unknown): string {
  return cleanText(value).replace(/[^0-9Xx]/g, "");
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3).trim()}...` : value;
}

function normalizeSiteUrl(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return DEFAULT_PUBLIC_SITE_URL;

  try {
    const parsed = new URL(raw);
    if (parsed.hostname.endsWith(".supabase.co") || !parsed.hostname.includes(".")) {
      return DEFAULT_PUBLIC_SITE_URL;
    }
    return `${parsed.protocol}//${parsed.host}`.replace(/\/$/, "");
  } catch {
    return DEFAULT_PUBLIC_SITE_URL;
  }
}

function selectBarcode(product: MetaProductSource): string | null {
  for (const value of [product.ean, product.upc, product.isbn]) {
    const barcode = cleanBarcode(value);
    if (barcode) return barcode;
  }
  return null;
}

function normalizeCategory(product: MetaProductSource): string {
  const explicit = cleanText(product.gmc_product_category);
  if (explicit) return explicit;
  const subtheme = cleanText(product.subtheme_name) || cleanText(product.lego_subtheme);
  if (subtheme) return `Toys & Games > Toys > Building Toys > LEGO > ${subtheme}`;
  return "Toys & Games > Toys > Building Toys";
}

export function buildMetaCatalogItem(
  listing: MetaListingSource,
  sku: MetaSkuSource,
  product: MetaProductSource,
  stockCount: number,
  siteUrl: string,
): MetaCatalogItemResult {
  const mpn = cleanText(product.mpn);
  const skuCode = cleanText(sku.sku_code) || cleanText(listing.external_sku);
  const price = Number(listing.listed_price ?? 0);
  const warnings: string[] = [];

  if (!skuCode) throw new Error("Meta catalog item has no SKU code");
  if (!mpn) throw new Error(`Meta catalog item ${skuCode} has no versioned MPN`);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Meta catalog item ${skuCode} has no listed price`);

  const title = cleanText(product.seo_title) || cleanText(listing.listing_title) || cleanText(product.name) || `LEGO ${mpn}`;
  const description = cleanText(product.seo_description) || cleanText(listing.listing_description) || cleanText(product.description);
  const imageUrl = cleanText(product.primary_image_url) || cleanText(product.website_image_url) || cleanText(product.img_url);
  const conditionGrade = Number(sku.condition_grade ?? 3);
  const siteBaseUrl = normalizeSiteUrl(siteUrl);
  const url = `${siteBaseUrl}/sets/${encodeURIComponent(mpn)}`;
  const barcode = selectBarcode(product);

  if (!description) throw new Error(`Meta catalog item ${skuCode} has no description`);
  if (!imageUrl) throw new Error(`Meta catalog item ${skuCode} has no primary image`);
  if (!barcode) warnings.push("missing_gtin_using_brand_mpn");

  const data: Record<string, unknown> = {
    availability: stockCount > 0 ? "in stock" : "out of stock",
    brand: "LEGO",
    category: normalizeCategory(product),
    condition: conditionGrade <= 2 ? "new" : "used",
    currency: "GBP",
    description: truncate(description, 5000),
    image_url: imageUrl,
    inventory: Math.max(0, Math.floor(stockCount)),
    name: truncate(title, 150),
    price: price.toFixed(2),
    retailer_product_group_id: mpn,
    url,
  };

  if (barcode) data.gtin = barcode;
  if (product.release_year) data.custom_label_0 = `Released ${product.release_year}`;
  data.custom_label_1 = `Grade ${Number.isFinite(conditionGrade) ? conditionGrade : 3}`;
  if (product.retired_flag === true || product.retired_flag === "true") data.custom_label_2 = "Retired";

  return { retailerId: skuCode, data, warnings };
}
