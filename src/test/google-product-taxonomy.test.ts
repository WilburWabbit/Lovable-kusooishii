import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEGO_GOOGLE_PRODUCT_CATEGORY_ID,
  normalizeGoogleProductCategoryTransformValues,
  normalizeGoogleProductCategoryValue,
  selectGoogleProductTaxonomyCandidates,
} from "../../supabase/functions/_shared/google-product-taxonomy";

describe("Google product taxonomy matching", () => {
  it("uses the official taxonomy ID for LEGO interlocking blocks as the default LEGO candidate", () => {
    const candidates = selectGoogleProductTaxonomyCandidates({
      productSamples: [
        {
          mpn: "75367-1",
          name: "LEGO Star Wars Venator-Class Republic Attack Cruiser",
          product_type: "set",
          lego_theme: "Star Wars",
        },
      ],
    });

    expect(candidates[0].id).toBe(DEFAULT_LEGO_GOOGLE_PRODUCT_CATEGORY_ID);
    expect(candidates[0].path).toBe("Toys & Games > Toys > Building Toys > Interlocking Blocks");
  });

  it("ranks minifigure samples toward action and toy figures", () => {
    const candidates = selectGoogleProductTaxonomyCandidates({
      productSamples: [
        {
          mpn: "col25-1",
          name: "Collectible LEGO Minifigure",
          product_type: "minifigure",
        },
      ],
    });

    expect(candidates.slice(0, 5).map((candidate) => candidate.id)).toContain("6058");
  });

  it("normalises category paths to taxonomy IDs in generated transform rules", () => {
    const result = normalizeGoogleProductCategoryTransformValues({
      rules: [
        {
          when: { field: "product_type", op: "includes", value: "minifigure" },
          value: "Toys & Games > Toys > Dolls, Playsets & Toy Figures > Action & Toy Figures",
        },
      ],
      default: "Toys & Games > Toys > Building Toys > Interlocking Blocks",
    });

    expect(result.transform).toEqual({
      rules: [
        {
          when: { field: "product_type", op: "includes", value: "minifigure" },
          value: "6058",
        },
      ],
      default: "3287",
    });
    expect(result.warnings).toEqual([]);
  });

  it("accepts taxonomy IDs directly", () => {
    expect(normalizeGoogleProductCategoryValue("3287")).toBe("3287");
  });
});
