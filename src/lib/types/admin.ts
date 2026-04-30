// ============================================================
// Admin V2 — Entity Types
// Mirrors the spec entity model (Sections 2.1–2.11).
// V2 code uses these interfaces directly; the hooks layer
// maps between these and Supabase column names.
// ============================================================

// ─── Enums / Unions ─────────────────────────────────────────

export type StockUnitStatus =
  | 'purchased'
  | 'graded'
  | 'listed'
  | 'sold'
  | 'shipped'
  | 'delivered'
  | 'payout_received'
  | 'complete'
  | 'return_pending'
  | 'refunded'
  | 'restocked'
  | 'needs_allocation';

export type PurchaseBatchStatus = 'draft' | 'recorded';

export type VendorType = 'supplier' | 'marketplace' | 'payment_processor' | 'other';

export type Channel = 'ebay' | 'website' | 'web' | 'bricklink' | 'brickowl' | 'in_person' | 'etsy' | 'squarespace';

export type ChannelListingStatus = 'draft' | 'live' | 'paused' | 'ended';

export type OrderStatus =
  | 'needs_allocation'
  | 'new'
  | 'awaiting_shipment'
  | 'shipped'
  | 'delivered'
  | 'complete'
  | 'return_pending'
  | 'refunded'
  | 'cancelled';

export type PayoutChannel = 'ebay' | 'stripe';

export type QBOSyncStatus = 'pending' | 'synced' | 'partial' | 'error' | 'needs_manual_review';

/** Saleable condition grades only. Grade 5 (Red Card) is internal/parts-only. */
export type ConditionGrade = 1 | 2 | 3 | 4;

/** All condition grades including non-saleable. */
export type ConditionGradeAll = 1 | 2 | 3 | 4 | 5;

export type ConditionFlag =
  | 'resealed'
  | 'shelf_wear'
  | 'box_dent'
  | 'box_crush'
  | 'missing_outer_carton'
  | 'bags_opened'
  | 'parts_verified'
  | 'sun_yellowing'
  | 'price_sticker_residue'
  | 'stickers_applied'
  | 'missing_minifigs'
  | 'missing_instructions';

// ─── Shared Cost Breakdown ──────────────────────────────────

export interface SharedCosts {
  shipping: number;
  broker_fee: number;
  other: number;
  other_label: string;
}

// ─── Fee Breakdown (Payouts) ────────────────────────────────

export type FeeBreakdown = Record<string, number>;

// ─── 2.1 Purchase Batch ────────────────────────────────────

export type QboSyncStatus = 'pending' | 'synced' | 'error' | 'skipped';

export interface PurchaseBatch {
  id: string; // PO-NNN
  supplierId: string | null;
  supplierName: string;
  purchaseDate: string; // ISO date
  reference: string | null;
  supplierVatRegistered: boolean;
  sharedCosts: SharedCosts;
  totalSharedCosts: number;
  totalUnitCosts: number;
  status: PurchaseBatchStatus;
  qboPurchaseId: string | null;
  qboSyncStatus: QboSyncStatus;
  qboSyncError: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── 2.2 Purchase Line Item ────────────────────────────────

export interface PurchaseLineItem {
  id: string;
  batchId: string;
  mpn: string;
  quantity: number;
  unitCost: number;
  apportionedCost: number;
  landedCostPerUnit: number;
  createdAt: string;
  updatedAt: string;
}

// ─── 2.3 Stock Unit ────────────────────────────────────────

export interface StockUnit {
  id: string;
  uid: string | null;
  batchId: string | null;
  lineItemId: string | null;
  mpn: string;
  grade: ConditionGradeAll | null;
  sku: string | null; // computed: mpn.grade
  landedCost: number | null;
  conditionFlags: ConditionFlag[];
  status: StockUnitStatus;
  orderId: string | null;
  payoutId: string | null;
  createdAt: string;
  gradedAt: string | null;
  listedAt: string | null;
  soldAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  notes: string | null;
}

// ─── 2.4 Product (MPN level) ──────────────────────────────

export interface Product {
  id: string;
  mpn: string;
  name: string;
  productType: "set" | "minifig";
  theme: string | null;
  subtheme: string | null;
  setNumber: string | null;
  pieceCount: number | null;
  ageMark: string | null;
  ean: string | null;
  releaseDate: string | null;
  retiredDate: string | null;
  dimensionsCm: string | null;
  weightG: number | null;
  hook: string | null;
  description: string | null;
  highlights: string | null;
  cta: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ebayCategoryId: string | null;
  createdAt: string;
}

// ─── 2.5 Product Variant (SKU level) ──────────────────────

export interface ProductVariant {
  id: string;
  sku: string; // mpn.grade
  mpn: string;
  grade: ConditionGrade;
  stripeProductId: string | null;
  stripePriceId: string | null;
  salePrice: number | null;
  floorPrice: number | null;
  avgCost: number | null;
  costRange: string | null;
  qtyOnHand: number; // computed from stock units
  conditionNotes: string | null;
  marketPrice: number | null;
  createdAt: string;
}

export interface ProductVariantPricing {
  skuId: string;
  skuCode: string;
  channel: Channel | null;
  currentPrice: number | null;
  floorPrice: number | null;
  marketPrice: number | null;
  avgCost: number | null;
  costRange: string | null;
  confidenceScore: number | null;
  pricedAt: string | null;
}

// ─── 2.6 Product Image ────────────────────────────────────

export interface ProductImage {
  id: string;
  mediaAssetId: string;
  mpn: string;
  storagePath: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

// ─── 2.7 Channel Listing ──────────────────────────────────

export interface ChannelListing {
  id: string;
  sku: string;
  channel: Channel;
  status: ChannelListingStatus;
  externalId: string | null;
  externalUrl: string | null;
  listedAt: string | null;
  listingTitle: string | null;
  listingDescription: string | null;
  listingPrice: number | null;
  feeAdjustedPrice: number | null;
  estimatedFees: number | null;
  estimatedNet: number | null;
}

// ─── 2.8 Order ────────────────────────────────────────────

export interface Order {
  id: string;
  orderNumber: string; // KO-NNNNNNN
  customerId: string | null;
  channel: Channel;
  status: OrderStatus;
  total: number;
  vatAmount: number;
  netAmount: number;
  paymentMethod: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  shippingCost: number | null;
  blueBellClub: boolean;
  docNumber: string | null;
  qboSalesReceiptId: string | null;
  qboSyncStatus: QBOSyncStatus;
  externalOrderId: string | null;
  notes: string | null;
  orderDate: string;
  paymentReference: string | null;
  createdAt: string;
  shippedAt: string | null;
  deliveredAt: string | null;
}

// ─── 2.9 Order Line Item ──────────────────────────────────

export interface OrderLineItem {
  id: string;
  orderId: string;
  stockUnitId: string | null; // null if unallocated
  sku: string | null; // null if unallocated
  name: string | null; // product/SKU name
  unitPrice: number;
  cogs: number | null; // landed cost of consumed stock unit (FIFO)
  vatRate: number; // e.g. 20
  lineVat: number; // VAT amount for this line
  costingMethod?: string | null;
  economicsStatus?: string | null;
  totalFees?: number | null;
  programDiscountAmount?: number | null;
  programCommissionAmount?: number | null;
  grossMarginAmount?: number | null;
  netMarginAmount?: number | null;
  netMarginRate?: number | null;
}

// ─── 2.10 Customer ────────────────────────────────────────

export interface Customer {
  id: string;
  name: string;
  email: string;
  channelIds: Record<string, string>; // { ebay: "username", bricklink: "username" }
  qboCustomerId: string | null;
  stripeCustomerId: string | null;
  blueBellMember: boolean;
  createdAt: string;
}

export interface CustomerRow extends Customer {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  mobile: string | null;
  notes: string | null;
  active: boolean;
  billingLine1: string | null;
  billingLine2: string | null;
  billingCity: string | null;
  billingCounty: string | null;
  billingPostcode: string | null;
  billingCountry: string | null;
  orderCount: number;
  totalSpend: number;
  firstOrderAt: string | null;
}

// ─── 2.11 Payout ──────────────────────────────────────────

export interface Payout {
  id: string;
  channel: PayoutChannel;
  payoutDate: string; // ISO date
  grossAmount: number;
  totalFees: number;
  netAmount: number;
  feeBreakdown: FeeBreakdown;
  orderCount: number;
  unitCount: number;
  qboDepositId: string | null;
  qboExpenseId: string | null;
  qboSyncStatus: QBOSyncStatus;
  qboSyncError: string | null;
  externalPayoutId: string | null;
  reconciliationStatus: 'pending' | 'reconciled';
  transactionCount: number;
  matchedOrderCount: number;
  unmatchedTransactionCount: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Composite Types (for UI convenience) ─────────────────

/** Purchase batch with its line items and stock units */
export interface PurchaseBatchDetail extends PurchaseBatch {
  lineItems: (PurchaseLineItem & { units: StockUnit[] })[];
  productDataMap?: Map<string, Record<string, unknown>>;
}

// ─── BrickEconomy Reference Data ─────────────────────────

export interface BrickEconomyData {
  theme: string | null;
  subtheme: string | null;
  piecesCount: number | null;
  year: number | null;
  releasedDate: string | null;
  retiredDate: string | null;
  retailPrice: number | null;
  minifigsCount: number | null;
}

export interface FieldOverride {
  overridden_at: string;
  source_value: unknown;
}

/** Product with its variants */
export interface ProductDetail extends Product {
  variants: ProductVariant[];
  images: ProductImage[];
  brickeconomyData: BrickEconomyData | null;
  catalogImageUrl: string | null;
  includeCatalogImg: boolean;
  fieldOverrides: Record<string, FieldOverride>;
  ebayCategoryId: string | null;
  ebayMarketplace: string | null;
  gmcProductCategory: string | null;
  metaCategory: string | null;
  selectedMinifigFigNums: string[];
}

/** Minifig included in a LEGO set (sourced from rebrickable inventories) */
export interface SetMinifig {
  figNum: string;
  name: string | null;
  bricklinkId: string | null;
  imgUrl: string | null;
  quantity: number;
  source: 'bricklink' | 'rebrickable';
}

// ─── Channel Taxonomy / Item Specifics ─────────────────────

export interface ChannelCategorySuggestion {
  categoryId: string;
  categoryName: string;
  ancestors: { id: string; name: string }[];
}

export interface ChannelCategoryAttribute {
  id: string;
  schema_id: string;
  key: string;
  label: string | null;
  required: boolean;
  cardinality: 'single' | 'multi';
  data_type: string;
  allowed_values: string[] | null;
  allows_custom: boolean;
  help_text: string | null;
  sort_order: number;
}

export interface ProductAttribute {
  id?: string;
  namespace: 'core' | 'ebay' | 'gmc' | 'meta';
  key: string;
  value: string | null;
  value_json: unknown;
  source?: string | null;
  updated_at?: string;
}

/** Order with its line items */
export interface OrderDetail extends Order {
  lineItems: OrderLineItem[];
  customer: Customer | null;
}
