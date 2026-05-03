export interface GmcProductSource {
  mpn?: string | null;
  name?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  description?: string | null;
  img_url?: string | null;
  product_type?: string | null;
  lego_theme?: string | null;
  lego_subtheme?: string | null;
  subtheme_name?: string | null;
  piece_count?: number | string | null;
  release_year?: number | string | null;
  retired_flag?: boolean | string | null;
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

export interface GmcMappingRule {
  aspect_key: string;
  canonical_key?: string | null;
  constant_value?: string | null;
  transform?: string | null;
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

function isBlank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function normalizeComparable(value: unknown): string {
  if (value == null) return "";
  return String(value).trim().toLowerCase();
}

function matchesCondition(sourceValues: Record<string, unknown>, condition: Record<string, unknown>): boolean {
  const field = cleanText(condition.field);
  if (!field) return false;
  const actual = sourceValues[field];
  const expected = condition.value;
  const op = cleanText(condition.op) || "eq";

  if (op === "exists") {
    const expectedExists = condition.value == null ? true : Boolean(condition.value);
    return !isBlank(actual) === expectedExists;
  }

  if (op === "in") {
    const values = Array.isArray(condition.values)
      ? condition.values
      : Array.isArray(condition.value)
        ? condition.value
        : [];
    const actualText = normalizeComparable(actual);
    return values.some((value) => normalizeComparable(value) === actualText);
  }

  if (op === "includes") {
    if (Array.isArray(actual)) {
      return actual.some((value) => normalizeComparable(value) === normalizeComparable(expected));
    }
    return normalizeComparable(actual).includes(normalizeComparable(expected));
  }

  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  const canCompareNumbers = Number.isFinite(actualNumber) && Number.isFinite(expectedNumber);

  if (op === "neq") return normalizeComparable(actual) !== normalizeComparable(expected);
  if (op === "gt") return canCompareNumbers && actualNumber > expectedNumber;
  if (op === "gte") return canCompareNumbers && actualNumber >= expectedNumber;
  if (op === "lt") return canCompareNumbers && actualNumber < expectedNumber;
  if (op === "lte") return canCompareNumbers && actualNumber <= expectedNumber;
  return normalizeComparable(actual) === normalizeComparable(expected);
}

function matchesRule(sourceValues: Record<string, unknown>, when: unknown): boolean {
  if (!when) return true;
  if (Array.isArray(when)) {
    return when.every((condition) =>
      condition && typeof condition === "object" && matchesCondition(sourceValues, condition as Record<string, unknown>)
    );
  }
  if (typeof when === "object") return matchesCondition(sourceValues, when as Record<string, unknown>);
  return false;
}

function resolveTransformValue(transform: string | null | undefined, sourceValues: Record<string, unknown>): unknown {
  const text = cleanText(transform);
  if (!text) return undefined;
  const parsed = JSON.parse(text) as Record<string, unknown> | Array<Record<string, unknown>>;
  const rules = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.rules)
      ? parsed.rules as Array<Record<string, unknown>>
      : [];

  for (const rule of rules) {
    if (matchesRule(sourceValues, rule.when)) return rule.value;
  }
  if (!Array.isArray(parsed) && Object.prototype.hasOwnProperty.call(parsed, "default")) {
    return parsed.default;
  }
  return undefined;
}

function coerceAspectValue(aspectKey: string, value: unknown): unknown {
  if (isBlank(value)) return undefined;
  if (aspectKey === "identifierExists") {
    if (typeof value === "boolean") return value;
    return ["true", "1", "yes"].includes(String(value).toLowerCase());
  }
  if (aspectKey === "productTypes") {
    if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
    return [String(value)];
  }
  if (aspectKey === "shippingWeight.value") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (aspectKey === "price.amountMicros") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return String(Math.round(parsed));
  }
  return value;
}

function setProductAspect(productPayload: Record<string, unknown>, aspectKey: string, value: unknown) {
  const coerced = coerceAspectValue(aspectKey, value);
  if (coerced === undefined) return;

  if (aspectKey === "price.amountMicros" || aspectKey === "price.currencyCode") {
    const price = typeof productPayload.price === "object" && productPayload.price
      ? productPayload.price as Record<string, unknown>
      : {};
    productPayload.price = {
      ...price,
      [aspectKey === "price.amountMicros" ? "amountMicros" : "currencyCode"]: coerced,
    };
    return;
  }

  if (aspectKey === "shippingWeight.value" || aspectKey === "shippingWeight.unit") {
    const shippingWeight = typeof productPayload.shippingWeight === "object" && productPayload.shippingWeight
      ? productPayload.shippingWeight as Record<string, unknown>
      : {};
    productPayload.shippingWeight = {
      ...shippingWeight,
      [aspectKey === "shippingWeight.value" ? "value" : "unit"]: coerced,
    };
    return;
  }

  productPayload[aspectKey] = coerced;
}

function buildSourceValueMap(input: {
  listing: GmcListingSource;
  sku: GmcSkuSource;
  product: GmcProductSource;
  stockCount: number;
  siteUrl: string;
  title: string;
  description: string;
  imageLink: string;
  priceAmountMicros: string;
  currencyCode: string;
  availability: string;
  condition: string;
  mpn: string;
  gtin: string | null;
  identifierExists: boolean;
  productTypePath: string;
}) {
  const { listing, sku, product } = input;
  return {
    ...product,
    ...sku,
    ...listing,
    stock_count: input.stockCount,
    title: input.title,
    description: input.description,
    link: `${input.siteUrl}/sets/${encodeURIComponent(input.mpn)}`,
    image_link: input.imageLink,
    imageLink: input.imageLink,
    price_amount_micros: input.priceAmountMicros,
    price_currency: input.currencyCode,
    availability_from_stock: input.availability,
    condition_from_grade: input.condition,
    brand: "LEGO",
    mpn: input.mpn,
    gtin: input.gtin,
    identifier_exists: input.identifierExists,
    gmc_product_category: product.gmc_product_category,
    product_type_path: input.productTypePath,
    weight_kg: product.weight_kg,
    weight_g: Number(product.weight_kg ?? 0) > 0 ? Number(product.weight_kg) * 1000 : null,
  } as Record<string, unknown>;
}

function applyGmcMappings(
  productPayload: Record<string, unknown>,
  mappings: GmcMappingRule[],
  sourceValues: Record<string, unknown>,
  warnings: string[],
) {
  for (const mapping of mappings) {
    const aspectKey = cleanText(mapping.aspect_key);
    if (!aspectKey) continue;

    try {
      const transformed = resolveTransformValue(mapping.transform, sourceValues);
      if (!isBlank(transformed)) {
        setProductAspect(productPayload, aspectKey, transformed);
        continue;
      }
    } catch (err) {
      warnings.push(`invalid_mapping_rule:${aspectKey}:${err instanceof Error ? err.message : "unknown"}`);
    }

    if (mapping.canonical_key && !isBlank(sourceValues[mapping.canonical_key])) {
      setProductAspect(productPayload, aspectKey, sourceValues[mapping.canonical_key]);
      continue;
    }

    if (!isBlank(mapping.constant_value)) {
      setProductAspect(productPayload, aspectKey, mapping.constant_value);
    }
  }
}

export function buildGmcProductInput(
  listing: GmcListingSource,
  sku: GmcSkuSource,
  product: GmcProductSource,
  stockCount: number,
  siteUrl: string,
  mappings: GmcMappingRule[] = [],
): GmcProductInputResult {
  const mpn = cleanText(product.mpn);
  const skuCode = cleanText(sku.sku_code) || cleanText(listing.external_sku);
  const price = Number(listing.listed_price ?? 0);
  if (!skuCode) throw new Error("Google Shopping listing has no SKU code");
  if (!mpn) throw new Error(`Google Shopping listing ${skuCode} has no versioned MPN`);

  const title = cleanText(product.seo_title) || cleanText(listing.listing_title) || cleanText(product.name) || `LEGO ${mpn}`;
  const description = cleanText(product.seo_description) || cleanText(listing.listing_description) || cleanText(product.description);
  const imageLink = cleanText(product.img_url);
  const gmcCategory = cleanText(product.gmc_product_category);
  const conditionGrade = Number(sku.condition_grade ?? 3);
  const weightKg = Number(product.weight_kg ?? 0);
  const gtin = selectGmcGtin(product);
  const availability = stockCount > 0 ? "in_stock" : "out_of_stock";
  const condition = conditionGrade <= 2 ? "new" : "used";
  const productTypePath = cleanText(product.subtheme_name)
    ? `Toys > LEGO > ${cleanText(product.subtheme_name)}`
    : "Toys > LEGO";
  const priceAmountMicros = String(Math.round(Math.max(0, price) * 1_000_000));
  const warnings: string[] = [];

  if (!gtin.gtin) warnings.push("missing_gtin_using_brand_mpn");
  if (!gmcCategory) warnings.push("missing_gmc_product_category");

  const productPayload: Record<string, unknown> = {
    title,
    description,
    link: `${siteUrl}/sets/${encodeURIComponent(mpn)}`,
    imageLink,
    price: {
      amountMicros: priceAmountMicros,
      currencyCode: "GBP",
    },
    availability,
    condition,
    brand: "LEGO",
    mpn,
    productTypes: [productTypePath],
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

  const sourceValues = buildSourceValueMap({
    listing,
    sku,
    product,
    stockCount,
    siteUrl,
    title,
    description,
    imageLink,
    priceAmountMicros,
    currencyCode: "GBP",
    availability,
    condition,
    mpn,
    gtin: gtin.gtin,
    identifierExists: Boolean(gtin.gtin),
    productTypePath,
  });
  applyGmcMappings(productPayload, mappings, sourceValues, warnings);

  const pricePayload = productPayload.price as Record<string, unknown> | undefined;
  const finalPriceAmountMicros = Number(pricePayload?.amountMicros ?? 0);
  if (!Number.isFinite(finalPriceAmountMicros) || finalPriceAmountMicros <= 0) {
    throw new Error(`Google Shopping listing ${skuCode} has no listed price`);
  }
  if (!cleanText(productPayload.description)) throw new Error(`Google Shopping listing ${skuCode} has no description`);
  if (!cleanText(productPayload.imageLink)) throw new Error(`Google Shopping listing ${skuCode} has no primary image`);

  const finalWarnings = warnings.filter((warning) => {
    if (warning === "missing_gtin_using_brand_mpn" && !isBlank(productPayload.gtin)) return false;
    if (warning === "missing_gmc_product_category" && !isBlank(productPayload.googleProductCategory)) return false;
    return true;
  });

  return {
    input: {
      offerId: skuCode,
      contentLanguage: "en",
      feedLabel: "GB",
      channel: "ONLINE",
      product: productPayload,
    },
    warnings: finalWarnings,
  };
}
