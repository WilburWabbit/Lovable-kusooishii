export interface ChannelListing {
  id: string;
  sku_id: string;
  channel: string;
  external_sku: string;
  offer_status: string | null;
  listed_price: number | null;
  listing_title: string | null;
  listing_description: string | null;
  price_floor: number | null;
  price_target: number | null;
  synced_at: string;
}

export interface ProductSku {
  id: string;
  sku_code: string;
  condition_grade: string;
  price: number | null;
  active_flag: boolean;
  stock_available: number;
  carrying_value: number;
  channel_listings: ChannelListing[];
}

export interface ProductDetail {
  id: string;
  mpn: string;
  name: string | null;
  theme_name: string | null;
  subtheme_name: string | null;
  piece_count: number | null;
  release_year: number | null;
  retired_flag: boolean;
  img_url: string | null;
  include_catalog_img: boolean;
  product_hook: string | null;
  description: string | null;
  highlights: string | null;
  call_to_action: string | null;
  seo_title: string | null;
  seo_description: string | null;
  age_range: string | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  stock_available: number;
  carrying_value: number;
  units_sold: number;
  revenue: number;
  skus: ProductSku[];
  channel_listings: ChannelListing[];
}

export interface BrickEconomyValuation {
  item_number: string;
  name: string | null;
  current_value: number | null;
  growth: number | null;
  synced_at: string | null;
  condition: string | null;
}

export const CHANNELS = ["ebay", "bricklink", "brickowl", "web"] as const;

export const CHANNEL_LABELS: Record<string, string> = {
  ebay: "eBay",
  bricklink: "BrickLink",
  brickowl: "BrickOwl",
  web: "Web",
};

export const GRADE_LABELS: Record<string, string> = {
  "1": "Sealed",
  "2": "Like New",
  "3": "Good",
  "4": "Fair",
  "5": "Poor",
};

export const CONTENT_FIELDS: {
  key: string;
  label: string;
  type: "input" | "textarea";
  maxLen?: number;
  hint?: string;
}[] = [
  { key: "product_hook", label: "Product Hook", type: "input", maxLen: 160 },
  { key: "description", label: "Description", type: "textarea" },
  { key: "highlights", label: "Highlights", type: "textarea", hint: "One per line" },
  { key: "call_to_action", label: "Call to Action", type: "input", maxLen: 80 },
  { key: "seo_title", label: "SEO Title", type: "input", maxLen: 60 },
  { key: "seo_description", label: "SEO Description", type: "textarea", maxLen: 400 },
];

export function fmt(v: number | null | undefined) {
  if (v == null) return "—";
  return `£${v.toFixed(2)}`;
}
