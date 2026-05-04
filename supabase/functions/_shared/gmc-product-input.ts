export interface GmcProductSource {
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

const GMC_TRANSFORM_ALLOWED_OPS = ["eq", "neq", "in", "includes", "exists", "gt", "gte", "lt", "lte"] as const;
const DEFAULT_PUBLIC_SITE_URL = "https://www.kusooishii.com";

export type GmcTransformOp = typeof GMC_TRANSFORM_ALLOWED_OPS[number];

export interface GmcTransformValidationOptions {
  allowedFields?: readonly string[];
  requireDefault?: boolean;
  requireStringValues?: boolean;
}

export interface GmcTransformValidationResult {
  ok: boolean;
  transform: string | null;
  errors: string[];
  warnings: string[];
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanBarcode(value: unknown): string {
  return cleanText(value).replace(/[^0-9Xx]/g, "");
}

export function normalizeGmcSiteUrl(value: unknown): string {
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

function normalizeGoogleProductCategory(value: unknown): string {
  const text = cleanText(value);
  if (!text) return "";
  const numericPrefix = text.match(/^\s*(\d+)/);
  return numericPrefix ? numericPrefix[1] : text;
}

function normalizeStorefrontLink(value: unknown): string {
  const text = cleanText(value);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    if (parsed.hostname.endsWith(".supabase.co") || !parsed.hostname.includes(".")) {
      return `${DEFAULT_PUBLIC_SITE_URL}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return text;
  } catch {
    return text;
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
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

export function resolveGmcTransformValue(transform: string | null | undefined, sourceValues: Record<string, unknown>): unknown {
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

function validateCondition(
  raw: unknown,
  path: string,
  allowedFields: Set<string> | null,
  errors: string[],
) {
  if (!isRecord(raw)) {
    errors.push(`${path} must be an object`);
    return;
  }

  const field = cleanText(raw.field);
  if (!field) {
    errors.push(`${path}.field is required`);
  } else if (allowedFields && !allowedFields.has(field)) {
    errors.push(`${path}.field "${field}" is not allowed`);
  }

  const op = (cleanText(raw.op) || "eq") as GmcTransformOp;
  if (!GMC_TRANSFORM_ALLOWED_OPS.includes(op)) {
    errors.push(`${path}.op "${op}" is not supported`);
  }

  if (op === "in") {
    const values = Array.isArray(raw.values)
      ? raw.values
      : Array.isArray(raw.value)
        ? raw.value
        : [];
    if (values.length === 0) errors.push(`${path}.value must be a non-empty array for op "in"`);
    return;
  }

  if (op !== "exists" && !hasOwn(raw, "value")) {
    errors.push(`${path}.value is required`);
  }
}

function validateWhen(
  raw: unknown,
  path: string,
  allowedFields: Set<string> | null,
  errors: string[],
) {
  if (raw == null) return;
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      errors.push(`${path} must not be an empty array`);
      return;
    }
    raw.forEach((condition, index) =>
      validateCondition(condition, `${path}[${index}]`, allowedFields, errors),
    );
    return;
  }
  validateCondition(raw, path, allowedFields, errors);
}

export function validateGmcTransform(
  transform: unknown,
  options: GmcTransformValidationOptions = {},
): GmcTransformValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const allowedFields = options.allowedFields
    ? new Set(options.allowedFields.map((field) => String(field)))
    : null;

  let parsed: unknown;
  if (typeof transform === "string") {
    const text = cleanText(transform);
    if (!text) {
      return { ok: false, transform: null, errors: ["Transform JSON is required"], warnings };
    }
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return {
        ok: false,
        transform: null,
        errors: [`Invalid JSON: ${err instanceof Error ? err.message : "parse failed"}`],
        warnings,
      };
    }
  } else {
    parsed = transform;
  }

  if (!isRecord(parsed)) {
    return { ok: false, transform: null, errors: ["Transform must be a JSON object"], warnings };
  }

  const rules = Array.isArray(parsed.rules) ? parsed.rules : null;
  if (!rules || rules.length === 0) {
    errors.push("rules must be a non-empty array");
  } else {
    rules.forEach((rule, index) => {
      if (!isRecord(rule)) {
        errors.push(`rules[${index}] must be an object`);
        return;
      }
      validateWhen(rule.when, `rules[${index}].when`, allowedFields, errors);
      if (!hasOwn(rule, "value")) {
        errors.push(`rules[${index}].value is required`);
      } else if (options.requireStringValues && typeof rule.value !== "string") {
        errors.push(`rules[${index}].value must be a string`);
      }
    });
  }

  if (options.requireDefault && !hasOwn(parsed, "default")) {
    errors.push("default is required");
  } else if (hasOwn(parsed, "default") && options.requireStringValues && typeof parsed.default !== "string") {
    errors.push("default must be a string");
  }

  return {
    ok: errors.length === 0,
    transform: errors.length === 0 ? JSON.stringify(parsed) : null,
    errors,
    warnings,
  };
}

function coerceAspectValue(aspectKey: string, value: unknown): unknown {
  if (isBlank(value)) return undefined;
  if (aspectKey === "identifierExists") {
    if (typeof value === "boolean") return value;
    return ["true", "1", "yes"].includes(String(value).toLowerCase());
  }
  if (aspectKey === "availability") {
    const normalized = String(value).trim().toUpperCase().replace(/[\s-]+/g, "_");
    const aliases: Record<string, string> = {
      IN_STOCK: "IN_STOCK",
      OUT_OF_STOCK: "OUT_OF_STOCK",
      PREORDER: "PREORDER",
      PRE_ORDER: "PREORDER",
      LIMITED_AVAILABILITY: "LIMITED_AVAILABILITY",
      BACKORDER: "BACKORDER",
    };
    return aliases[normalized] ?? value;
  }
  if (aspectKey === "condition") {
    const normalized = String(value).trim().toUpperCase().replace(/[\s-]+/g, "_");
    const aliases: Record<string, string> = {
      NEW: "NEW",
      USED: "USED",
      REFURBISHED: "REFURBISHED",
    };
    return aliases[normalized] ?? value;
  }
  if (aspectKey === "link") {
    return normalizeStorefrontLink(value);
  }
  if (aspectKey === "googleProductCategory") {
    return normalizeGoogleProductCategory(value);
  }
  if (aspectKey === "productTypes") {
    if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
    return [String(value)];
  }
  if (aspectKey === "gtin" || aspectKey === "gtins") {
    const values = Array.isArray(value) ? value : [value];
    const gtins = values.map((item) => cleanBarcode(item)).filter(Boolean);
    return gtins.length > 0 ? gtins : undefined;
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

  if (aspectKey === "gtin" || aspectKey === "gtins") {
    productPayload.gtins = coerced;
    delete productPayload.identifierExists;
    return;
  }

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
    gmc_product_category: normalizeGoogleProductCategory(product.gmc_product_category),
    google_product_category: normalizeGoogleProductCategory(product.gmc_product_category),
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
      const transformed = resolveGmcTransformValue(mapping.transform, sourceValues);
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
  const siteBaseUrl = normalizeGmcSiteUrl(siteUrl);
  const imageLink = cleanText(product.primary_image_url) || cleanText(product.website_image_url) || cleanText(product.img_url);
  const gmcCategory = normalizeGoogleProductCategory(product.gmc_product_category);
  const conditionGrade = Number(sku.condition_grade ?? 3);
  const weightKg = Number(product.weight_kg ?? 0);
  const gtin = selectGmcGtin(product);
  const availability = stockCount > 0 ? "IN_STOCK" : "OUT_OF_STOCK";
  const condition = conditionGrade <= 2 ? "NEW" : "USED";
  const productTypePath = cleanText(product.subtheme_name)
    ? `Toys > LEGO > ${cleanText(product.subtheme_name)}`
    : "Toys > LEGO";
  const priceAmountMicros = String(Math.round(Math.max(0, price) * 1_000_000));
  const warnings: string[] = [];

  if (!gtin.gtin) warnings.push("missing_gtin_using_brand_mpn");
  if (!gmcCategory) warnings.push("missing_gmc_product_category");

  const productAttributes: Record<string, unknown> = {
    title,
    description,
    link: `${siteBaseUrl}/sets/${encodeURIComponent(mpn)}`,
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
    productAttributes.gtins = [gtin.gtin];
  } else {
    productAttributes.identifierExists = false;
  }
  if (gmcCategory) productAttributes.googleProductCategory = gmcCategory;
  if (Number.isFinite(weightKg) && weightKg > 0) {
    productAttributes.shippingWeight = { value: weightKg, unit: "kg" };
  }

  const sourceValues = buildSourceValueMap({
    listing,
    sku,
    product,
    stockCount,
    siteUrl: siteBaseUrl,
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
  applyGmcMappings(productAttributes, mappings, sourceValues, warnings);

  const pricePayload = productAttributes.price as Record<string, unknown> | undefined;
  const finalPriceAmountMicros = Number(pricePayload?.amountMicros ?? 0);
  if (!Number.isFinite(finalPriceAmountMicros) || finalPriceAmountMicros <= 0) {
    throw new Error(`Google Shopping listing ${skuCode} has no listed price`);
  }
  if (!cleanText(productAttributes.description)) throw new Error(`Google Shopping listing ${skuCode} has no description`);
  if (!cleanText(productAttributes.imageLink)) throw new Error(`Google Shopping listing ${skuCode} has no primary image`);

  const finalWarnings = warnings.filter((warning) => {
    if (warning === "missing_gtin_using_brand_mpn" && !isBlank(productAttributes.gtins)) return false;
    if (warning === "missing_gmc_product_category" && !isBlank(productAttributes.googleProductCategory)) return false;
    return true;
  });

  return {
    input: {
      offerId: skuCode,
      contentLanguage: "en",
      feedLabel: "GB",
      productAttributes,
    },
    warnings: finalWarnings,
  };
}
