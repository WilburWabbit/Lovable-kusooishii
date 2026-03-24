// ============================================================
// CSV Sync — Table Registry
// Per-table configuration for CSV export/import/diff/apply.
// Defines columns, modes, FK resolvers, and natural keys.
// ============================================================

import type { CsvTableConfig } from './types';

// ─── Validators ─────────────────────────────────────────────

const MPN_PATTERN = /^\d{4,6}-\d$/;

function isValidMpn(v: string): boolean {
  return MPN_PATTERN.test(v);
}

// ─── Registry ───────────────────────────────────────────────

export const tableRegistry: Record<string, CsvTableConfig> = {
  // ── 1. Purchase Batches ─────────────────────────────────
  purchase_batches: {
    tableName: 'purchase_batches',
    displayName: 'Purchase Batches',
    primaryKey: 'id',
    naturalKeys: ['id'],
    columns: [
      { dbColumn: 'id', csvHeader: 'id', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'supplier_name', csvHeader: 'supplier_name', type: 'string', mode: 'editable', required: true },
      { dbColumn: 'purchase_date', csvHeader: 'purchase_date', type: 'date', mode: 'editable', required: true },
      { dbColumn: 'reference', csvHeader: 'reference', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'supplier_vat_registered', csvHeader: 'supplier_vat_registered', type: 'boolean', mode: 'editable', required: false },
      { dbColumn: 'shared_costs', csvHeader: 'shared_costs', type: 'json', mode: 'editable', required: false },
      { dbColumn: 'total_shared_costs', csvHeader: 'total_shared_costs', type: 'number', mode: 'readonly', required: false },
      { dbColumn: 'status', csvHeader: 'status', type: 'enum', mode: 'editable', required: true, enumValues: ['draft', 'recorded'] },
      { dbColumn: 'unit_counter', csvHeader: 'unit_counter', type: 'number', mode: 'readonly', required: false },
      { dbColumn: 'created_at', csvHeader: 'created_at', type: 'date', mode: 'readonly', required: false },
      { dbColumn: 'updated_at', csvHeader: 'updated_at', type: 'date', mode: 'readonly', required: false },
    ],
    fkResolvers: [],
    exportOrderBy: 'created_at',
    allowDelete: false,
  },

  // ── 2. Purchase Line Items ──────────────────────────────
  purchase_line_items: {
    tableName: 'purchase_line_items',
    displayName: 'Purchase Line Items',
    primaryKey: 'id',
    naturalKeys: ['batch_id', 'mpn'],
    columns: [
      { dbColumn: 'id', csvHeader: 'id', type: 'string', mode: 'readonly', required: false },
      { dbColumn: 'batch_id', csvHeader: 'batch_id', type: 'string', mode: 'fk', required: true },
      { dbColumn: 'mpn', csvHeader: 'mpn', type: 'string', mode: 'editable', required: true },
      { dbColumn: 'quantity', csvHeader: 'quantity', type: 'number', mode: 'editable', required: true },
      { dbColumn: 'unit_cost', csvHeader: 'unit_cost', type: 'number', mode: 'editable', required: true },
      { dbColumn: 'apportioned_cost', csvHeader: 'apportioned_cost', type: 'number', mode: 'readonly', required: false },
      { dbColumn: 'landed_cost_per_unit', csvHeader: 'landed_cost_per_unit', type: 'number', mode: 'readonly', required: false },
      { dbColumn: 'created_at', csvHeader: 'created_at', type: 'date', mode: 'readonly', required: false },
    ],
    fkResolvers: [
      { fkColumn: 'batch_id', csvLookupColumn: 'batch_id', targetTable: 'purchase_batches', targetLookupColumn: 'id', targetPkColumn: 'id' },
    ],
    exportOrderBy: 'created_at',
    allowDelete: true,
    parentTable: 'purchase_batches',
  },

  // ── 3. Stock Units ──────────────────────────────────────
  stock_unit: {
    tableName: 'stock_unit',
    displayName: 'Stock Units',
    primaryKey: 'id',
    naturalKeys: ['uid'],
    columns: [
      { dbColumn: 'id', csvHeader: 'id', type: 'string', mode: 'readonly', required: false },
      { dbColumn: 'uid', csvHeader: 'uid', type: 'string', mode: 'readonly', required: false },
      { dbColumn: 'sku_id', csvHeader: 'sku_id', type: 'string', mode: 'fk', required: false },
      { dbColumn: 'mpn', csvHeader: 'mpn', type: 'string', mode: 'editable', required: true },
      { dbColumn: 'condition_grade', csvHeader: 'condition_grade', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'landed_cost', csvHeader: 'landed_cost', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'accumulated_impairment', csvHeader: 'accumulated_impairment', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'status', csvHeader: 'status', type: 'string', mode: 'readonly', required: false },
      { dbColumn: 'v2_status', csvHeader: 'v2_status', type: 'enum', mode: 'editable', required: false, enumValues: ['purchased', 'graded', 'listed', 'sold', 'shipped', 'delivered', 'payout_received', 'complete', 'return_pending', 'refunded', 'restocked', 'needs_allocation'] },
      { dbColumn: 'condition_flags', csvHeader: 'condition_flags', type: 'json', mode: 'editable', required: false },
      { dbColumn: 'notes', csvHeader: 'notes', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'batch_id', csvHeader: 'batch_id', type: 'string', mode: 'fk', required: false },
      { dbColumn: 'line_item_id', csvHeader: 'line_item_id', type: 'string', mode: 'fk', required: false },
      { dbColumn: 'order_id', csvHeader: 'order_id', type: 'string', mode: 'fk', required: false },
      { dbColumn: 'payout_id', csvHeader: 'payout_id', type: 'string', mode: 'fk', required: false },
      { dbColumn: 'graded_at', csvHeader: 'graded_at', type: 'date', mode: 'editable', required: false },
      { dbColumn: 'listed_at', csvHeader: 'listed_at', type: 'date', mode: 'editable', required: false },
      { dbColumn: 'sold_at', csvHeader: 'sold_at', type: 'date', mode: 'editable', required: false },
      { dbColumn: 'shipped_at', csvHeader: 'shipped_at', type: 'date', mode: 'editable', required: false },
      { dbColumn: 'delivered_at', csvHeader: 'delivered_at', type: 'date', mode: 'editable', required: false },
      { dbColumn: 'completed_at', csvHeader: 'completed_at', type: 'date', mode: 'editable', required: false },
      { dbColumn: 'created_at', csvHeader: 'created_at', type: 'date', mode: 'readonly', required: false },
      { dbColumn: 'updated_at', csvHeader: 'updated_at', type: 'date', mode: 'readonly', required: false },
    ],
    fkResolvers: [
      { fkColumn: 'batch_id', csvLookupColumn: 'batch_id', targetTable: 'purchase_batches', targetLookupColumn: 'id', targetPkColumn: 'id' },
      { fkColumn: 'sku_id', csvLookupColumn: 'sku_id', targetTable: 'sku', targetLookupColumn: 'sku_code', targetPkColumn: 'id' },
      { fkColumn: 'order_id', csvLookupColumn: 'order_id', targetTable: 'sales_order', targetLookupColumn: 'order_number', targetPkColumn: 'id' },
      { fkColumn: 'payout_id', csvLookupColumn: 'payout_id', targetTable: 'payouts', targetLookupColumn: 'external_payout_id', targetPkColumn: 'id' },
    ],
    exportOrderBy: 'created_at',
    allowDelete: false,
  },

  // ── 4. Products ─────────────────────────────────────────
  product: {
    tableName: 'product',
    displayName: 'Products',
    primaryKey: 'id',
    naturalKeys: ['mpn'],
    columns: [
      { dbColumn: 'id', csvHeader: 'id', type: 'string', mode: 'readonly', required: false },
      { dbColumn: 'mpn', csvHeader: 'mpn', type: 'string', mode: 'editable', required: true },
      { dbColumn: 'name', csvHeader: 'name', type: 'string', mode: 'editable', required: true },
      { dbColumn: 'theme_id', csvHeader: 'theme_id', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'subtheme_name', csvHeader: 'subtheme_name', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'product_type', csvHeader: 'product_type', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'piece_count', csvHeader: 'piece_count', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'release_year', csvHeader: 'release_year', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'retired_flag', csvHeader: 'retired_flag', type: 'boolean', mode: 'editable', required: false },
      { dbColumn: 'img_url', csvHeader: 'img_url', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'description', csvHeader: 'description', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'product_hook', csvHeader: 'product_hook', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'call_to_action', csvHeader: 'call_to_action', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'highlights', csvHeader: 'highlights', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'seo_title', csvHeader: 'seo_title', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'seo_description', csvHeader: 'seo_description', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'status', csvHeader: 'status', type: 'enum', mode: 'editable', required: false, enumValues: ['active', 'draft', 'archived'] },
      { dbColumn: 'set_number', csvHeader: 'set_number', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'dimensions_cm', csvHeader: 'dimensions_cm', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'weight_g', csvHeader: 'weight_g', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'age_mark', csvHeader: 'age_mark', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'ean', csvHeader: 'ean', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'retail_price', csvHeader: 'retail_price', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'minifigs_count', csvHeader: 'minifigs_count', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'released_date', csvHeader: 'released_date', type: 'date', mode: 'editable', required: false },
      { dbColumn: 'retired_date', csvHeader: 'retired_date', type: 'date', mode: 'editable', required: false },
      { dbColumn: 'field_overrides', csvHeader: 'field_overrides', type: 'json', mode: 'readonly', required: false },
      { dbColumn: 'created_at', csvHeader: 'created_at', type: 'date', mode: 'readonly', required: false },
      { dbColumn: 'updated_at', csvHeader: 'updated_at', type: 'date', mode: 'readonly', required: false },
    ],
    fkResolvers: [],
    exportOrderBy: 'mpn',
    allowDelete: false,
  },

  // ── 5. SKU ──────────────────────────────────────────────
  sku: {
    tableName: 'sku',
    displayName: 'SKUs',
    primaryKey: 'id',
    naturalKeys: ['sku_code'],
    columns: [
      { dbColumn: 'id', csvHeader: 'id', type: 'string', mode: 'readonly', required: false },
      { dbColumn: 'product_id', csvHeader: 'product_id', type: 'string', mode: 'fk', required: false },
      { dbColumn: 'sku_code', csvHeader: 'sku_code', type: 'string', mode: 'editable', required: true },
      { dbColumn: 'mpn', csvHeader: 'mpn', type: 'string', mode: 'editable', required: true },
      { dbColumn: 'condition_grade', csvHeader: 'condition_grade', type: 'number', mode: 'editable', required: true },
      { dbColumn: 'saleable_flag', csvHeader: 'saleable_flag', type: 'boolean', mode: 'editable', required: false },
      { dbColumn: 'active_flag', csvHeader: 'active_flag', type: 'boolean', mode: 'editable', required: false },
      { dbColumn: 'price', csvHeader: 'price', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'name', csvHeader: 'name', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'sale_price', csvHeader: 'sale_price', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'floor_price', csvHeader: 'floor_price', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'avg_cost', csvHeader: 'avg_cost', type: 'number', mode: 'readonly', required: false },
      { dbColumn: 'cost_range', csvHeader: 'cost_range', type: 'string', mode: 'readonly', required: false },
      { dbColumn: 'condition_notes', csvHeader: 'condition_notes', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'market_price', csvHeader: 'market_price', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'v2_markdown_applied', csvHeader: 'v2_markdown_applied', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'created_at', csvHeader: 'created_at', type: 'date', mode: 'readonly', required: false },
      { dbColumn: 'updated_at', csvHeader: 'updated_at', type: 'date', mode: 'readonly', required: false },
    ],
    fkResolvers: [
      { fkColumn: 'product_id', csvLookupColumn: 'product_id', targetTable: 'product', targetLookupColumn: 'mpn', targetPkColumn: 'id' },
    ],
    exportOrderBy: 'sku_code',
    allowDelete: false,
  },

  // ── 6. Channel Listings ─────────────────────────────────
  channel_listing: {
    tableName: 'channel_listing',
    displayName: 'Channel Listings',
    primaryKey: 'id',
    naturalKeys: ['sku_id', 'v2_channel'],
    columns: [
      { dbColumn: 'id', csvHeader: 'id', type: 'string', mode: 'readonly', required: false },
      { dbColumn: 'v2_channel', csvHeader: 'v2_channel', type: 'enum', mode: 'editable', required: true, enumValues: ['ebay', 'website', 'bricklink', 'brickowl'] },
      { dbColumn: 'external_sku', csvHeader: 'external_sku', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'external_listing_id', csvHeader: 'external_listing_id', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'sku_id', csvHeader: 'sku_id', type: 'string', mode: 'fk', required: true },
      { dbColumn: 'listed_price', csvHeader: 'listed_price', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'listed_quantity', csvHeader: 'listed_quantity', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'v2_status', csvHeader: 'v2_status', type: 'enum', mode: 'editable', required: false, enumValues: ['draft', 'live', 'paused', 'ended'] },
      { dbColumn: 'listing_title', csvHeader: 'listing_title', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'listing_description', csvHeader: 'listing_description', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'price_floor', csvHeader: 'price_floor', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'price_target', csvHeader: 'price_target', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'price_ceiling', csvHeader: 'price_ceiling', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'fee_adjusted_price', csvHeader: 'fee_adjusted_price', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'estimated_fees', csvHeader: 'estimated_fees', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'estimated_net', csvHeader: 'estimated_net', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'external_url', csvHeader: 'external_url', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'listed_at', csvHeader: 'listed_at', type: 'date', mode: 'editable', required: false },
      { dbColumn: 'created_at', csvHeader: 'created_at', type: 'date', mode: 'readonly', required: false },
      { dbColumn: 'updated_at', csvHeader: 'updated_at', type: 'date', mode: 'readonly', required: false },
    ],
    fkResolvers: [
      { fkColumn: 'sku_id', csvLookupColumn: 'sku_id', targetTable: 'sku', targetLookupColumn: 'sku_code', targetPkColumn: 'id' },
    ],
    exportOrderBy: 'created_at',
    allowDelete: true,
  },

  // ── 7. Sales Orders ─────────────────────────────────────
  sales_order: {
    tableName: 'sales_order',
    displayName: 'Sales Orders',
    primaryKey: 'id',
    naturalKeys: ['order_number'],
    columns: [
      { dbColumn: 'id', csvHeader: 'id', type: 'string', mode: 'readonly', required: false },
      { dbColumn: 'order_number', csvHeader: 'order_number', type: 'string', mode: 'readonly', required: false },
      { dbColumn: 'origin_channel', csvHeader: 'origin_channel', type: 'enum', mode: 'editable', required: false, enumValues: ['web', 'ebay', 'bricklink', 'brickowl', 'in_person'] },
      { dbColumn: 'origin_reference', csvHeader: 'origin_reference', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'customer_id', csvHeader: 'customer_id', type: 'string', mode: 'fk', required: false },
      { dbColumn: 'guest_email', csvHeader: 'guest_email', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'guest_name', csvHeader: 'guest_name', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'v2_status', csvHeader: 'v2_status', type: 'enum', mode: 'editable', required: false, enumValues: ['needs_allocation', 'new', 'awaiting_shipment', 'shipped', 'delivered', 'complete', 'return_pending'] },
      { dbColumn: 'currency', csvHeader: 'currency', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'merchandise_subtotal', csvHeader: 'merchandise_subtotal', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'discount_total', csvHeader: 'discount_total', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'shipping_total', csvHeader: 'shipping_total', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'tax_total', csvHeader: 'tax_total', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'gross_total', csvHeader: 'gross_total', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'vat_amount', csvHeader: 'vat_amount', type: 'number', mode: 'readonly', required: false },
      { dbColumn: 'net_amount', csvHeader: 'net_amount', type: 'number', mode: 'readonly', required: false },
      { dbColumn: 'payment_method', csvHeader: 'payment_method', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'payment_reference', csvHeader: 'payment_reference', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'carrier', csvHeader: 'carrier', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'tracking_number', csvHeader: 'tracking_number', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'shipping_name', csvHeader: 'shipping_name', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'shipping_line_1', csvHeader: 'shipping_line_1', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'shipping_line_2', csvHeader: 'shipping_line_2', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'shipping_city', csvHeader: 'shipping_city', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'shipping_county', csvHeader: 'shipping_county', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'shipping_postcode', csvHeader: 'shipping_postcode', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'shipping_country', csvHeader: 'shipping_country', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'notes', csvHeader: 'notes', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'blue_bell_club', csvHeader: 'blue_bell_club', type: 'boolean', mode: 'editable', required: false },
      { dbColumn: 'external_order_id', csvHeader: 'external_order_id', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'shipped_date', csvHeader: 'shipped_date', type: 'date', mode: 'editable', required: false },
      { dbColumn: 'shipped_via', csvHeader: 'shipped_via', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'qbo_sync_status', csvHeader: 'qbo_sync_status', type: 'enum', mode: 'editable', required: false, enumValues: ['pending', 'synced', 'error'] },
      { dbColumn: 'created_at', csvHeader: 'created_at', type: 'date', mode: 'readonly', required: false },
      { dbColumn: 'updated_at', csvHeader: 'updated_at', type: 'date', mode: 'readonly', required: false },
    ],
    fkResolvers: [
      { fkColumn: 'customer_id', csvLookupColumn: 'customer_id', targetTable: 'customer', targetLookupColumn: 'email', targetPkColumn: 'id' },
    ],
    exportOrderBy: 'created_at',
    allowDelete: false,
  },

  // ── 8. Sales Order Lines ────────────────────────────────
  sales_order_line: {
    tableName: 'sales_order_line',
    displayName: 'Sales Order Lines',
    primaryKey: 'id',
    naturalKeys: ['sales_order_id', 'sku_id'],
    columns: [
      { dbColumn: 'id', csvHeader: 'id', type: 'string', mode: 'readonly', required: false },
      { dbColumn: 'sales_order_id', csvHeader: 'sales_order_id', type: 'string', mode: 'fk', required: true },
      { dbColumn: 'sku_id', csvHeader: 'sku_id', type: 'string', mode: 'fk', required: false },
      { dbColumn: 'stock_unit_id', csvHeader: 'stock_unit_id', type: 'string', mode: 'fk', required: false },
      { dbColumn: 'quantity', csvHeader: 'quantity', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'unit_price', csvHeader: 'unit_price', type: 'number', mode: 'editable', required: true },
      { dbColumn: 'line_discount', csvHeader: 'line_discount', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'line_total', csvHeader: 'line_total', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'cogs', csvHeader: 'cogs', type: 'number', mode: 'readonly', required: false },
      { dbColumn: 'created_at', csvHeader: 'created_at', type: 'date', mode: 'readonly', required: false },
    ],
    fkResolvers: [
      { fkColumn: 'sales_order_id', csvLookupColumn: 'sales_order_id', targetTable: 'sales_order', targetLookupColumn: 'order_number', targetPkColumn: 'id' },
      { fkColumn: 'sku_id', csvLookupColumn: 'sku_id', targetTable: 'sku', targetLookupColumn: 'sku_code', targetPkColumn: 'id' },
      { fkColumn: 'stock_unit_id', csvLookupColumn: 'stock_unit_id', targetTable: 'stock_unit', targetLookupColumn: 'uid', targetPkColumn: 'id' },
    ],
    exportOrderBy: 'created_at',
    allowDelete: true,
    parentTable: 'sales_order',
  },

  // ── 9. Customers ────────────────────────────────────────
  customer: {
    tableName: 'customer',
    displayName: 'Customers',
    primaryKey: 'id',
    naturalKeys: ['email'],
    columns: [
      { dbColumn: 'id', csvHeader: 'id', type: 'string', mode: 'readonly', required: false },
      { dbColumn: 'qbo_customer_id', csvHeader: 'qbo_customer_id', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'display_name', csvHeader: 'display_name', type: 'string', mode: 'editable', required: true },
      { dbColumn: 'email', csvHeader: 'email', type: 'string', mode: 'editable', required: true },
      { dbColumn: 'phone', csvHeader: 'phone', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'mobile', csvHeader: 'mobile', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'billing_line_1', csvHeader: 'billing_line_1', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'billing_line_2', csvHeader: 'billing_line_2', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'billing_city', csvHeader: 'billing_city', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'billing_county', csvHeader: 'billing_county', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'billing_postcode', csvHeader: 'billing_postcode', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'billing_country', csvHeader: 'billing_country', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'notes', csvHeader: 'notes', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'active', csvHeader: 'active', type: 'boolean', mode: 'editable', required: false },
      { dbColumn: 'channel_ids', csvHeader: 'channel_ids', type: 'json', mode: 'editable', required: false },
      { dbColumn: 'blue_bell_member', csvHeader: 'blue_bell_member', type: 'boolean', mode: 'editable', required: false },
      { dbColumn: 'created_at', csvHeader: 'created_at', type: 'date', mode: 'readonly', required: false },
      { dbColumn: 'updated_at', csvHeader: 'updated_at', type: 'date', mode: 'readonly', required: false },
    ],
    fkResolvers: [],
    exportOrderBy: 'display_name',
    allowDelete: false,
  },

  // ── 10. Payouts ─────────────────────────────────────────
  payouts: {
    tableName: 'payouts',
    displayName: 'Payouts',
    primaryKey: 'id',
    naturalKeys: ['external_payout_id'],
    columns: [
      { dbColumn: 'id', csvHeader: 'id', type: 'string', mode: 'readonly', required: false },
      { dbColumn: 'channel', csvHeader: 'channel', type: 'enum', mode: 'editable', required: true, enumValues: ['ebay', 'stripe'] },
      { dbColumn: 'payout_date', csvHeader: 'payout_date', type: 'date', mode: 'editable', required: true },
      { dbColumn: 'gross_amount', csvHeader: 'gross_amount', type: 'number', mode: 'editable', required: true },
      { dbColumn: 'total_fees', csvHeader: 'total_fees', type: 'number', mode: 'editable', required: true },
      { dbColumn: 'net_amount', csvHeader: 'net_amount', type: 'number', mode: 'editable', required: true },
      { dbColumn: 'fee_breakdown', csvHeader: 'fee_breakdown', type: 'json', mode: 'editable', required: false },
      { dbColumn: 'order_count', csvHeader: 'order_count', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'unit_count', csvHeader: 'unit_count', type: 'number', mode: 'editable', required: false },
      { dbColumn: 'qbo_deposit_id', csvHeader: 'qbo_deposit_id', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'qbo_expense_id', csvHeader: 'qbo_expense_id', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'qbo_sync_status', csvHeader: 'qbo_sync_status', type: 'enum', mode: 'editable', required: false, enumValues: ['pending', 'synced', 'error'] },
      { dbColumn: 'external_payout_id', csvHeader: 'external_payout_id', type: 'string', mode: 'editable', required: true },
      { dbColumn: 'notes', csvHeader: 'notes', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'reconciliation_status', csvHeader: 'reconciliation_status', type: 'enum', mode: 'editable', required: false, enumValues: ['pending', 'matched', 'partial', 'unmatched'] },
      { dbColumn: 'created_at', csvHeader: 'created_at', type: 'date', mode: 'readonly', required: false },
      { dbColumn: 'updated_at', csvHeader: 'updated_at', type: 'date', mode: 'readonly', required: false },
    ],
    fkResolvers: [],
    exportOrderBy: 'payout_date',
    allowDelete: false,
  },

  // ── 11. Payout Orders ───────────────────────────────────
  payout_orders: {
    tableName: 'payout_orders',
    displayName: 'Payout Orders',
    primaryKey: 'id',
    naturalKeys: ['payout_id', 'sales_order_id'],
    columns: [
      { dbColumn: 'id', csvHeader: 'id', type: 'string', mode: 'readonly', required: false },
      { dbColumn: 'payout_id', csvHeader: 'payout_id', type: 'string', mode: 'fk', required: true },
      { dbColumn: 'sales_order_id', csvHeader: 'sales_order_id', type: 'string', mode: 'fk', required: true },
      { dbColumn: 'order_gross', csvHeader: 'order_gross', type: 'number', mode: 'editable', required: true },
      { dbColumn: 'order_fees', csvHeader: 'order_fees', type: 'number', mode: 'editable', required: true },
      { dbColumn: 'order_net', csvHeader: 'order_net', type: 'number', mode: 'editable', required: true },
      { dbColumn: 'created_at', csvHeader: 'created_at', type: 'date', mode: 'readonly', required: false },
    ],
    fkResolvers: [
      { fkColumn: 'payout_id', csvLookupColumn: 'payout_id', targetTable: 'payouts', targetLookupColumn: 'external_payout_id', targetPkColumn: 'id' },
      { fkColumn: 'sales_order_id', csvLookupColumn: 'sales_order_id', targetTable: 'sales_order', targetLookupColumn: 'order_number', targetPkColumn: 'id' },
    ],
    exportOrderBy: 'created_at',
    allowDelete: true,
    parentTable: 'payouts',
  },

  // ── 12. Landing Raw eBay Payout ─────────────────────────
  landing_raw_ebay_payout: {
    tableName: 'landing_raw_ebay_payout',
    displayName: 'eBay Payout Landing',
    primaryKey: 'id',
    naturalKeys: ['external_id'],
    columns: [
      { dbColumn: 'id', csvHeader: 'id', type: 'string', mode: 'readonly', required: false },
      { dbColumn: 'external_id', csvHeader: 'external_id', type: 'string', mode: 'editable', required: true },
      { dbColumn: 'raw_payload', csvHeader: 'raw_payload', type: 'json', mode: 'editable', required: true },
      { dbColumn: 'status', csvHeader: 'status', type: 'enum', mode: 'editable', required: false, enumValues: ['pending', 'processed', 'error'] },
      { dbColumn: 'error_message', csvHeader: 'error_message', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'correlation_id', csvHeader: 'correlation_id', type: 'string', mode: 'editable', required: false },
      { dbColumn: 'received_at', csvHeader: 'received_at', type: 'date', mode: 'readonly', required: false },
      { dbColumn: 'processed_at', csvHeader: 'processed_at', type: 'date', mode: 'readonly', required: false },
    ],
    fkResolvers: [],
    exportOrderBy: 'received_at',
    allowDelete: true,
  },
};

/** Get config for a table, throwing if not found */
export function getTableConfig(tableName: string): CsvTableConfig {
  const config = tableRegistry[tableName];
  if (!config) {
    throw new Error(`Unknown table: ${tableName}. Valid tables: ${Object.keys(tableRegistry).join(', ')}`);
  }
  return config;
}

/** Get list of all syncable table names */
export function getSyncableTableNames(): string[] {
  return Object.keys(tableRegistry);
}

/** Get editable columns for a table */
export function getEditableColumns(tableName: string): string[] {
  const config = getTableConfig(tableName);
  return config.columns
    .filter(c => c.mode === 'editable' || c.mode === 'fk')
    .map(c => c.dbColumn);
}

/** Get export column headers for a table */
export function getExportHeaders(tableName: string): string[] {
  const config = getTableConfig(tableName);
  return config.columns.map(c => c.csvHeader);
}
