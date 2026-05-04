import { describe, expect, it } from "vitest";
import {
  buildGmcProductInput,
  resolveGmcTransformValue,
  selectGmcGtin,
  validateGmcTransform,
} from "../../supabase/functions/_shared/gmc-product-input";

const baseProduct = {
  mpn: "75367-1",
  name: "Venator-Class Republic Attack Cruiser",
  seo_description: "A retired LEGO Star Wars set.",
  img_url: "https://example.com/75367-1.jpg",
  gmc_product_category: "Toys & Games > Toys > Building Toys",
};

const baseSku = {
  sku_code: "75367-1.3",
  condition_grade: 3,
};

const baseListing = {
  listed_price: 149.99,
};

describe("GMC product input mapping", () => {
  it("prefers EAN over UPC and ISBN", () => {
    expect(selectGmcGtin({ ean: "5012345678901", upc: "012345678905", isbn: "9781234567890" })).toEqual({
      gtin: "5012345678901",
      source: "ean",
    });
  });

  it("falls back to UPC then ISBN when EAN is absent", () => {
    expect(selectGmcGtin({ upc: "012345678905", isbn: "9781234567890" })).toEqual({
      gtin: "012345678905",
      source: "upc",
    });
    expect(selectGmcGtin({ isbn: "9781234567890" })).toEqual({
      gtin: "9781234567890",
      source: "isbn",
    });
  });

  it("preserves the versioned MPN in the payload", () => {
    const { input } = buildGmcProductInput(baseListing, baseSku, { ...baseProduct, ean: "5012345678901" }, 2, "https://kuso.example");
    const productAttributes = input.productAttributes as Record<string, unknown>;
    expect(productAttributes.mpn).toBe("75367-1");
    expect(productAttributes.itemGroupId).toBe("75367-1");
    expect(productAttributes.gtins).toEqual(["5012345678901"]);
    expect(input).not.toHaveProperty("channel");
  });

  it("uses brand and identifierExists=false when barcode is absent, with a warning", () => {
    const { input, warnings } = buildGmcProductInput(baseListing, baseSku, baseProduct, 1, "https://kuso.example");
    const productAttributes = input.productAttributes as Record<string, unknown>;
    expect(productAttributes.brand).toBe("LEGO");
    expect(productAttributes.identifierExists).toBe(false);
    expect(productAttributes.availability).toBe("IN_STOCK");
    expect(productAttributes.condition).toBe("USED");
    expect(warnings).toContain("missing_gtin_using_brand_mpn");
  });

  it("normalizes legacy mapping values to v1 enum and gtins fields", () => {
    const { input } = buildGmcProductInput(
      baseListing,
      baseSku,
      baseProduct,
      0,
      "https://kuso.example",
      [
        { aspect_key: "availability", constant_value: "out_of_stock" },
        { aspect_key: "condition", constant_value: "used" },
        { aspect_key: "gtin", constant_value: " 5012345678901 " },
      ],
    );
    const productAttributes = input.productAttributes as Record<string, unknown>;
    expect(productAttributes.availability).toBe("OUT_OF_STOCK");
    expect(productAttributes.condition).toBe("USED");
    expect(productAttributes.gtins).toEqual(["5012345678901"]);
    expect(productAttributes).not.toHaveProperty("identifierExists");
  });

  it("blocks payload creation when required publish fields are missing", () => {
    expect(() =>
      buildGmcProductInput({ listed_price: 0 }, baseSku, baseProduct, 1, "https://kuso.example"),
    ).toThrow(/no listed price/i);
    expect(() =>
      buildGmcProductInput(baseListing, baseSku, { ...baseProduct, mpn: "" }, 1, "https://kuso.example"),
    ).toThrow(/no versioned MPN/i);
    expect(() =>
      buildGmcProductInput(baseListing, baseSku, { ...baseProduct, img_url: "" }, 1, "https://kuso.example"),
    ).toThrow(/no primary image/i);
  });
});

describe("GMC transform rules", () => {
  const allowedFields = ["product_type"] as const;

  it("validates and evaluates a product type rule with a fallback", () => {
    const result = validateGmcTransform(
      {
        rules: [
          {
            when: { field: "product_type", op: "in", value: ["X", "Y"] },
            value: "N",
          },
        ],
        default: "A",
      },
      { allowedFields, requireDefault: true, requireStringValues: true },
    );

    expect(result.ok).toBe(true);
    expect(resolveGmcTransformValue(result.transform, { product_type: "X" })).toBe("N");
    expect(resolveGmcTransformValue(result.transform, { product_type: "Z" })).toBe("A");
  });

  it("rejects malformed JSON", () => {
    const result = validateGmcTransform("{", {
      allowedFields,
      requireDefault: true,
      requireStringValues: true,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/invalid json/i);
  });

  it("rejects unsupported operators", () => {
    const result = validateGmcTransform(
      {
        rules: [
          {
            when: { field: "product_type", op: "startsWith", value: "X" },
            value: "N",
          },
        ],
        default: "A",
      },
      { allowedFields, requireDefault: true, requireStringValues: true },
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/not supported/i);
  });

  it("rejects unknown fields", () => {
    const result = validateGmcTransform(
      {
        rules: [
          {
            when: { field: "supplier_notes", op: "includes", value: "secret" },
            value: "N",
          },
        ],
        default: "A",
      },
      { allowedFields, requireDefault: true, requireStringValues: true },
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/not allowed/i);
  });

  it("rejects rules without a default", () => {
    const result = validateGmcTransform(
      {
        rules: [
          {
            when: { field: "product_type", op: "eq", value: "X" },
            value: "N",
          },
        ],
      },
      { allowedFields, requireDefault: true, requireStringValues: true },
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("default is required");
  });

  it("rejects non-string GMC category values", () => {
    const result = validateGmcTransform(
      {
        rules: [
          {
            when: { field: "product_type", op: "eq", value: "X" },
            value: 123,
          },
        ],
        default: "A",
      },
      { allowedFields, requireDefault: true, requireStringValues: true },
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("rules[0].value must be a string");
  });
});
