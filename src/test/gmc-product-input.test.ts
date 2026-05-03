import { describe, expect, it } from "vitest";
import { buildGmcProductInput, selectGmcGtin } from "../../supabase/functions/_shared/gmc-product-input";

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
    expect((input.product as Record<string, unknown>).mpn).toBe("75367-1");
    expect((input.product as Record<string, unknown>).itemGroupId).toBe("75367-1");
  });

  it("uses brand and identifierExists=false when barcode is absent, with a warning", () => {
    const { input, warnings } = buildGmcProductInput(baseListing, baseSku, baseProduct, 1, "https://kuso.example");
    expect((input.product as Record<string, unknown>).brand).toBe("LEGO");
    expect((input.product as Record<string, unknown>).identifierExists).toBe(false);
    expect(warnings).toContain("missing_gtin_using_brand_mpn");
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
