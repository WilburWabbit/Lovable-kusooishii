import { describe, expect, it } from "vitest";
import { buildMetaCatalogItem } from "../../supabase/functions/_shared/meta-product-input";

describe("buildMetaCatalogItem", () => {
  it("builds a Meta product item payload with versioned MPN grouping", () => {
    const item = buildMetaCatalogItem(
      { external_sku: "75367-1.3", listed_price: 89.99 },
      { sku_code: "75367-1.3", condition_grade: 3 },
      {
        mpn: "75367-1",
        name: "Venator-Class Republic Attack Cruiser",
        description: "Complete LEGO set with checked parts and grading notes.",
        primary_image_url: "https://kusooishii.com/images/75367-1.jpg",
        ean: "5702017421474",
        subtheme_name: "Star Wars",
        release_year: 2023,
      },
      2,
      "https://kusooishii.com",
    );

    expect(item.retailerId).toBe("75367-1.3");
    expect(item.data.retailer_product_group_id).toBe("75367-1");
    expect(item.data.item_group_id).toBeUndefined();
    expect(item.data.availability).toBe("in stock");
    expect(item.data.condition).toBe("used");
    expect(item.data.price).toBe("89.99");
    expect(item.data.url).toBe("https://kusooishii.com/sets/75367-1");
  });
});
