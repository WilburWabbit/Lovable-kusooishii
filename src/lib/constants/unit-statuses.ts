// ============================================================
// Admin V2 — Status Constants, Colour Mappings, Condition Flags
// Source: wireframe UNIT_STATUSES (docs/v2/kuso-hub-v2.jsx)
// ============================================================

import type {
  StockUnitStatus,
  OrderStatus,
  ChannelListingStatus,
  ConditionGrade,
  ConditionFlag,
} from '../types/admin';

// ─── Stock Unit Statuses ────────────────────────────────────

export const UNIT_STATUSES: Record<StockUnitStatus, { label: string; color: string }> = {
  purchased:        { label: 'Purchased',        color: '#71717A' },
  graded:           { label: 'Graded',           color: '#F59E0B' },
  listed:           { label: 'Listed',           color: '#3B82F6' },
  sold:             { label: 'Sold',             color: '#A855F7' },
  shipped:          { label: 'Shipped',          color: '#14B8A6' },
  delivered:        { label: 'Delivered',        color: '#22C55E' },
  payout_received:  { label: 'Payout Received',  color: '#22C55E' },
  complete:         { label: 'Complete',         color: '#71717A' },
  return_pending:   { label: 'Return Pending',   color: '#EF4444' },
  refunded:         { label: 'Refunded',         color: '#EF4444' },
  restocked:        { label: 'Restocked',        color: '#F59E0B' },
  needs_allocation: { label: 'Needs Allocation', color: '#F59E0B' },
};

// ─── Order Statuses ─────────────────────────────────────────

export const ORDER_STATUSES: Record<OrderStatus, { label: string; color: string }> = {
  needs_allocation:  { label: 'Needs Allocation',  color: '#F59E0B' },
  new:               { label: 'New',                color: '#3B82F6' },
  awaiting_shipment: { label: 'Awaiting Shipment',  color: '#A855F7' },
  shipped:           { label: 'Shipped',            color: '#14B8A6' },
  delivered:         { label: 'Delivered',          color: '#22C55E' },
  complete:          { label: 'Complete',           color: '#71717A' },
  return_pending:    { label: 'Return Pending',     color: '#EF4444' },
  refunded:          { label: 'Refunded',           color: '#EF4444' },
  cancelled:         { label: 'Cancelled',          color: '#71717A' },
};

// ─── Channel Listing Statuses ───────────────────────────────

export const CHANNEL_LISTING_STATUSES: Record<ChannelListingStatus, { label: string; color: string }> = {
  draft:  { label: 'Draft',  color: '#71717A' },
  live:   { label: 'Live',   color: '#22C55E' },
  paused: { label: 'Paused', color: '#F59E0B' },
  ended:  { label: 'Ended',  color: '#71717A' },
};

// ─── Grade Colours ──────────────────────────────────────────

export const GRADE_COLORS: Record<ConditionGrade, string> = {
  1: '#FFD700', // Gold
  2: '#C0C0C0', // Silver
  3: '#CD7F32', // Bronze
  4: '#71717A', // Dim
  5: '#DC2626', // Red
};

// ─── Condition Flags ────────────────────────────────────────

export const CONDITION_FLAGS: { value: ConditionFlag; label: string }[] = [
  { value: 'resealed',             label: 'Resealed' },
  { value: 'shelf_wear',           label: 'Shelf wear' },
  { value: 'box_dent',             label: 'Box dent' },
  { value: 'box_crush',            label: 'Box crush' },
  { value: 'missing_outer_carton', label: 'Missing outer carton' },
  { value: 'bags_opened',          label: 'Bags opened' },
  { value: 'parts_verified',       label: 'Parts verified' },
  { value: 'sun_yellowing',        label: 'Sun yellowing' },
  { value: 'price_sticker_residue', label: 'Price sticker residue' },
  { value: 'stickers_applied',    label: 'Stickers applied' },
  { value: 'missing_minifigs',    label: 'Missing minifigs' },
  { value: 'missing_instructions', label: 'Missing instructions' },
];

// ─── Lifecycle Progression ──────────────────────────────────

/** Valid next statuses for each stock unit status (forward flow only). */
export const UNIT_STATUS_TRANSITIONS: Partial<Record<StockUnitStatus, StockUnitStatus[]>> = {
  purchased:        ['graded'],
  graded:           ['listed'],
  listed:           ['sold'],
  sold:             ['shipped', 'return_pending'],
  shipped:          ['delivered', 'return_pending'],
  delivered:        ['payout_received', 'return_pending'],
  payout_received:  ['complete'],
  return_pending:   ['refunded', 'restocked'],
  restocked:        ['listed'],
};
