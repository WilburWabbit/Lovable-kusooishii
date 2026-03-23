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

export type Channel = 'ebay' | 'website' | 'bricklink' | 'brickowl' | 'in_person';

export type ChannelListingStatus = 'draft' | 'live' | 'paused' | 'ended';

export type OrderStatus =
  | 'needs_allocation'
  | 'new'
  | 'awaiting_shipment'
  | 'shipped'
  | 'delivered'
  | 'complete'
  | 'return_pending';

export type PayoutChannel = 'ebay' | 'stripe';

export type QBOSyncStatus = 'pending' | 'synced' | 'error';

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
  | 'price_sticker_residue';

// ─── Shared Cost Breakdown ──────────────────────────────────

export interface SharedCosts {
  shipping: number;
  broker_fee: number;
  other: number;
  other_label: string;
}

// ─── Fee Breakdown (Payouts) ────────────────────────────────

export interface FeeBreakdown {
  fvf: number;
  promoted_listings: number;
  international: number;
  processing: number;
}

// ─── 2.1 Purchase Batch ────────────────────────────────────

export interface PurchaseBatch {
  id: string; // PO-NNN
  supplierName: string;
  purchaseDate: string; // ISO date
  reference: string | null;
  supplierVatRegistered: boolean;
  sharedCosts: SharedCosts;
  totalSharedCosts: number;
  status: PurchaseBatchStatus;
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
}

// ─── 2.4 Product (MPN level) ──────────────────────────────

export interface Product {
  id: string;
  mpn: string;
  name: string;
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
  createdAt: string;
}

// ─── 2.5 Product Variant (SKU level) ──────────────────────

export interface ProductVariant {
  id: string;
  sku: string; // mpn.grade
  mpn: string;
  grade: ConditionGrade;
  salePrice: number | null;
  floorPrice: number | null;
  avgCost: number | null;
  costRange: string | null;
  qtyOnHand: number; // computed from stock units
  conditionNotes: string | null;
  marketPrice: number | null;
  createdAt: string;
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
  qboSalesReceiptId: string | null;
  qboSyncStatus: QBOSyncStatus;
  externalOrderId: string | null;
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
  unitPrice: number;
  cogs: number | null; // landed cost of consumed stock unit (FIFO)
}

// ─── 2.10 Customer ────────────────────────────────────────

export interface Customer {
  id: string;
  name: string;
  email: string;
  channelIds: Record<string, string>; // { ebay: "username", bricklink: "username" }
  qboCustomerId: string | null;
  blueBellMember: boolean;
  createdAt: string;
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
  externalPayoutId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Composite Types (for UI convenience) ─────────────────

/** Purchase batch with its line items and stock units */
export interface PurchaseBatchDetail extends PurchaseBatch {
  lineItems: (PurchaseLineItem & { units: StockUnit[] })[];
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
}

/** Order with its line items */
export interface OrderDetail extends Order {
  lineItems: OrderLineItem[];
  customer: Customer | null;
}
