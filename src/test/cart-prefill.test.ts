import { describe, expect, it, vi } from "vitest";
import {
  applyCartPrefill,
  buildCheckoutLinkTemplate,
  cartPrefillProductFromRows,
  parseCartPrefillParams,
} from "@/lib/cart-prefill";
import type { Product } from "@/lib/store";

const skuRow = {
  id: "sku-1",
  sku_code: "75367-1.3",
  condition_grade: 3,
  active_flag: true,
  saleable_flag: true,
  product: {
    mpn: "75367-1",
    name: "Venator-Class Republic Attack Cruiser",
    img_url: "https://www.kusooishii.com/images/75367-1.jpg",
    piece_count: 5374,
    retired_flag: true,
    release_year: 2023,
    theme: { name: "Star Wars" },
  },
};

const liveListing = {
  listed_price: 149.99,
  offer_status: "PUBLISHED",
  v2_status: "live",
};

const stockRows = [
  { status: "available", v2_status: "graded" },
  { status: "available", v2_status: "listed" },
];

describe("cart prefill", () => {
  it("builds the same public checkout link shape used by GMC", () => {
    expect(buildCheckoutLinkTemplate("https://gcgrwujfyurgetvqlmbf.supabase.co", "75367-1.3")).toBe(
      "https://www.kusooishii.com/cart?sku=75367-1.3",
    );
  });

  it("parses SKU and clamps requested quantity", () => {
    const parsed = parseCartPrefillParams(new URLSearchParams("sku=75367-1.3&qty=999"));
    expect(parsed).toEqual({ skuCode: "75367-1.3", quantity: 10 });
    expect(parseCartPrefillParams(new URLSearchParams("qty=2"))).toBeNull();
  });

  it("creates a cart product only for live, priced, saleable SKU rows with stock", () => {
    const result = cartPrefillProductFromRows(skuRow, [liveListing], stockRows);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.product.id).toBe("sku-1");
      expect(result.product.setNumber).toBe("75367-1");
      expect(result.product.price).toBe(149.99);
      expect(result.product.stock).toBe(2);
    }
  });

  it("returns explicit reasons for missing or unavailable SKU rows", () => {
    expect(cartPrefillProductFromRows(null, [liveListing], stockRows)).toEqual({
      ok: false,
      reason: "missing_sku",
    });
    expect(cartPrefillProductFromRows({ ...skuRow, saleable_flag: false }, [liveListing], stockRows)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(cartPrefillProductFromRows(skuRow, [{ ...liveListing, offer_status: "DRAFT", v2_status: "draft" }], stockRows)).toEqual({
      ok: false,
      reason: "missing_live_listing",
    });
    expect(cartPrefillProductFromRows(skuRow, [{ ...liveListing, listed_price: 0 }], stockRows)).toEqual({
      ok: false,
      reason: "missing_price",
    });
    expect(cartPrefillProductFromRows(skuRow, [liveListing], [])).toEqual({
      ok: false,
      reason: "out_of_stock",
    });
  });

  it("updates an existing cart line instead of adding a duplicate", () => {
    const product = cartPrefillProductFromRows(skuRow, [liveListing], stockRows);
    expect(product.ok).toBe(true);
    if (!product.ok) return;

    const addToCart = vi.fn();
    const updateQuantity = vi.fn();
    const finalQuantity = applyCartPrefill({
      product: product.product,
      quantity: 2,
      cart: [{ id: product.product.id, quantity: 1 }],
      addToCart,
      updateQuantity,
    });

    expect(finalQuantity).toBe(2);
    expect(addToCart).not.toHaveBeenCalled();
    expect(updateQuantity).toHaveBeenCalledWith("sku-1", 2);
  });

  it("adds a new line then sets the clamped quantity", () => {
    const product: Product = {
      id: "sku-2",
      name: "LEGO Set",
      setNumber: "10300-1",
      price: 25,
      rrp: 0,
      image: "",
      images: [],
      theme: "Icons",
      themeId: null,
      pieceCount: 100,
      condition: "Grade 2",
      conditionGrade: 2,
      ageRange: "",
      hook: "",
      description: "",
      highlights: [],
      stock: 1,
      retired: false,
      yearReleased: null,
    };
    const addToCart = vi.fn();
    const updateQuantity = vi.fn();

    expect(applyCartPrefill({ product, quantity: 3, cart: [], addToCart, updateQuantity })).toBe(1);
    expect(addToCart).toHaveBeenCalledWith(product);
    expect(updateQuantity).toHaveBeenCalledWith("sku-2", 1);
  });
});
