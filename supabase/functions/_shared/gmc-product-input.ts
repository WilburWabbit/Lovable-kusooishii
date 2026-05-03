export interface GmcProductSource {
  mpn?: string | null;
  name?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  description?: string | null;
  img_url?: string | null;
  subtheme_name?: string | null;
  weight_kg?: number | string | null;
  ean?: string | null;
  upc?: string | null;
  isbn?: string | null;
  gmc_product_category?: string | null;
}

export interface GmcSkuSource {
  sku_code?: string | null;
  condition_grade?: number | string | null;
}

export interface GmcListingSource {
  external_sku?: string | null;
  listing_title?: string | null;
  listing_description?: string | null;
  listed_price?: number | string | null;
}

export interface GmcProductInputResult {
  input: Record<string, unknown>;
  warnings: string[];
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanBarcode(value: unknown): string {
  return cleanText(value).replace(/[^0-9Xx]/g, "");
}

export function selectGmcGtin(product: GmcProductSource): { gtin: string | null; source: "ean" | "upc" | "isbn" | null } {
  const candidates: Array<["ean" | "upc" | "isbn", unknown]> = [
    ["ean", product.ean],
    ["upc", product.upc],
    ["isbn", product.isbn],
  ];

  for (const [source, value] of candidates) {
    const gtin = cleanBarcode(value);
    if (gtin) return { gtin, source };
  }

  return { gtin: null, source: null };
}

export function buildGmcProductInput(
  listing: GmcListingSource,
  sku: GmcSkuSource,
  product: GmcProductSource,
  stockCount: number,
  siteUrl: string,
): GmcProductInputResult {
  const mpn = cleanText(product.mpn);
  const skuCode = cleanText(sku.sku_code) || cleanText(listing.external_sku);
  const price = Number(listing.listed_price ?? 0);
  if (!skuCode) throw new Error("Google Shopping listing has no SKU code");
  if (!mpn) throw new Error(`Google Shopping listing ${skuCode} has no versioned MPN`);
  if (price <= 0) throw new Error(`Google Shopping listing ${skuCode} has no listed price`);

  const title = cleanText(product.seo_title) || cleanText(listing.listing_title) || cleanText(product.name) || `LEGO ${mpn}`;
  const description = cleanText(product.seo_description) || cleanText(listing.listing_description) || cleanText(product.description);
  const imageLink = cleanText(product.img_url);
  const gmcCategory = cleanText(product.gmc_product_category);
  const conditionGrade = Number(sku.condition_grade ?? 3);
  const weightKg = Number(product.weight_kg ?? 0);
  const gtin = selectGmcGtin(product);
  const warnings: string[] = [];

  if (!gtin.gtin) warnings.push("missing_gtin_using_brand_mpn");
  if (!gmcCategory) warnings.push("missing_gmc_product_category");
  if (!description) throw new Error(`Google Shopping listing ${skuCode} has no description`);
  if (!imageLink) throw new Error(`Google Shopping listing ${skuCode} has no primary image`);

  const productPayload: Record<string, unknown> = {
    title,
    description,
    link: `${siteUrl}/sets/${encodeURIComponent(mpn)}`,
    imageLink,
    price: {
      amountMicros: String(Math.round(price * 1_000_000)),
      currencyCode: "GBP",
    },
    availability: stockCount > 0 ? "in_stock" : "out_of_stock",
    condition: conditionGrade <= 2 ? "new" : "used",
    brand: "LEGO",
    mpn,
    productTypes: [
      cleanText(product.subtheme_name)
        ? `Toys > LEGO > ${cleanText(product.subtheme_name)}`
        : "Toys > LEGO",
    ],
    itemGroupId: mpn,
  };

  if (gtin.gtin) {
    productPayload.gtin = gtin.gtin;
  } else {
    productPayload.identifierExists = false;
  }
  if (gmcCategory) productPayload.googleProductCategory = gmcCategory;
  if (Number.isFinite(weightKg) && weightKg > 0) {
    productPayload.shippingWeight = { value: weightKg, unit: "kg" };
  }

  return {
    input: {
      offerId: skuCode,
      contentLanguage: "en",
      feedLabel: "GB",
      channel: "ONLINE",
      product: productPayload,
    },
    warnings,
  };
}
