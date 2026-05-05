// Redeployed: 2026-03-23
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { buildGmcCheckoutLink } from "../_shared/gmc-product-input.ts";

class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ValidationError"; }
}

const STOCK_MATCHABLE = ["available", "received", "graded"];
const SALEABLE_STOCK_V2_STATUSES = ["graded", "listed", "restocked"];
const SALEABLE_STOCK_STATUSES = ["available", "received", "graded", "listed", "restocked"];
const VALID_SALE_STATUSES = ["complete", "paid", "shipped", "packed", "picking", "awaiting_dispatch"];
const CHANNELS_PENDING_OUTBOUND_CONNECTOR = new Set(["bricklink", "brickowl"]);

function isAvailableStockUnit(unit: { status?: string | null; v2_status?: string | null }): boolean {
  const status = unit.status ?? "";
  const v2Status = unit.v2_status ?? "";
  return STOCK_MATCHABLE.includes(status) && !["sold", "written_off"].includes(v2Status);
}

type ChannelListingActionRow = {
  id: string;
  sku_id: string | null;
  channel: string | null;
  v2_channel: string | null;
  v2_status: string | null;
  offer_status: string | null;
  listed_quantity: number | null;
  external_listing_id: string | null;
  external_sku: string | null;
  availability_override: string | null;
  availability_override_at: string | null;
  availability_override_by: string | null;
  synced_at: string | null;
};

const CHANNEL_ACTION_SELECT =
  "id, sku_id, channel, v2_channel, v2_status, offer_status, listed_quantity, external_listing_id, external_sku, availability_override, availability_override_at, availability_override_by, synced_at";

function normalizeListingChannel(listing: Pick<ChannelListingActionRow, "channel" | "v2_channel">): string {
  const raw = (listing.channel ?? listing.v2_channel ?? "website").toLowerCase();
  if (raw === "website") return "web";
  return raw;
}

function isWebsiteListing(listing: Pick<ChannelListingActionRow, "channel" | "v2_channel">): boolean {
  return normalizeListingChannel(listing) === "web";
}

async function countSaleableStock(admin: any, skuId: string): Promise<number> {
  const { count, error } = await admin
    .from("stock_unit")
    .select("id", { count: "exact", head: true })
    .eq("sku_id", skuId)
    .in("v2_status", SALEABLE_STOCK_V2_STATUSES);

  if (error) throw error;
  return count ?? 0;
}

async function fetchChannelListingForAction(admin: any, listingId: string): Promise<ChannelListingActionRow> {
  const { data, error } = await admin
    .from("channel_listing")
    .select(CHANNEL_ACTION_SELECT)
    .eq("id", listingId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new ValidationError("channel listing not found");
  return data as ChannelListingActionRow;
}

async function queueChannelListingCommand(
  admin: any,
  listingId: string,
  commandType: "sync_quantity" | "end",
  userId: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc("queue_listing_command", {
    p_channel_listing_id: listingId,
    p_command_type: commandType,
    p_actor_id: userId,
  });

  if (error) throw error;
  return data ?? null;
}

async function findGmcListingsForSku(admin: any, skuId: string): Promise<ChannelListingActionRow[]> {
  const { data, error } = await admin
    .from("channel_listing")
    .select(CHANNEL_ACTION_SELECT)
    .eq("sku_id", skuId)
    .in("channel", ["google_shopping", "gmc"]);

  if (error) throw error;
  return (data ?? []) as ChannelListingActionRow[];
}

async function cascadeWebsiteAvailabilityToGmc(
  admin: any,
  websiteListing: ChannelListingActionRow,
  action: "manual_out_of_stock" | "clear_out_of_stock" | "delist",
  userId: string,
  now: string,
): Promise<string[]> {
  if (!isWebsiteListing(websiteListing) || !websiteListing.sku_id) return [];

  const gmcListings = await findGmcListingsForSku(admin, websiteListing.sku_id);
  const commandIds: string[] = [];
  const restoredQuantity = action === "clear_out_of_stock"
    ? await countSaleableStock(admin, websiteListing.sku_id)
    : 0;

  for (const gmcListing of gmcListings) {
    if (action === "manual_out_of_stock") {
      const { error } = await admin
        .from("channel_listing")
        .update({
          availability_override: "manual_out_of_stock",
          availability_override_at: now,
          availability_override_by: userId,
          listed_quantity: 0,
          offer_status: "OUT_OF_STOCK",
          synced_at: now,
        })
        .eq("id", gmcListing.id);
      if (error) throw error;

      const commandId = await queueChannelListingCommand(admin, gmcListing.id, "sync_quantity", userId);
      if (commandId) commandIds.push(commandId);
      const after = await fetchChannelListingForAction(admin, gmcListing.id);
      await auditChannelAvailabilityAction(
        admin,
        userId,
        "gmc_out_of_stock_cascaded_from_website",
        gmcListing,
        after,
        commandId,
        [],
      );
      continue;
    }

    if (action === "clear_out_of_stock") {
      const { error } = await admin
        .from("channel_listing")
        .update({
          availability_override: null,
          availability_override_at: null,
          availability_override_by: null,
          listed_quantity: restoredQuantity,
          offer_status: "PUBLISHED",
          synced_at: now,
        })
        .eq("id", gmcListing.id);
      if (error) throw error;

      const commandId = await queueChannelListingCommand(admin, gmcListing.id, "sync_quantity", userId);
      if (commandId) commandIds.push(commandId);
      const after = await fetchChannelListingForAction(admin, gmcListing.id);
      await auditChannelAvailabilityAction(
        admin,
        userId,
        "gmc_out_of_stock_clear_cascaded_from_website",
        gmcListing,
        after,
        commandId,
        [],
      );
      continue;
    }

    const { error } = await admin
      .from("channel_listing")
      .update({
        availability_override: null,
        availability_override_at: null,
        availability_override_by: null,
        listed_quantity: 0,
        offer_status: "END_QUEUED",
        synced_at: now,
      })
      .eq("id", gmcListing.id);
    if (error) throw error;

    const commandId = await queueChannelListingCommand(admin, gmcListing.id, "end", userId);
    if (commandId) commandIds.push(commandId);
    const after = await fetchChannelListingForAction(admin, gmcListing.id);
    await auditChannelAvailabilityAction(
      admin,
      userId,
      "gmc_delist_cascaded_from_website",
      gmcListing,
      after,
      commandId,
      [],
    );
  }

  return commandIds;
}

async function auditChannelAvailabilityAction(
  admin: any,
  userId: string,
  triggerType: string,
  before: ChannelListingActionRow,
  after: ChannelListingActionRow,
  commandId: string | null,
  cascadedCommandIds: string[],
) {
  const { error } = await admin.from("audit_event").insert({
    entity_type: "channel_listing",
    entity_id: after.id,
    trigger_type: triggerType,
    actor_type: "user",
    actor_id: userId,
    source_system: "admin-data",
    before_json: before,
    after_json: after,
    output_json: {
      command_id: commandId,
      cascaded_gmc_command_ids: cascadedCommandIds,
    },
  });

  if (error) throw error;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeCommerceChannel(channel: string | null | undefined): string {
  return channel === "website" ? "web" : (channel ?? "web");
}

function normalizeQuote(raw: unknown, skuId: string, channel: string) {
  const quote = (raw ?? {}) as Record<string, unknown>;
  const feeComponents = (quote.fee_components ?? {}) as Record<string, unknown>;
  return {
    sku_id: String(quote.sku_id ?? skuId),
    sku_code: quote.sku_code ?? null,
    channel: String(quote.channel ?? channel),
    floor_price: quote.floor_price == null ? null : Number(quote.floor_price),
    target_price: quote.target_price == null ? null : Number(quote.target_price),
    ceiling_price: quote.ceiling_price == null ? null : Number(quote.ceiling_price),
    estimated_fees: quote.estimated_fees == null
      ? (feeComponents.estimated_fees == null ? null : Number(feeComponents.estimated_fees))
      : Number(quote.estimated_fees),
    estimated_net: quote.estimated_net == null ? null : Number(quote.estimated_net),
    cost_base: quote.cost_base == null ? null : Number(quote.cost_base),
    carrying_value: quote.carrying_value == null
      ? (quote.cogs_or_carrying_value == null ? null : Number(quote.cogs_or_carrying_value))
      : Number(quote.carrying_value),
    average_carrying_value: quote.average_carrying_value == null ? null : Number(quote.average_carrying_value),
    stock_unit_count: quote.stock_unit_count == null ? 0 : Number(quote.stock_unit_count),
    market_consensus: quote.market_consensus == null
      ? (quote.market_consensus_price == null ? null : Number(quote.market_consensus_price))
      : Number(quote.market_consensus),
    condition_multiplier: quote.condition_multiplier == null ? null : Number(quote.condition_multiplier),
    confidence_score: quote.confidence_score == null
      ? (quote.confidence == null ? null : Number(quote.confidence))
      : Number(quote.confidence_score),
    blocking_reasons: Array.isArray(quote.blocking_reasons) ? quote.blocking_reasons : [],
    warning_reasons: Array.isArray(quote.warning_reasons) ? quote.warning_reasons : [],
    cost_basis: quote.cost_basis ?? null,
    floor_contributors: Array.isArray(quote.floor_contributors) ? quote.floor_contributors : [],
    target_contributors: Array.isArray(quote.target_contributors) ? quote.target_contributors : [],
    breakdown: quote.breakdown ?? {},
    raw_quote: quote,
  };
}

async function buildWebsiteListingPreflight(
  admin: any,
  skuId: string,
  listedPrice?: number | null,
) {
  const { data: sku, error: skuErr } = await admin
    .from("sku")
    .select("id, sku_code, active_flag, saleable_flag")
    .eq("id", skuId)
    .single();
  if (skuErr || !sku) throw new ValidationError("SKU not found");

  const { data: stockUnits, error: stockErr } = await admin
    .from("stock_unit")
    .select("id, status, v2_status")
    .eq("sku_id", skuId);
  if (stockErr) throw stockErr;

  const saleableStockCount = (stockUnits ?? []).filter((unit: Record<string, unknown>) => {
    const status = String(unit.v2_status ?? unit.status ?? "");
    return SALEABLE_STOCK_STATUSES.includes(status);
  }).length;

  const { data: rawQuote, error: quoteErr } = await admin.rpc("commerce_quote_price", {
    p_sku_id: skuId,
    p_channel: "web",
    p_candidate_price: listedPrice && listedPrice > 0 ? listedPrice : null,
  });
  if (quoteErr) throw quoteErr;
  const quote = normalizeQuote(rawQuote, skuId, "web");

  const targetPrice = Number(quote.target_price ?? 0);
  const floorPrice = Number(quote.floor_price ?? 0);
  const finalPrice = listedPrice && listedPrice > 0 ? listedPrice : targetPrice;
  const blockers: string[] = [];
  const actions: string[] = [];

  if (saleableStockCount <= 0) {
    blockers.push("No saleable stock is available. Receive and grade stock before publishing.");
    actions.push("receive_stock");
  }
  if (!sku.active_flag) {
    blockers.push("SKU is inactive. Activate it before website publish.");
    actions.push("activate_sku");
  }
  if (!sku.saleable_flag) {
    blockers.push("SKU is not marked saleable.");
    actions.push("activate_sku");
  }
  if (!finalPrice || finalPrice <= 0) {
    blockers.push("No valid website target price is available. Recalculate pricing first.");
    actions.push("recalculate_price");
  }
  if (floorPrice > 0 && finalPrice > 0 && finalPrice < floorPrice) {
    blockers.push(`Website price £${finalPrice.toFixed(2)} is below floor £${floorPrice.toFixed(2)}.`);
    actions.push("set_price");
  }

  return {
    sku_id: skuId,
    sku_code: sku.sku_code,
    channel: "web",
    can_publish: blockers.length === 0,
    action_state: blockers.length === 0 ? "publish" : actions[0],
    actions: [...new Set(actions)],
    blockers,
    warnings: quote.warning_reasons,
    saleable_stock_count: saleableStockCount,
    active_flag: Boolean(sku.active_flag),
    saleable_flag: Boolean(sku.saleable_flag),
    final_price: finalPrice > 0 ? Math.round(finalPrice * 100) / 100 : null,
    quote,
  };
}

const PRICE_TRANSPARENCY_CHANNELS = ["web", "ebay", "bricklink", "brickowl"];

function normalizedPriceChannel(channel: string | null | undefined): string {
  if (!channel) return "web";
  return channel === "website" ? "web" : channel;
}

function mapByKey<T>(rows: T[], keyFn: (row: T) => string | null | undefined): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = keyFn(row);
    if (key) map.set(key, row);
  }
  return map;
}

async function buildPriceTransparency(admin: any, params: Record<string, unknown>) {
  const mpn = typeof params.mpn === "string" ? params.mpn.trim() : "";
  const skuIdFilter = typeof params.sku_id === "string" ? params.sku_id : null;
  const channelFilter = typeof params.channel === "string" ? normalizedPriceChannel(params.channel) : null;
  if (!mpn && !skuIdFilter) throw new ValidationError("mpn or sku_id is required");

  let product: Record<string, unknown> | null = null;
  let skuQuery = admin
    .from("sku")
    .select("id, sku_code, mpn, condition_grade, product_id, active_flag, saleable_flag, product:product_id(id, mpn, name, theme:theme_id(name))")
    .order("sku_code");

  if (skuIdFilter) {
    skuQuery = skuQuery.eq("id", skuIdFilter);
  } else {
    const { data: productRow, error: productErr } = await admin
      .from("product")
      .select("id, mpn, name, theme:theme_id(name)")
      .eq("mpn", mpn)
      .maybeSingle();
    if (productErr) throw productErr;
    if (!productRow) throw new ValidationError(`Product ${mpn} not found`);
    product = productRow;
    skuQuery = skuQuery.eq("product_id", productRow.id);
  }

  const { data: skuRows, error: skuErr } = await skuQuery;
  if (skuErr) throw skuErr;
  const skus = (skuRows ?? []) as Array<Record<string, any>>;
  if (skus.length === 0) throw new ValidationError("No SKUs found for price transparency");
  if (!product) {
    const joined = Array.isArray(skus[0].product) ? skus[0].product[0] : skus[0].product;
    product = joined ?? null;
  }

  const skuIds = skus.map((sku) => sku.id as string);
  const channels = channelFilter ? [channelFilter] : PRICE_TRANSPARENCY_CHANNELS;

  const [listingRes, snapshotRes, overrideRes, marketRes] = await Promise.all([
    admin
      .from("channel_listing")
      .select("id, sku_id, channel, v2_channel, v2_status, offer_status, listed_price, listed_quantity, external_listing_id, external_url, current_price_decision_snapshot_id, listed_at, updated_at, created_at")
      .in("sku_id", skuIds),
    admin
      .from("price_decision_snapshot")
      .select("*")
      .in("sku_id", skuIds)
      .in("channel", channels)
      .order("created_at", { ascending: false }),
    admin
      .from("price_override")
      .select("*")
      .in("sku_id", skuIds)
      .in("channel", channels)
      .order("created_at", { ascending: false }),
    admin
      .from("market_price_snapshot")
      .select("id, sku_id, source_id, channel, price, confidence_score, freshness_score, sample_size, captured_at, source:source_id(source_code, name)")
      .in("sku_id", skuIds)
      .order("captured_at", { ascending: false })
      .limit(300),
  ]);
  if (listingRes.error) throw listingRes.error;
  if (snapshotRes.error) throw snapshotRes.error;
  if (overrideRes.error) throw overrideRes.error;
  if (marketRes.error) throw marketRes.error;

  const listings: Array<Record<string, any> & { normalized_channel: string }> = ((listingRes.data ?? []) as Array<Record<string, any>>)
    .map((row) => ({ ...row, normalized_channel: normalizedPriceChannel(row.channel ?? row.v2_channel) }))
    .sort((a, b) => {
      const liveDiff = (a.v2_status === "live" ? 0 : 1) - (b.v2_status === "live" ? 0 : 1);
      if (liveDiff !== 0) return liveDiff;
      return new Date(b.listed_at ?? b.updated_at ?? b.created_at ?? 0).getTime()
        - new Date(a.listed_at ?? a.updated_at ?? a.created_at ?? 0).getTime();
    });
  const snapshots = (snapshotRes.data ?? []) as Array<Record<string, any>>;
  const overrides = (overrideRes.data ?? []) as Array<Record<string, any>>;
  const marketRows = (marketRes.data ?? []) as Array<Record<string, any>>;

  const listingBySkuChannel = mapByKey(listings, (row) => `${row.sku_id}:${row.normalized_channel}`);
  const snapshotBySkuChannel = mapByKey(snapshots, (row) => `${row.sku_id}:${row.channel}`);
  const overrideBySkuChannel = mapByKey(overrides, (row) => `${row.sku_id}:${row.channel}`);

  const variants = [];
  let confidenceTotal = 0;
  let confidenceCount = 0;
  let overrideCount = 0;
  let staleSnapshotCount = 0;
  let latestPricedAt: string | null = null;
  let marketTotal = 0;
  let marketCount = 0;
  const gradeSet = new Set<string>();
  const sourceSet = new Set<string>();

  for (const sku of skus) {
    const grade = String(sku.condition_grade ?? "");
    if (grade) gradeSet.add(grade);
    const channelRows = [];

    for (const channel of channels) {
      const { data: rawQuote, error: quoteErr } = await admin.rpc("commerce_quote_price", {
        p_sku_id: sku.id,
        p_channel: channel,
        p_candidate_price: null,
      });
      if (quoteErr) throw quoteErr;
      const quote = normalizeQuote(rawQuote, sku.id, channel);
      const listing = listingBySkuChannel.get(`${sku.id}:${channel}`) ?? null;
      const snapshot = snapshotBySkuChannel.get(`${sku.id}:${channel}`) ?? null;
      const override = overrideBySkuChannel.get(`${sku.id}:${channel}`) ?? null;
      const floor = Number(quote.floor_price ?? snapshot?.floor_price ?? 0);
      const listedPrice = listing?.listed_price == null ? null : Number(listing.listed_price);
      const finalPrice = listedPrice ?? (quote.target_price == null ? null : Number(quote.target_price));
      const confidence = quote.confidence_score == null ? null : Number(quote.confidence_score);
      const pricedAt = snapshot?.created_at ?? null;
      const ageHours = pricedAt ? Math.max(0, (Date.now() - new Date(pricedAt).getTime()) / 36e5) : null;
      const isStale = ageHours == null || ageHours > 72;
      const belowFloor = finalPrice != null && floor > 0 && finalPrice < floor;
      const manual = Boolean(override) || (listedPrice != null && quote.target_price != null && Math.abs(listedPrice - Number(quote.target_price)) >= 0.01);
      const overrideStatus = override
        ? (override.override_type === "below_floor" ? "Below floor" : "Manual")
        : belowFloor
          ? "Below floor"
          : manual
            ? "Manual"
            : isStale
              ? "Stale snapshot"
              : "Auto";
      const relatedMarket = marketRows
        .filter((row) => row.sku_id === sku.id && [channel, "all", "legacy"].includes(row.channel))
        .slice(0, 8);

      if (confidence != null) {
        confidenceTotal += confidence;
        confidenceCount += 1;
      }
      if (pricedAt && (!latestPricedAt || pricedAt > latestPricedAt)) latestPricedAt = pricedAt;
      if (override) overrideCount += 1;
      if (isStale) staleSnapshotCount += 1;
      for (const row of relatedMarket) {
        if (row.price != null) {
          marketTotal += Number(row.price);
          marketCount += 1;
        }
        const source = Array.isArray(row.source) ? row.source[0] : row.source;
        if (source?.source_code) sourceSet.add(source.source_code);
      }

      channelRows.push({
        channel,
        channel_label: channel === "web" ? "Website" : channel === "ebay" ? "eBay" : channel === "bricklink" ? "BrickLink" : "BrickOwl",
        listing,
        snapshot,
        override,
        override_status: overrideStatus,
        below_floor: belowFloor,
        manual,
        stale_snapshot: isStale,
        snapshot_age_hours: ageHours,
        final_price: finalPrice,
        margin_amount: quote.raw_quote?.expected_net_margin ?? snapshot?.expected_margin_amount ?? null,
        margin_rate: quote.raw_quote?.expected_net_margin_rate ?? snapshot?.expected_margin_rate ?? null,
        quote,
        market_snapshots: relatedMarket,
      });
    }

    const firstQuote = channelRows[0]?.quote;
    variants.push({
      sku_id: sku.id,
      sku_code: sku.sku_code,
      mpn: sku.mpn,
      condition_grade: sku.condition_grade,
      active_flag: Boolean(sku.active_flag),
      saleable_flag: Boolean(sku.saleable_flag),
      stock_count: firstQuote?.stock_unit_count ?? 0,
      pooled_carrying_value: (firstQuote?.cost_basis as any)?.pooled_carrying_value ?? firstQuote?.average_carrying_value ?? firstQuote?.carrying_value ?? null,
      highest_unit_carrying_value: (firstQuote?.cost_basis as any)?.highest_unit_carrying_value ?? (firstQuote?.breakdown as any)?.highest_unit_carrying_value ?? null,
      exposure_over_pool: (firstQuote?.cost_basis as any)?.exposure_over_pool ?? null,
      channels: channelRows,
    });
  }

  return {
    product: {
      id: product?.id ?? null,
      mpn: product?.mpn ?? mpn,
      name: product?.name ?? null,
      theme: Array.isArray(product?.theme) ? product?.theme?.[0]?.name ?? null : (product?.theme as any)?.name ?? null,
    },
    summary: {
      sku_count: variants.length,
      channel_count: channels.length,
      grade_spread: [...gradeSet].sort().join(", "),
      average_confidence: confidenceCount > 0 ? confidenceTotal / confidenceCount : null,
      average_market_price: marketCount > 0 ? marketTotal / marketCount : null,
      source_count: sourceSet.size,
      override_count: overrideCount,
      stale_snapshot_count: staleSnapshotCount,
      latest_priced_at: latestPricedAt,
    },
    variants,
  };
}

/** Fully reset a QBO purchase: delete derived stock units, receipt lines, purchase batches/line items, then reset landing to pending */
async function resetQboPurchase(admin: any, qboPurchaseId: string, landingId: string) {
  // 1. Find the receipt
  const { data: receipt } = await admin
    .from("inbound_receipt")
    .select("id")
    .eq("qbo_purchase_id", qboPurchaseId)
    .maybeSingle();

  if (receipt) {
    // 2. Get real receipt line IDs
    const { data: lines } = await admin
      .from("inbound_receipt_line")
      .select("id")
      .eq("inbound_receipt_id", receipt.id);
    const lineIds = (lines ?? []).map((l: any) => l.id);

    // 3. Delete stock units linked to those lines (non-sold only; nullify sold)
    if (lineIds.length > 0) {
      const { data: linkedUnits } = await admin
        .from("stock_unit")
        .select("id, status, v2_status")
        .in("inbound_receipt_line_id", lineIds);
      for (const unit of (linkedUnits ?? [])) {
        if (unit.status === "closed" || unit.v2_status === "sold") {
          await admin.from("stock_unit").update({ inbound_receipt_line_id: null }).eq("id", unit.id);
        } else {
          await admin.from("stock_unit").delete().eq("id", unit.id);
        }
      }
    }

    // 4. Delete receipt lines
    await admin.from("inbound_receipt_line").delete().eq("inbound_receipt_id", receipt.id);

    // 5. Reset receipt status
    await admin.from("inbound_receipt").update({ status: "pending" }).eq("id", receipt.id);
  }

  // 6. Delete purchase_line_items and purchase_batches by reference
  const { data: batches } = await admin
    .from("purchase_batches")
    .select("id")
    .eq("reference", qboPurchaseId);
  for (const b of (batches ?? [])) {
    await admin.from("purchase_line_items").delete().eq("batch_id", b.id);
    await admin.from("purchase_batches").delete().eq("id", b.id);
  }

  // 7. Reset landing record to pending
  await admin
    .from("landing_raw_qbo_purchase")
    .update({ status: "pending", error_message: null, processed_at: null })
    .eq("id", landingId);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth: extract & verify JWT, then check admin/staff role ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the caller's JWT using service role client (can validate any token)
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    // Check role using service role client (bypasses RLS)
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    const hasAccess = (roles ?? []).some(
      (r: { role: string }) => r.role === "admin" || r.role === "staff"
    );
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Route by action ---
    const { action, ...params } = await req.json();

    let result: unknown;

    if (action === "list-receipts") {
      const { data, error } = await admin
        .from("inbound_receipt")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      result = data;
    } else if (action === "receipt-lines") {
      const { data, error } = await admin
        .from("inbound_receipt_line")
        .select("*, tax_code:tax_code_id(purchase_tax_rate:purchase_tax_rate_id(rate_percent))")
        .eq("inbound_receipt_id", params.receipt_id)
        .order("created_at");
      if (error) throw error;
      // Flatten vat_rate_percent onto each line
      result = (data ?? []).map((l: any) => ({
        ...l,
        vat_rate_percent: l.tax_code?.purchase_tax_rate?.rate_percent ?? null,
        tax_code: undefined,
      }));
    } else if (action === "list-stock-units") {
      const { data, error } = await admin
        .from("stock_unit")
        .select(
          "id, mpn, condition_grade, status, landed_cost, carrying_value, accumulated_impairment, created_at, sku:sku_id(sku_code, name, product:product_id(name)), receipt_line:inbound_receipt_line_id(tax_code:tax_code_id(purchase_tax_rate:purchase_tax_rate_id(rate_percent)), receipt:inbound_receipt_id(txn_date))"
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Flatten vat_rate_percent and purchase_date
      result = (data ?? []).map((u: any) => ({
        ...u,
        vat_rate_percent: u.receipt_line?.tax_code?.purchase_tax_rate?.rate_percent ?? null,
        purchase_date: u.receipt_line?.receipt?.txn_date ?? null,
        receipt_line: undefined,
      }));
    } else if (action === "list-customers") {
      const { data, error } = await admin
        .from("customer")
        .select("id, qbo_customer_id, display_name, email, phone, mobile, billing_city, billing_postcode, billing_country, active, synced_at, created_at")
        .order("display_name", { ascending: true });
      if (error) throw error;
      result = data;
    } else if (action === "list-orders") {
      const { data, error } = await admin
        .from("sales_order")
        .select(
          "id, order_number, doc_number, origin_channel, origin_reference, status, merchandise_subtotal, discount_total, tax_total, gross_total, currency, guest_name, guest_email, created_at, txn_date, notes, customer:customer_id(id, display_name, email), sales_order_line(id, quantity, unit_price, line_total, tax_code:tax_code_id(sales_tax_rate:sales_tax_rate_id(rate_percent)), sku:sku_id(sku_code, name, product:product_id(name, mpn)))"
        )
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      result = (data ?? []).map((o: any) => ({
        ...o,
        sales_order_line: (o.sales_order_line ?? []).map((l: any) => ({
          ...l,
          vat_rate_percent: l.tax_code?.sales_tax_rate?.rate_percent ?? null,
          tax_code: undefined,
        })),
      }));
    } else if (action === "list-listings") {
      // 1. Active SKUs with catalog product info
      const { data: skus, error: skuErr } = await admin
        .from("sku")
        .select("id, sku_code, name, condition_grade, price, active_flag, product_id, product:product_id(name, mpn)")
        .eq("active_flag", true)
        .order("sku_code", { ascending: true });
      if (skuErr) throw skuErr;

      // 2. Available stock counts per SKU
      const { data: stockCounts, error: scErr } = await admin
        .from("stock_unit")
        .select("sku_id")
        .eq("status", "available");
      if (scErr) throw scErr;
      const stockMap: Record<string, number> = {};
      for (const su of stockCounts ?? []) {
        stockMap[su.sku_id] = (stockMap[su.sku_id] ?? 0) + 1;
      }

      // 3. All channel listings
      const { data: listings, error: clErr } = await admin
        .from("channel_listing")
        .select("id, sku_id, channel, external_sku, external_listing_id, offer_status, listed_price, listed_quantity, synced_at")
        .order("channel");
      if (clErr) throw clErr;

      // Group listings by sku_id
      const listingMap: Record<string, any[]> = {};
      for (const cl of listings ?? []) {
        if (!cl.sku_id) continue;
        if (!listingMap[cl.sku_id]) listingMap[cl.sku_id] = [];
        listingMap[cl.sku_id].push(cl);
      }

      // Merge
      result = (skus ?? []).map((s: any) => ({
        ...s,
        stock_available: stockMap[s.id] ?? 0,
        channel_listings: listingMap[s.id] ?? [],
      }));
    } else if (action === "list-products") {
      // 1. Products with theme name
      const { data: products, error: pErr } = await admin
        .from("product")
        .select("*, theme:theme_id(name)")
        .order("mpn", { ascending: true });
      if (pErr) throw pErr;

      // 2. SKUs per product
      const { data: skus, error: skuErr } = await admin
        .from("sku")
        .select("id, sku_code, condition_grade, price, product_id, active_flag")
        .order("sku_code");
      if (skuErr) throw skuErr;

      // 3. Available stock counts per SKU
      const { data: stockUnits, error: suErr } = await admin
        .from("stock_unit")
        .select("sku_id, carrying_value, status");
      if (suErr) throw suErr;

      const skuStockMap: Record<string, { available: number; value: number }> = {};
      for (const su of stockUnits ?? []) {
        if (!skuStockMap[su.sku_id]) skuStockMap[su.sku_id] = { available: 0, value: 0 };
        if (su.status === "available") {
          skuStockMap[su.sku_id].available += 1;
          skuStockMap[su.sku_id].value += su.carrying_value ?? 0;
        }
      }

      // 4. Sales per SKU
      const { data: salesLines, error: slErr } = await admin
        .from("sales_order_line")
        .select("sku_id, quantity, line_total");
      if (slErr) throw slErr;

      const skuSalesMap: Record<string, { qty: number; revenue: number }> = {};
      for (const sl of salesLines ?? []) {
        if (!skuSalesMap[sl.sku_id]) skuSalesMap[sl.sku_id] = { qty: 0, revenue: 0 };
        skuSalesMap[sl.sku_id].qty += sl.quantity;
        skuSalesMap[sl.sku_id].revenue += sl.line_total;
      }

      // 5. Channel listings per SKU
      const { data: listings, error: clErr } = await admin
        .from("channel_listing")
        .select("id, sku_id, channel, external_sku, external_listing_id, offer_status, listed_price, listed_quantity, listing_title, listing_description, synced_at");
      if (clErr) throw clErr;

      const skuListingMap: Record<string, any[]> = {};
      for (const cl of listings ?? []) {
        if (!cl.sku_id) continue;
        if (!skuListingMap[cl.sku_id]) skuListingMap[cl.sku_id] = [];
        skuListingMap[cl.sku_id].push(cl);
      }

      // Group SKUs by product_id
      const productSkuMap: Record<string, any[]> = {};
      for (const s of skus ?? []) {
        if (!s.product_id) continue;
        if (!productSkuMap[s.product_id]) productSkuMap[s.product_id] = [];
        const stock = skuStockMap[s.id] ?? { available: 0, value: 0 };
        productSkuMap[s.product_id].push({
          ...s,
          stock_available: stock.available,
          carrying_value: stock.value,
          channel_listings: skuListingMap[s.id] ?? [],
        });
      }

      // Merge into products
      result = (products ?? []).map((p: any) => {
        const pSkus = productSkuMap[p.id] ?? [];
        let stockAvailable = 0, carryingValue = 0, unitsSold = 0, revenue = 0;
        const allChannelListings: any[] = [];
        for (const s of pSkus) {
          stockAvailable += s.stock_available;
          carryingValue += s.carrying_value;
          const sales = skuSalesMap[s.id];
          if (sales) { unitsSold += sales.qty; revenue += sales.revenue; }
          allChannelListings.push(...s.channel_listings);
        }
        return {
          ...p,
          theme_name: p.theme?.name ?? null,
          theme: undefined,
          stock_available: stockAvailable,
          carrying_value: carryingValue,
          units_sold: unitsSold,
          revenue,
          skus: pSkus,
          channel_listings: allChannelListings,
        };
      });
    } else if (action === "get-product") {
      const { data: product, error: pErr } = await admin
        .from("product")
        .select("*, theme:theme_id(name), lego_catalog:lego_catalog_id(img_url)")
        .eq("id", params.product_id)
        .single();
      if (pErr) throw pErr;

      // SKUs
      const { data: skus, error: skuErr } = await admin
        .from("sku")
        .select("id, sku_code, condition_grade, price, active_flag")
        .eq("product_id", params.product_id)
        .order("sku_code");
      if (skuErr) throw skuErr;

      const skuIds = (skus ?? []).map((s: any) => s.id);

      // Stock
      const { data: stockUnits } = await admin
        .from("stock_unit")
        .select("sku_id, carrying_value, status")
        .in("sku_id", skuIds.length > 0 ? skuIds : ["00000000-0000-0000-0000-000000000000"]);

      const skuStockMap: Record<string, { available: number; value: number }> = {};
      for (const su of stockUnits ?? []) {
        if (!skuStockMap[su.sku_id]) skuStockMap[su.sku_id] = { available: 0, value: 0 };
        if (su.status === "available") {
          skuStockMap[su.sku_id].available += 1;
          skuStockMap[su.sku_id].value += su.carrying_value ?? 0;
        }
      }

      // Sales
      const { data: salesLines } = await admin
        .from("sales_order_line")
        .select("sku_id, quantity, line_total")
        .in("sku_id", skuIds.length > 0 ? skuIds : ["00000000-0000-0000-0000-000000000000"]);

      // Channel listings
      const { data: listings } = await admin
        .from("channel_listing")
        .select("id, sku_id, channel, external_sku, external_listing_id, offer_status, listed_price, listed_quantity, listing_title, listing_description, synced_at")
        .in("sku_id", skuIds.length > 0 ? skuIds : ["00000000-0000-0000-0000-000000000000"]);

      const skuListingMap: Record<string, any[]> = {};
      for (const cl of listings ?? []) {
        if (!cl.sku_id) continue;
        if (!skuListingMap[cl.sku_id]) skuListingMap[cl.sku_id] = [];
        skuListingMap[cl.sku_id].push(cl);
      }

      let stockAvailable = 0, carryingValue = 0, unitsSold = 0, revenue = 0;
      const allChannelListings: any[] = [];
      const enrichedSkus = (skus ?? []).map((s: any) => {
        const stock = skuStockMap[s.id] ?? { available: 0, value: 0 };
        stockAvailable += stock.available;
        carryingValue += stock.value;
        const skuSales = (salesLines ?? []).filter((sl: any) => sl.sku_id === s.id);
        for (const sl of skuSales) { unitsSold += sl.quantity; revenue += sl.line_total; }
        const cls = skuListingMap[s.id] ?? [];
        allChannelListings.push(...cls);
        return { ...s, stock_available: stock.available, carrying_value: stock.value, channel_listings: cls };
      });

      // Fetch source data for override comparison
      const sourceData: Record<string, any> = {};
      if (product.lego_catalog_id) {
        const { data: lc } = await admin
          .from("lego_catalog")
          .select("version_descriptor, brickeconomy_id, bricklink_item_no, brickowl_boid, rebrickable_id")
          .eq("id", product.lego_catalog_id)
          .maybeSingle();
        if (lc) sourceData.lego_catalog = lc;
      }
      const baseMpn = product.mpn.replace(/-\d+$/, "");
      const { data: beRow } = await admin
        .from("brickeconomy_collection")
        .select("item_number, minifigs_count, retail_price, released_date, retired_date")
        .in("item_number", [product.mpn, baseMpn])
        .order("synced_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (beRow) sourceData.brickeconomy = beRow;

      result = {
        ...product,
        theme_name: product.theme?.name ?? null,
        catalog_img_url: product.lego_catalog?.img_url ?? null,
        theme: undefined,
        lego_catalog: undefined,
        stock_available: stockAvailable,
        carrying_value: carryingValue,
        units_sold: unitsSold,
        revenue,
        skus: enrichedSkus,
        channel_listings: allChannelListings,
        source_data: sourceData,
      };
    } else if (action === "update-product") {
      const { product_id, ...fields } = params;
      const allowed = [
        "product_hook", "description", "highlights", "call_to_action",
        "seo_title", "seo_description", "age_range", "age_mark",
        "length_cm", "width_cm", "height_cm", "weight_kg", "weight_g",
        "include_catalog_img", "ean", "set_number", "dimensions_cm",
        "name", "piece_count", "minifigs_count", "retail_price", "product_type",
        "retired_flag", "retired_date", "released_date", "release_year",
        "version_descriptor", "brand", "subtheme_name",
        "brickeconomy_id", "bricklink_item_no", "brickowl_boid", "rebrickable_id",
        "field_overrides",
      ];
      const updates: Record<string, any> = {};
      for (const k of allowed) {
        if (k in fields) updates[k] = fields[k];
      }

      // Handle theme_name: look up or create theme, then set theme_id
      if ("theme_name" in fields) {
        const themeName = fields.theme_name?.trim() || null;
        if (themeName) {
          // Try to find existing theme
          let { data: theme } = await admin
            .from("theme")
            .select("id")
            .eq("name", themeName)
            .maybeSingle();
          if (!theme) {
            // Create new theme
            const { data: newTheme, error: themeErr } = await admin
              .from("theme")
              .insert({ name: themeName, slug: slugify(themeName) })
              .select("id")
              .single();
            if (themeErr) throw themeErr;
            theme = newTheme;
          }
          updates.theme_id = theme.id;
        } else {
          updates.theme_id = null;
        }
      }

      if (Object.keys(updates).length === 0) throw new ValidationError("No valid fields to update");
      const { error } = await admin.from("product").update(updates).eq("id", product_id);
      if (error) throw error;
      result = { success: true };
    } else if (action === "update-channel-listing") {
      const { listing_id, ...fields } = params;
      const allowed = ["listing_title", "listing_description"];
      const updates: Record<string, any> = {};
      for (const k of allowed) {
        if (k in fields) updates[k] = fields[k];
      }
      if (Object.keys(updates).length === 0) throw new ValidationError("No valid fields to update");
      const { error } = await admin.from("channel_listing").update(updates).eq("id", listing_id);
      if (error) throw error;
      result = { success: true };
    } else if (action === "create-web-listing") {
      const {
        sku_id,
        listed_price,
        listing_title,
        listing_description,
        allow_below_floor,
        override_reason_code,
        override_reason_note,
      } = params;
      if (!sku_id) throw new ValidationError("sku_id is required");

      const preflight = await buildWebsiteListingPreflight(
        admin,
        sku_id,
        typeof listed_price === "number" ? listed_price : null,
      );
      if (!preflight.can_publish) {
        const nonOverrideBlockers = preflight.blockers.filter((blocker: string) => !blocker.includes("is below floor"));
        if (nonOverrideBlockers.length > 0 || !allow_below_floor) {
          throw new ValidationError(preflight.blockers[0] ?? "Website listing is blocked");
        }
        if (typeof override_reason_code !== "string" || !override_reason_code.trim()) {
          throw new ValidationError("Override reason is required for a below-floor website price.");
        }
      }

      const { data: sku, error: skuErr } = await admin
        .from("sku")
        .select("id, sku_code")
        .eq("id", sku_id)
        .single();
      if (skuErr || !sku) throw new ValidationError("SKU not found");

      const finalPrice = Number(preflight.final_price ?? 0);
      if (!finalPrice || finalPrice <= 0) throw new ValidationError("Cannot list: SKU has no valid price. Calculate pricing first.");
      const quoteFloor = Number(preflight.quote.floor_price ?? 0);
      if (quoteFloor > 0 && finalPrice < quoteFloor) {
        if (!allow_below_floor) {
          throw new ValidationError(`Cannot list: website price £${finalPrice.toFixed(2)} is below floor £${quoteFloor.toFixed(2)}.`);
        }
        if (typeof override_reason_code !== "string" || !override_reason_code.trim()) {
          throw new ValidationError("Override reason is required for a below-floor website price.");
        }
      }

      // Sync resolved price back to SKU
      await admin.from("sku").update({ price: finalPrice }).eq("id", sku_id);

      // Upsert channel_listing for web
      const { data: webListing, error: uErr } = await admin.from("channel_listing").upsert(
        {
          channel: "web",
          external_sku: sku.sku_code,
          sku_id: sku.id,
          listed_price: finalPrice,
          listed_quantity: preflight.saleable_stock_count,
          offer_status: "PUBLISHED",
          v2_channel: "website",
          v2_status: "live",
          listing_title: typeof listing_title === "string" && listing_title.trim() ? listing_title.trim() : null,
          listing_description: typeof listing_description === "string" && listing_description.trim() ? listing_description.trim() : null,
          price_floor: null,
          price_target: null,
          price_ceiling: null,
          confidence_score: null,
          pricing_notes: null,
          priced_at: null,
          listed_at: new Date().toISOString(),
          synced_at: new Date().toISOString(),
        },
        { onConflict: "channel,external_sku", ignoreDuplicates: false }
      ).select("id").single();
      if (uErr) throw uErr;

      const listingId = webListing?.id;
      let commandId: string | null = null;
      let outboxProcess: Record<string, unknown> | null = null;
      if (listingId) {
        const { data: snapshotId, error: snapshotErr } = await admin.rpc("create_price_decision_snapshot", {
          p_sku_id: sku.id,
          p_channel: "web",
          p_channel_listing_id: listingId,
          p_candidate_price: finalPrice,
          p_actor_id: userId,
        });
        if (snapshotErr) throw snapshotErr;

        if (quoteFloor > 0 && finalPrice < quoteFloor) {
          const { error: overrideErr } = await admin.from("price_override").insert({
            price_decision_snapshot_id: snapshotId,
            sku_id: sku.id,
            channel_listing_id: listingId,
            channel: "web",
            override_type: "below_floor",
            old_price: preflight.quote.target_price ?? null,
            new_price: finalPrice,
            reason_code: String(override_reason_code).trim(),
            reason_note: typeof override_reason_note === "string" && override_reason_note.trim()
              ? override_reason_note.trim()
              : null,
            approved_by: userId,
            performed_by: userId,
          });
          if (overrideErr) throw overrideErr;
        }

        const { data: queuedCommandId, error: queuedCommandErr } = await admin.rpc("queue_listing_command", {
          p_channel_listing_id: listingId,
          p_command_type: "publish",
          p_actor_id: userId,
          p_allow_below_floor: !!allow_below_floor,
        });
        if (queuedCommandErr) throw queuedCommandErr;
        commandId = queuedCommandId ?? null;

        if (commandId) {
          try {
            const processRes = await fetch(`${supabaseUrl}/functions/v1/listing-command-process`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceRoleKey}`,
                apikey: serviceRoleKey,
              },
              body: JSON.stringify({ commandId, trigger: "website_publish" }),
            });
            const processPayload = await processRes.json().catch(() => ({}));
            outboxProcess = {
              ok: processRes.ok,
              status: processRes.status,
              payload: processPayload,
            };
            if (!processRes.ok) {
              console.warn("Immediate website listing outbox processing failed", processPayload);
            }
          } catch (err) {
            outboxProcess = {
              ok: false,
              error: err instanceof Error ? err.message : "Unknown outbox processing error",
            };
            console.warn("Immediate website listing outbox processing failed", err);
          }
        }
      }

      result = {
        success: true,
        listing_id: listingId,
        command_id: commandId,
        outbox_process: outboxProcess,
        preflight,
        final_price: finalPrice,
      };
    } else if (action === "website-listing-preflight") {
      const { sku_id, listed_price } = params;
      if (!sku_id) throw new ValidationError("sku_id is required");
      result = await buildWebsiteListingPreflight(
        admin,
        sku_id,
        typeof listed_price === "number" ? listed_price : null,
      );
    } else if (action === "activate-sku") {
      const { sku_id } = params;
      if (!sku_id) throw new ValidationError("sku_id is required");
      const { error } = await admin
        .from("sku")
        .update({ active_flag: true, saleable_flag: true })
        .eq("id", sku_id);
      if (error) throw error;
      result = { success: true, sku_id };
    } else if (action === "remove-web-listing") {
      const { sku_id } = params;
      if (!sku_id) throw new ValidationError("sku_id is required");

      const { data: listings, error: lookupErr } = await admin
        .from("channel_listing")
        .select("id")
        .eq("sku_id", sku_id)
        .eq("channel", "web");

      if (lookupErr) throw lookupErr;

      const listingIds = ((listings ?? []) as Array<{ id: string }>).map((listing) => listing.id);
      if (listingIds.length === 0) {
        result = { success: true, ended: 0, command_ids: [] };
      } else {
        const endedAt = new Date().toISOString();
        const { error: updateErr } = await admin
          .from("channel_listing")
          .update({
            listed_quantity: 0,
            offer_status: "ENDED",
            v2_status: "ended",
            availability_override: null,
            availability_override_at: null,
            availability_override_by: null,
            synced_at: endedAt,
          } as never)
          .in("id", listingIds);

        if (updateErr) throw updateErr;

        const commandIds: string[] = [];
        for (const listingId of listingIds) {
          const { data: commandId, error: commandErr } = await admin.rpc("queue_listing_command", {
            p_channel_listing_id: listingId,
            p_command_type: "end",
          });
          if (commandErr) throw commandErr;
          if (commandId) commandIds.push(commandId);
        }

        result = { success: true, ended: listingIds.length, command_ids: commandIds };
      }

    /* ── Channel availability controls ── */

    } else if (
      action === "set-channel-out-of-stock" ||
      action === "clear-channel-out-of-stock" ||
      action === "delist-channel-listing"
    ) {
      const { listing_id } = params;
      if (!listing_id) throw new ValidationError("listing_id is required");

      const before = await fetchChannelListingForAction(admin, listing_id);
      if (!before.sku_id) throw new ValidationError("channel listing is not linked to a SKU");

      const channel = normalizeListingChannel(before);
      if (CHANNELS_PENDING_OUTBOUND_CONNECTOR.has(channel)) {
        throw new ValidationError(`${channel} outbound controls are not available yet`);
      }

      if (channel === "google_shopping" || channel === "gmc") {
        throw new ValidationError("GMC availability is controlled by the Website listing");
      }

      const now = new Date().toISOString();
      let commandType: "sync_quantity" | "end" = "sync_quantity";
      let triggerType = "channel_out_of_stock_set";
      let cascadedCommandIds: string[] = [];

      if (action === "set-channel-out-of-stock") {
        if (before.v2_status === "ended") {
          throw new ValidationError("Cannot set an ended listing out of stock");
        }

        const { error } = await admin
          .from("channel_listing")
          .update({
            availability_override: "manual_out_of_stock",
            availability_override_at: now,
            availability_override_by: userId,
            listed_quantity: 0,
            offer_status: "OUT_OF_STOCK",
            synced_at: now,
          })
          .eq("id", listing_id);
        if (error) throw error;

        if (isWebsiteListing(before)) {
          cascadedCommandIds = await cascadeWebsiteAvailabilityToGmc(
            admin,
            before,
            "manual_out_of_stock",
            userId,
            now,
          );
        }
      } else if (action === "clear-channel-out-of-stock") {
        const listedQuantity = await countSaleableStock(admin, before.sku_id);
        const restoreOfferStatus =
          String(before.offer_status ?? "").toLowerCase() === "out_of_stock"
            ? "PUBLISHED"
            : before.offer_status;

        const { error } = await admin
          .from("channel_listing")
          .update({
            availability_override: null,
            availability_override_at: null,
            availability_override_by: null,
            listed_quantity: listedQuantity,
            offer_status: restoreOfferStatus,
            synced_at: now,
          })
          .eq("id", listing_id);
        if (error) throw error;

        triggerType = "channel_out_of_stock_cleared";
        if (isWebsiteListing(before)) {
          cascadedCommandIds = await cascadeWebsiteAvailabilityToGmc(
            admin,
            before,
            "clear_out_of_stock",
            userId,
            now,
          );
        }
      } else {
        const { error } = await admin
          .from("channel_listing")
          .update({
            availability_override: null,
            availability_override_at: null,
            availability_override_by: null,
            listed_quantity: 0,
            offer_status: "END_QUEUED",
            synced_at: now,
          })
          .eq("id", listing_id);
        if (error) throw error;

        commandType = "end";
        triggerType = "channel_listing_delist_queued";
        if (isWebsiteListing(before)) {
          cascadedCommandIds = await cascadeWebsiteAvailabilityToGmc(
            admin,
            before,
            "delist",
            userId,
            now,
          );
        }
      }

      const commandId = await queueChannelListingCommand(admin, listing_id, commandType, userId);
      const after = await fetchChannelListingForAction(admin, listing_id);
      await auditChannelAvailabilityAction(
        admin,
        userId,
        triggerType,
        before,
        after,
        commandId,
        cascadedCommandIds,
      );

      result = {
        success: true,
        listing_id,
        command_id: commandId,
        cascaded_gmc_command_ids: cascadedCommandIds,
      };

    /* ── Media CRUD ── */

    } else if (action === "list-product-media") {
      const { product_id: pid } = params;
      if (!pid) throw new ValidationError("product_id is required");
      const { data, error } = await admin
        .from("product_media")
        .select("id, sort_order, is_primary, media_asset:media_asset_id(id, original_url, alt_text, mime_type, width, height, file_size_bytes)")
        .eq("product_id", pid)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      result = (data ?? []).map((pm: any) => ({
        ...pm.media_asset,
        id: pm.id,
        sort_order: pm.sort_order,
        is_primary: pm.is_primary,
        media_asset_id: pm.media_asset?.id,
      }));

    } else if (action === "delete-product-media") {
      const { product_media_id, media_asset_id: maId } = params;
      if (!product_media_id) throw new ValidationError("product_media_id is required");

      // Get the media asset to find storage path
      if (maId) {
        const { data: asset } = await admin.from("media_asset").select("original_url").eq("id", maId).maybeSingle();
        if (asset?.original_url) {
          // Extract storage path from URL
          const url = asset.original_url;
          const bucketSegment = "/storage/v1/object/public/media/";
          const idx = url.indexOf(bucketSegment);
          if (idx !== -1) {
            const storagePath = url.substring(idx + bucketSegment.length);
            await admin.storage.from("media").remove([storagePath]);
          }
        }
        await admin.from("media_asset").delete().eq("id", maId);
      }

      // product_media row cascades from media_asset delete, but delete explicitly too
      await admin.from("product_media").delete().eq("id", product_media_id);
      result = { success: true };

    } else if (action === "reorder-product-media") {
      const { items } = params;
      if (!Array.isArray(items)) throw new ValidationError("items array is required");
      for (const item of items) {
        const { error: reorderErr } = await admin.from("product_media").update({ sort_order: item.sort_order }).eq("id", item.id);
        if (reorderErr) throw reorderErr;
      }
      result = { success: true };

    } else if (action === "update-media-alt-text") {
      const { media_asset_id: maId, alt_text } = params;
      if (!maId) throw new ValidationError("media_asset_id is required");
      const { error } = await admin.from("media_asset").update({ alt_text }).eq("id", maId);
      if (error) throw error;
      result = { success: true };

    } else if (action === "set-primary-media") {
      const { product_id: pid, product_media_id } = params;
      if (!pid || !product_media_id) throw new ValidationError("product_id and product_media_id required");

      // Clear all primary flags for this product
      const { error: clearErr } = await admin.from("product_media").update({ is_primary: false }).eq("product_id", pid);
      if (clearErr) throw clearErr;
      // Set the chosen one
      const { error: setErr } = await admin.from("product_media").update({ is_primary: true }).eq("id", product_media_id);
      if (setErr) throw setErr;

      // Update product.img_url from the media asset
      const { data: pm, error: pmErr } = await admin
        .from("product_media")
        .select("media_asset:media_asset_id(original_url)")
        .eq("id", product_media_id)
        .maybeSingle();
      if (pmErr) throw pmErr;
      if (pm?.media_asset) {
        const { error: imgErr } = await admin.from("product").update({ img_url: (pm.media_asset as any).original_url }).eq("id", pid);
        if (imgErr) throw imgErr;
      }
      result = { success: true };

    /* ── Channel Fee Schedule CRUD ── */

    } else if (action === "list-channel-fees") {
      const { data, error } = await admin
        .from("channel_fee_schedule")
        .select("*")
        .order("channel")
        .order("fee_name");
      if (error) throw error;
      result = data;

    } else if (action === "upsert-channel-fee") {
      const { id: feeId, channel, fee_name, rate_percent, fixed_amount, min_amount, max_amount, applies_to, active, notes } = params;
      const row: Record<string, any> = { channel, fee_name, rate_percent: rate_percent ?? 0, fixed_amount: fixed_amount ?? 0, applies_to: applies_to ?? "sale_price", active: active ?? true };
      if (min_amount !== undefined) row.min_amount = min_amount;
      if (max_amount !== undefined) row.max_amount = max_amount;
      if (notes !== undefined) row.notes = notes;
      if (feeId) row.id = feeId;
      const { error } = await admin.from("channel_fee_schedule").upsert(row, { onConflict: "id" });
      if (error) throw error;
      result = { success: true };

    } else if (action === "delete-channel-fee") {
      const { id: feeId } = params;
      if (!feeId) throw new ValidationError("id is required");
      const { error } = await admin.from("channel_fee_schedule").delete().eq("id", feeId);
      if (error) throw error;
      result = { success: true };

    /* ── Shipping Rate Table CRUD ── */

    } else if (action === "list-shipping-rates") {
      const { data, error } = await admin
        .from("shipping_rate_table")
        .select("*")
        .order("carrier")
        .order("max_weight_kg");
      if (error) throw error;
      result = data;

    } else if (action === "upsert-shipping-rate") {
      const { id: rateId, channel, carrier, service_name, max_weight_kg, max_length_cm, max_width_cm, max_depth_cm, max_girth_cm, size_band, cost, price_ex_vat, price_inc_vat, vat_exempt, tracked, max_compensation, est_delivery, active } = params;
      const row: Record<string, any> = {
        channel: channel ?? "default", carrier, service_name, max_weight_kg,
        cost: cost ?? price_ex_vat ?? 0, active: active ?? true,
      };
      if (max_length_cm !== undefined) row.max_length_cm = max_length_cm;
      if (max_width_cm !== undefined) row.max_width_cm = max_width_cm;
      if (max_depth_cm !== undefined) row.max_depth_cm = max_depth_cm;
      if (max_girth_cm !== undefined) row.max_girth_cm = max_girth_cm;
      if (size_band !== undefined) row.size_band = size_band;
      if (price_ex_vat !== undefined) { row.price_ex_vat = price_ex_vat; row.cost = price_ex_vat; }
      if (price_inc_vat !== undefined) row.price_inc_vat = price_inc_vat;
      if (vat_exempt !== undefined) row.vat_exempt = vat_exempt;
      if (tracked !== undefined) row.tracked = tracked;
      if (max_compensation !== undefined) row.max_compensation = max_compensation;
      if (est_delivery !== undefined) row.est_delivery = est_delivery;
      if (rateId) row.id = rateId;
      const { error } = await admin.from("shipping_rate_table").upsert(row, { onConflict: "id" });
      if (error) throw error;
      result = { success: true };

    } else if (action === "delete-shipping-rate") {
      const { id: rateId } = params;
      if (!rateId) throw new ValidationError("id is required");
      const { error } = await admin.from("shipping_rate_table").delete().eq("id", rateId);
      if (error) throw error;
      result = { success: true };

    /* ── Selling Cost Defaults CRUD ── */

    } else if (action === "list-selling-cost-defaults") {
      const { data, error } = await admin
        .from("selling_cost_defaults")
        .select("*")
        .order("key");
      if (error) throw error;
      result = data;

    } else if (action === "upsert-selling-cost-default") {
      const { key: dKey, value: dValue } = params;
      if (!dKey) throw new ValidationError("key is required");
      const { error } = await admin.from("selling_cost_defaults").upsert(
        { key: dKey, value: dValue ?? 0, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
      if (error) throw error;
      result = { success: true };

    /* ── Calculate Selling Costs ── */

    } else if (action === "calculate-selling-costs") {
      const { sku_id, channel, sale_price, shipping_charged } = params;
      if (!sku_id || !channel || sale_price === undefined) throw new ValidationError("sku_id, channel, and sale_price are required");

      // 1. Get SKU → product dimensions
      const { data: skuData } = await admin
        .from("sku")
        .select("id, price, product:product_id(weight_kg, length_cm, width_cm, height_cm)")
        .eq("id", sku_id)
        .single();
      const product = (skuData?.product as any) ?? {};
      const weightKg = product.weight_kg ?? 0;
      const lengthCm = product.length_cm;
      const widthCm = product.width_cm;
      const heightCm = product.height_cm;
      const hasDimensions = lengthCm != null && widthCm != null && heightCm != null;

      // 2. Get carrying value basis for pooled stock. Use the highest eligible
      // unit value so a SKU-level sale price protects every available unit.
      const { data: stockUnits } = await admin
        .from("stock_unit")
        .select("carrying_value, landed_cost")
        .eq("sku_id", sku_id)
        .eq("status", "available");
      const carryingValues = (stockUnits ?? [])
        .map((su: any) => Number(su.carrying_value ?? su.landed_cost ?? 0))
        .filter((value: number) => value > 0);
      const avgCarrying = carryingValues.length > 0
        ? carryingValues.reduce((sum: number, value: number) => sum + value, 0) / carryingValues.length
        : 0;
      const carryingValueBasis = carryingValues.length > 0 ? Math.max(...carryingValues) : 0;

      // 3. Get active fees for channel
      const { data: fees } = await admin
        .from("channel_fee_schedule")
        .select("*")
        .eq("channel", channel)
        .eq("active", true);

      // 4. Calculate channel fees
      let totalChannelFees = 0;
      const feeBreakdown: { fee_name: string; amount: number }[] = [];
      const salePrice = Number(sale_price);
      const shippingCharged = Number(shipping_charged ?? 0);
      for (const fee of fees ?? []) {
        let base = salePrice;
        if (fee.applies_to === "sale_plus_shipping") base = salePrice + shippingCharged;
        else if (fee.applies_to === "sale_price_inc_vat") base = salePrice * 1.2;
        let amount = (base * (fee.rate_percent / 100)) + (fee.fixed_amount ?? 0);
        if (fee.min_amount != null && amount < fee.min_amount) amount = fee.min_amount;
        if (fee.max_amount != null && amount > fee.max_amount) amount = fee.max_amount;
        amount = Math.round(amount * 100) / 100;
        totalChannelFees += amount;
        feeBreakdown.push({ fee_name: fee.fee_name, amount });
      }

      // 5. Get shipping cost — dimension-aware matching
      let shippingCost = 0;
      let matchedRate: any = null;

      // Fetch all active rates for channel
      const { data: allRates } = await admin
        .from("shipping_rate_table")
        .select("*")
        .or(`channel.eq.${channel},channel.eq.default`)
        .eq("active", true)
        .gte("max_weight_kg", weightKg)
        .order("cost", { ascending: true });

      if (hasDimensions && allRates && allRates.length > 0) {
        // Filter by dimensions: length, width, depth (height)
        matchedRate = allRates.find((r: any) =>
          (r.max_length_cm == null || r.max_length_cm >= lengthCm) &&
          (r.max_width_cm == null || r.max_width_cm >= widthCm) &&
          (r.max_depth_cm == null || r.max_depth_cm >= heightCm)
        );
      }

      if (!matchedRate) {
        // Default to Evri Small Parcel (cheapest that fits weight)
        const evriSmall = (allRates ?? []).filter((r: any) =>
          r.carrier === "Evri" && r.size_band === "Small Parcel"
        );
        matchedRate = evriSmall.length > 0 ? evriSmall[0] : (allRates && allRates.length > 0 ? allRates[0] : null);
      }

      shippingCost = matchedRate ? Number(matchedRate.cost) : 0;

      // 6. Get defaults
      const { data: defaults } = await admin
        .from("selling_cost_defaults")
        .select("key, value");
      const defaultsMap: Record<string, number> = {};
      for (const d of defaults ?? []) defaultsMap[d.key] = Number(d.value);
      const packagingCost = defaultsMap["packaging_cost"] ?? 0;
      const riskReserveRate = defaultsMap["risk_reserve_rate"] ?? 0;
      const riskReserve = Math.round(salePrice * (riskReserveRate / 100) * 100) / 100;

      const totalCostToSell = Math.round((carryingValueBasis + packagingCost + shippingCost + totalChannelFees + riskReserve) * 100) / 100;

      result = {
        carrying_value: Math.round(carryingValueBasis * 100) / 100,
        average_carrying_value: Math.round(avgCarrying * 100) / 100,
        stock_unit_count: carryingValues.length,
        packaging_cost: packagingCost,
        shipping_cost: shippingCost,
        channel_fees: Math.round(totalChannelFees * 100) / 100,
        fee_breakdown: feeBreakdown,
        risk_reserve: riskReserve,
        total_cost_to_sell: totalCostToSell,
        margin: Math.round((salePrice - totalCostToSell) * 100) / 100,
        margin_percent: salePrice > 0 ? Math.round(((salePrice - totalCostToSell) / salePrice) * 10000) / 100 : 0,
      };

    /* ── Pricing Engine ── */

    } else if (action === "get-price-transparency") {
      result = await buildPriceTransparency(admin, params);

    } else if (action === "calculate-pricing") {
      const { sku_id, channel: requestedChannel } = params;
      if (!sku_id || !requestedChannel) throw new ValidationError("sku_id and channel are required");
      const channel = normalizeCommerceChannel(requestedChannel);

      const { data: rawQuote, error: quoteErr } = await admin.rpc("commerce_quote_price", {
        p_sku_id: sku_id,
        p_channel: channel,
        p_candidate_price: null,
      });
      if (quoteErr) throw quoteErr;
      result = normalizeQuote(rawQuote, sku_id, channel);

      // Retained only as dead-code reference while the pricing engine settles;
      // the RPC above is the single active calculator for admin pricing.
      if (false) {

      // 1. Get SKU + product info
      const { data: skuData } = await admin
        .from("sku")
        .select("id, sku_code, price, condition_grade, product:product_id(id, mpn, weight_kg, length_cm, width_cm, height_cm)")
        .eq("id", sku_id)
        .single();
      if (!skuData) throw new ValidationError("SKU not found");
      const product = (skuData.product as any) ?? {};
      const mpn = product.mpn;

      // 2. Get defaults
      const { data: defaults } = await admin
        .from("selling_cost_defaults")
        .select("key, value");
      const dm: Record<string, number> = {};
      for (const d of defaults ?? []) dm[d.key] = Number(d.value);
      const minProfit = dm["minimum_profit_amount"] ?? 1;
      const minMargin = dm["minimum_margin_rate"] ?? 0.15;
      const packagingCost = dm["packaging_cost"] ?? 0;
      const riskReserveRate = dm["risk_reserve_rate"] ?? 0;
      const condMultiplier = dm[`condition_multiplier_${skuData.condition_grade}`] ?? 1;

      const { data: channelPricingConfig } = await admin
        .from("channel_pricing_config")
        .select("*")
        .eq("channel", channel)
        .maybeSingle();

      // 3. Get carrying value basis for pooled listings. The floor price uses
      // the highest eligible unit value unless a specific unit is reserved.
      const { data: stockUnits } = await admin
        .from("stock_unit")
        .select("carrying_value, landed_cost")
        .eq("sku_id", sku_id)
        .eq("status", "available");
      const carryingValues = (stockUnits ?? [])
        .map((su: any) => Number(su.carrying_value ?? su.landed_cost ?? 0))
        .filter((value: number) => value > 0);
      const avgCarrying = carryingValues.length > 0
        ? carryingValues.reduce((sum: number, value: number) => sum + value, 0) / carryingValues.length
        : 0;
      const carryingValueBasis = carryingValues.length > 0 ? Math.max(...carryingValues) : 0;

      // 4. Get shipping cost — Evri-first strategy
      const weightKg = product.weight_kg ?? 0;
      const lengthCm = product.length_cm;
      const widthCm = product.width_cm;
      const heightCm = product.height_cm;
      const hasDimensions = lengthCm != null && widthCm != null && heightCm != null;

      // Read Evri tier setting
      const activeTierNum = dm["evri_active_tier"] ?? 1;
      const activeTier = `tier_${activeTierNum}`;
      const preferEvriThreshold = dm["shipping_prefer_evri_threshold"] ?? 1.0;

      // Helper to find best-fit rate from a list
      const findBestFit = (rates: any[]): any => {
        if (hasDimensions && rates.length > 0) {
          const dimMatch = rates.find((r: any) =>
            (r.max_length_cm == null || r.max_length_cm >= lengthCm) &&
            (r.max_width_cm == null || r.max_width_cm >= widthCm) &&
            (r.max_depth_cm == null || r.max_depth_cm >= heightCm)
          );
          if (dimMatch) return dimMatch;
        }
        // Fallback: Evri Small Parcel or cheapest
        const evriSmall = rates.filter((r: any) => r.carrier === "Evri" && r.size_band === "Small Parcel");
        return evriSmall.length > 0 ? evriSmall[0] : (rates.length > 0 ? rates[0] : null);
      };

      // Query Evri direct rates (default channel, active tier)
      const { data: evriRates } = await admin
        .from("shipping_rate_table")
        .select("*")
        .eq("channel", "default")
        .eq("tier", activeTier)
        .eq("destination", "domestic")
        .eq("active", true)
        .gte("max_weight_kg", weightKg)
        .order("cost", { ascending: true });

      let matchedRate = findBestFit(evriRates ?? []);

      // For eBay channel: check if eBay carrier rate offers substantial saving
      if (channel === "ebay" && matchedRate) {
        const { data: ebayRates } = await admin
          .from("shipping_rate_table")
          .select("*")
          .eq("channel", "ebay")
          .eq("destination", "domestic")
          .eq("active", true)
          .gte("max_weight_kg", weightKg)
          .order("cost", { ascending: true });

        const ebayBest = findBestFit(ebayRates ?? []);
        if (ebayBest) {
          const saving = Number(matchedRate.cost) - Number(ebayBest.cost);
          if (saving > preferEvriThreshold) {
            matchedRate = ebayBest;
          }
        }
      }

      const shippingCost = matchedRate ? Number(matchedRate.cost) : 0;

      // 5. Get channel fees
      const { data: fees } = await admin
        .from("channel_fee_schedule")
        .select("*")
        .eq("channel", channel)
        .eq("active", true);

      // For floor calculation, we need a cost_base that doesn't depend on sale_price
      // cost_base = protected carrying value + packaging + shipping
      const costBase = carryingValueBasis + packagingCost + shippingCost;

      // 6. Get normalized market consensus first; fall back to legacy BrickEconomy cache.
      let marketConsensus: number | null = null;
      let marketConfidence = 0;
      const { data: marketSnapshots } = await admin
        .from("market_price_snapshot")
        .select("price, confidence_score, channel, captured_at, source:source_id(source_code)")
        .eq("sku_id", sku_id)
        .in("channel", [channel, "all", "legacy"])
        .order("captured_at", { ascending: false })
        .limit(12);

      type MarketSnapshotRow = {
        price: number | string | null;
        confidence_score: number | string | null;
        channel: string | null;
      };
      const snapshotRows = (marketSnapshots ?? []) as MarketSnapshotRow[];
      const preferredSnapshot =
        snapshotRows.find((row) => row.channel === channel)
        ?? snapshotRows.find((row) => row.channel === "all")
        ?? snapshotRows.find((row) => row.channel === "legacy")
        ?? null;

      if (preferredSnapshot?.price != null) {
        marketConsensus = Number(preferredSnapshot.price);
        marketConfidence = Number(preferredSnapshot.confidence_score ?? 0.5);
      } else if (mpn) {
        // Match by both full MPN (e.g. "10281-1") and base MPN (e.g. "10281")
        const baseMpn = mpn.replace(/-\d+$/, "");
        const candidates = [mpn];
        if (baseMpn !== mpn) candidates.push(baseMpn);
        const { data: beData } = await admin
          .from("brickeconomy_collection")
          .select("current_value")
          .in("item_number", candidates)
          .limit(1)
          .maybeSingle();
        if (beData?.current_value != null) {
          marketConsensus = Number(beData.current_value);
          marketConfidence = 0.7;
        }
      }

      // 7. Compute prices using shared VAT-aware floor calculator
      // Decompose fees into rate-based and fixed components, respecting applies_to
      let effectiveFeeRate = 0;
      let fixedFeeCosts = 0;
      for (const fee of fees ?? []) {
        const rate = (fee.rate_percent ?? 0) / 100;
        const fixed = fee.fixed_amount ?? 0;
        if (fee.applies_to === "sale_plus_shipping") {
          effectiveFeeRate += rate;
          fixedFeeCosts += fixed + (shippingCost * rate);
        } else if (fee.applies_to === "sale_price_inc_vat") {
          effectiveFeeRate += rate * 1.2;
          fixedFeeCosts += fixed;
        } else {
          effectiveFeeRate += rate;
          fixedFeeCosts += fixed;
        }
      }

      const riskRate = riskReserveRate / 100;
      const effectiveMargin = Math.max(minMargin, 0.01);
      const estimateGrossFees = (grossPrice: number): number => {
        let totalFeesGross = 0;
        for (const fee of fees ?? []) {
          let base = grossPrice;
          if (fee.applies_to === "sale_plus_shipping") base = grossPrice + shippingCost;
          else if (fee.applies_to === "sale_price_inc_vat") base = grossPrice * 1.2;
          let amount = (base * ((fee.rate_percent ?? 0) / 100)) + (fee.fixed_amount ?? 0);
          if (fee.min_amount != null && amount < fee.min_amount) amount = fee.min_amount;
          if (fee.max_amount != null && amount > fee.max_amount) amount = fee.max_amount;
          totalFeesGross += amount;
        }
        return Math.round(totalFeesGross * 100) / 100;
      };

      const charmDown = (value: number): number => {
        if (!Number.isFinite(value) || value <= 0) return 0;
        const candidate = Math.floor(value) + 0.99;
        return Math.round((candidate <= value ? candidate : candidate - 1) * 100) / 100;
      };

      // VAT-aware floor: revenue = P/1.2, net fees = gross_fees/1.2
      // P >= 1.2 × (costBase + minProfit + fixedFees/1.2) / (1 - margin - feeRate - risk)
      const netFixedFees = fixedFeeCosts / 1.2;
      const denominator = Math.max(1 - effectiveMargin - effectiveFeeRate - riskRate, 0.05);
      let floorPrice = Math.round((1.2 * (costBase + minProfit + netFixedFees) / denominator) * 100) / 100;

      // Post-check: verify floor covers all fees with min/max clamps (ex-VAT basis)
      for (let i = 0; i < 5; i++) {
        const totalFeesGross = estimateGrossFees(floorPrice);
        const netFees = totalFeesGross / 1.2;
        const riskReserve = (floorPrice / 1.2) * riskRate;
        const requiredExVat = costBase + minProfit + netFees + riskReserve;
        const neededPrice = 1.2 * requiredExVat / (1 - effectiveMargin);
        if (neededPrice <= floorPrice + 0.01) break;
        floorPrice = Math.round(neededPrice * 100) / 100;
      }

      // Also consider existing SKU price as a reference when no market data
      const existingSkuPrice = skuData.price != null ? Number(skuData.price) : null;

      // Ceiling: highest of floor, market consensus, and existing SKU price
      const ceilingBasis = Math.max(floorPrice, marketConsensus ?? floorPrice, existingSkuPrice ?? floorPrice);
      const ceilingPrice = Math.floor(ceilingBasis) + 0.99;

      let targetPrice: number;
      let preUndercutMarketPrice: number | null = null;
      let appliedMarketUndercut = 0;
      let targetFloorClamped = false;
      if (marketConsensus != null) {
        preUndercutMarketPrice = marketConsensus * condMultiplier;
        const minUndercutPct = Math.max(0, Number(channelPricingConfig?.market_undercut_min_pct ?? 0));
        const minUndercutAmount = Math.max(0, Number(channelPricingConfig?.market_undercut_min_amount ?? 0));
        const maxUndercutPct = channelPricingConfig?.market_undercut_max_pct == null
          ? null
          : Math.max(0, Number(channelPricingConfig.market_undercut_max_pct));
        const maxUndercutAmount = channelPricingConfig?.market_undercut_max_amount == null
          ? null
          : Math.max(0, Number(channelPricingConfig.market_undercut_max_amount));
        const minimumUndercut = Math.max(preUndercutMarketPrice * minUndercutPct, minUndercutAmount);
        const maximumUndercutCandidates = [
          maxUndercutPct == null ? null : preUndercutMarketPrice * maxUndercutPct,
          maxUndercutAmount,
        ].filter((value): value is number => value != null && value > 0);
        const maximumUndercut = maximumUndercutCandidates.length > 0
          ? Math.max(...maximumUndercutCandidates)
          : null;
        appliedMarketUndercut = maximumUndercut == null
          ? minimumUndercut
          : Math.min(minimumUndercut, maximumUndercut);
        targetPrice = charmDown(preUndercutMarketPrice - appliedMarketUndercut);
        // Ensure target is at least the floor
        if (targetPrice < floorPrice) {
          targetPrice = floorPrice;
          targetFloorClamped = true;
        }
      } else {
        // No market data — default target to ceiling price
        targetPrice = ceilingPrice;
      }

      const estimatedFeesAtTarget = estimateGrossFees(targetPrice);
      const estimatedNetAtTarget = Math.round((targetPrice - estimatedFeesAtTarget) * 100) / 100;

      // 8. Confidence score (0-1): based on data availability
      let confidence = 0;
      if (carryingValueBasis > 0) confidence += 0.3; // have stock cost
      if (marketConfidence > 0) confidence += Math.min(marketConfidence, 1) * 0.4; // have market data
      if (hasDimensions) confidence += 0.15; // have dimensions for shipping
      if ((fees ?? []).length > 0) confidence += 0.15; // have channel fees
      confidence = Math.round(confidence * 100) / 100;

      result = {
        sku_id,
        channel,
        floor_price: floorPrice,
        target_price: targetPrice,
        ceiling_price: ceilingPrice,
        estimated_fees: estimatedFeesAtTarget,
        estimated_net: estimatedNetAtTarget,
        cost_base: Math.round(costBase * 100) / 100,
        carrying_value: Math.round(carryingValueBasis * 100) / 100,
        average_carrying_value: Math.round(avgCarrying * 100) / 100,
        stock_unit_count: carryingValues.length,
        market_consensus: marketConsensus,
        condition_multiplier: condMultiplier,
        confidence_score: confidence,
        breakdown: {
          carrying_value: Math.round(carryingValueBasis * 100) / 100,
          average_carrying_value: Math.round(avgCarrying * 100) / 100,
          packaging_cost: packagingCost,
          shipping_cost: shippingCost,
          total_fee_rate: Math.round(effectiveFeeRate * 10000) / 100,
          fixed_fee_costs: Math.round(fixedFeeCosts * 100) / 100,
          estimated_fees_at_target: estimatedFeesAtTarget,
          estimated_net_at_target: estimatedNetAtTarget,
          risk_reserve_rate: riskReserveRate,
          min_profit: minProfit,
          min_margin: minMargin * 100,
          market_confidence: Math.round(marketConfidence * 100) / 100,
          pre_undercut_market_price: preUndercutMarketPrice == null ? 0 : Math.round(preUndercutMarketPrice * 100) / 100,
          market_undercut_min_pct: Number(channelPricingConfig?.market_undercut_min_pct ?? 0) * 100,
          market_undercut_min_amount: Number(channelPricingConfig?.market_undercut_min_amount ?? 0),
          market_undercut_max_pct: Number(channelPricingConfig?.market_undercut_max_pct ?? 0) * 100,
          market_undercut_max_amount: Number(channelPricingConfig?.market_undercut_max_amount ?? 0),
          applied_market_undercut: Math.round(appliedMarketUndercut * 100) / 100,
          target_floor_clamped: targetFloorClamped ? 1 : 0,
        },
      };
      }

    } else if (action === "batch-calculate-pricing") {
      const { channel: batchChannel } = params;
      // Default to "web" channel when not specified or "all"
      const targetChannel = (batchChannel && batchChannel !== "all")
        ? (batchChannel === "website" ? "web" : batchChannel)
        : "web";

      // 1. Get all active SKUs with a product (orphan SKUs without product_id are excluded)
      const { data: activeSkus, error: skuErr } = await admin
        .from("sku")
        .select("id, sku_code")
        .eq("active_flag", true)
        .not("product_id", "is", null);
      if (skuErr) throw skuErr;

      // 2. Get existing channel_listing rows for target channel
      const { data: existingListings, error: elErr } = await admin
        .from("channel_listing")
        .select("id, sku_id, channel")
        .eq("channel", targetChannel)
        .not("sku_id", "is", null);
      if (elErr) throw elErr;

      const listedSkuIds = new Set((existingListings ?? []).map((l: any) => l.sku_id));

      // 3. Auto-create missing channel_listing rows for SKUs that don't have one
      const missing = (activeSkus ?? []).filter((s: any) => !listedSkuIds.has(s.id));
      if (missing.length > 0) {
        const newRows = missing.map((s: any) => ({
          channel: targetChannel,
          external_sku: s.sku_code,
          sku_id: s.id,
          listed_quantity: 0,
          offer_status: "DRAFT",
          synced_at: new Date().toISOString(),
        }));
        await admin.from("channel_listing").upsert(newRows, { onConflict: "channel,external_sku", ignoreDuplicates: true });
      }

      // 4. Re-fetch all listings for the target channel
      const { data: allListings, error: alErr } = await admin
        .from("channel_listing")
        .select("id, sku_id, channel")
        .eq("channel", targetChannel)
        .not("sku_id", "is", null);
      if (alErr) throw alErr;

      const results = (allListings ?? []).map((l: any) => ({
        listing_id: l.id, sku_id: l.sku_id, channel: l.channel,
      }));
      result = { listings: results, total: results.length };

    } else if (action === "update-listing-prices") {
      const { listing_id, price_floor, price_target, price_ceiling, confidence_score: cs, pricing_notes: pn, auto_price } = params;
      if (!listing_id) throw new ValidationError("listing_id is required");
      const updates: Record<string, any> = { priced_at: new Date().toISOString() };
      // Compatibility note: legacy price_floor/price_target/price_ceiling are
      // intentionally no longer written here. Persisted pricing decisions now
      // live in price_decision_snapshot, created below via the domain RPC.
      if (cs !== undefined) updates.confidence_score = cs;
      if (pn !== undefined) updates.pricing_notes = pn;

      let auto_price_applied = false;
      let auto_price_reason = "";
      let reviewQueueId: string | null = null;

      if (auto_price && price_target != null) {
        // Guard: reject zero/negative target
        if (price_target <= 0) {
          auto_price_reason = "Target price is zero or negative. Skipped.";
        // Guard: reject target below floor
        } else if (price_floor != null && price_target < price_floor) {
          auto_price_reason = `Target £${price_target} is below floor £${price_floor}. Skipped.`;
        } else {
        // Look up listing to get channel and current listed_price
        const { data: listing } = await admin.from("channel_listing").select("channel, listed_price").eq("id", listing_id).single();
        if (listing) {
          const { data: config } = await admin.from("channel_pricing_config").select("*").eq("channel", listing.channel).single();
          if (config?.auto_price_enabled) {
            const currentPrice = listing.listed_price;
            if (currentPrice == null) {
              // No current price, just set it
              updates.listed_price = price_target;
              auto_price_applied = true;
              auto_price_reason = "Initial price set";
            } else {
              const delta = price_target - currentPrice;
              if (Math.abs(delta) < 0.005) {
                auto_price_reason = "No change needed";
              } else if (delta > 0) {
                // Price increase
                const pctDelta = currentPrice > 0 ? Math.abs(delta) / currentPrice : 0;
                if (pctDelta > 0.10) {
                  const { data: reviewRow, error: reviewErr } = await admin
                    .from("pricing_recalc_review_queue")
                    .insert({
                      channel_listing_id: listing_id,
                      sku_id: params.sku_id ?? null,
                      channel: listing.channel,
                      current_price: currentPrice,
                      proposed_price: price_target,
                      pct_change: pctDelta,
                      direction: "increase",
                      reason: "Auto recalculation exceeds 10% and requires authorise/edit review.",
                      status: "pending",
                    })
                    .select("id")
                    .single();
                  if (reviewErr) throw reviewErr;
                  reviewQueueId = reviewRow?.id ?? null;
                  auto_price_reason = `Increase ${(pctDelta * 100).toFixed(1)}% queued for review`;
                } else {
                const pctOk = config.max_increase_pct == null || (delta / currentPrice) <= config.max_increase_pct;
                const amtOk = config.max_increase_amount == null || delta <= config.max_increase_amount;
                if (pctOk && amtOk) {
                  updates.listed_price = price_target;
                  auto_price_applied = true;
                  auto_price_reason = `Auto-increased from £${currentPrice} to £${price_target}`;
                } else {
                  auto_price_reason = `Increase £${delta.toFixed(2)} exceeds threshold (max ${config.max_increase_pct != null ? (config.max_increase_pct * 100).toFixed(0) + '%' : '∞'}/${config.max_increase_amount != null ? '£' + config.max_increase_amount : '∞'})`;
                }
                }
              } else {
                // Price decrease
                const absDelta = Math.abs(delta);
                const pctDelta = currentPrice > 0 ? absDelta / currentPrice : 0;
                if (pctDelta > 0.10) {
                  const { data: reviewRow, error: reviewErr } = await admin
                    .from("pricing_recalc_review_queue")
                    .insert({
                      channel_listing_id: listing_id,
                      sku_id: params.sku_id ?? null,
                      channel: listing.channel,
                      current_price: currentPrice,
                      proposed_price: price_target,
                      pct_change: pctDelta,
                      direction: "decrease",
                      reason: "Auto recalculation exceeds 10% and requires authorise/edit review.",
                      status: "pending",
                    })
                    .select("id")
                    .single();
                  if (reviewErr) throw reviewErr;
                  reviewQueueId = reviewRow?.id ?? null;
                  auto_price_reason = `Decrease ${(pctDelta * 100).toFixed(1)}% queued for review`;
                } else {
                const pctOk = config.max_decrease_pct == null || (absDelta / currentPrice) <= config.max_decrease_pct;
                const amtOk = config.max_decrease_amount == null || absDelta <= config.max_decrease_amount;
                if (pctOk && amtOk) {
                  updates.listed_price = price_target;
                  auto_price_applied = true;
                  auto_price_reason = `Auto-decreased from £${currentPrice} to £${price_target}`;
                } else {
                  auto_price_reason = `Decrease £${absDelta.toFixed(2)} exceeds threshold (max ${config.max_decrease_pct != null ? (config.max_decrease_pct * 100).toFixed(0) + '%' : '∞'}/${config.max_decrease_amount != null ? '£' + config.max_decrease_amount : '∞'})`;
                }
                }
              }
            }
            if (auto_price_reason) {
              updates.pricing_notes = [pn, auto_price_reason].filter(Boolean).join("; ");
            }
          } else {
            auto_price_reason = "Auto-pricing disabled for channel";
          }
        }
        } // end else (valid target)
        // If skipped due to guards, still record the reason
        if (!auto_price_applied && auto_price_reason) {
          updates.pricing_notes = [pn, auto_price_reason].filter(Boolean).join("; ");
        }
      }

      const { error } = await admin.from("channel_listing").update(updates).eq("id", listing_id);
      if (error) throw error;

      // Create the authoritative immutable pricing snapshot. Only queue an
      // outbound reprice when the listing price actually changed.
      const { data: listingRow } = await admin
        .from("channel_listing")
        .select("sku_id, channel, listed_price")
        .eq("id", listing_id)
        .single();

      let snapshotId: string | null = null;
      let commandId: string | null = null;
      if (listingRow?.sku_id) {
        const candidatePrice = updates.listed_price ?? listingRow.listed_price ?? price_target ?? price_floor ?? null;

        const { data: snapshotData, error: snapshotErr } = await admin.rpc("create_price_decision_snapshot", {
          p_sku_id: listingRow.sku_id,
          p_channel: listingRow.channel,
          p_channel_listing_id: listing_id,
          p_candidate_price: candidatePrice,
        });
        if (snapshotErr) throw snapshotErr;
        snapshotId = snapshotData ?? null;

        // Keep the public web compatibility price in step with the website
        // listing until storefront reads move fully to channel_listing/snapshots.
        if (auto_price_applied && updates.listed_price != null && listingRow.channel === "web") {
          await admin.from("sku").update({ price: updates.listed_price }).eq("id", listingRow.sku_id);
        }

        if (auto_price_applied) {
          const { data: commandData, error: commandErr } = await admin.rpc("queue_listing_command", {
            p_channel_listing_id: listing_id,
            p_command_type: "reprice",
          });
          if (commandErr) throw commandErr;
          commandId = commandData ?? null;
        }
      }

      result = { success: true, auto_price_applied, auto_price_reason, snapshot_id: snapshotId, command_id: commandId, review_queue_id: reviewQueueId };

    } else if (action === "record-price-override") {
      const {
        sku_id,
        channel: rawChannel,
        listing_price,
        reason_code,
        reason_note,
        listing_title,
        listing_description,
      } = params;
      if (!sku_id) throw new ValidationError("sku_id is required");
      if (!rawChannel) throw new ValidationError("channel is required");
      const channel = normalizedPriceChannel(String(rawChannel));
      const newPrice = Number(listing_price);
      if (!Number.isFinite(newPrice) || newPrice <= 0) throw new ValidationError("listing_price must be a positive number");
      if (typeof reason_code !== "string" || !reason_code.trim()) {
        throw new ValidationError("Override reason is required");
      }

      const { data: skuRow, error: skuLookupErr } = await admin
        .from("sku")
        .select("id, sku_code")
        .eq("id", sku_id)
        .single();
      if (skuLookupErr || !skuRow) throw new ValidationError("SKU not found");

      const { data: existingRows, error: existingErr } = await admin
        .from("channel_listing")
        .select("id, listed_price, listing_title, v2_status, updated_at, created_at")
        .eq("sku_id", sku_id)
        .in("channel", [channel, rawChannel]);
      if (existingErr) throw existingErr;

      const candidates = ((existingRows ?? []) as Array<Record<string, any>>).sort((a, b) => {
        const liveDiff = (a.v2_status === "live" ? 0 : 1) - (b.v2_status === "live" ? 0 : 1);
        if (liveDiff !== 0) return liveDiff;
        return new Date(b.updated_at ?? b.created_at ?? 0).getTime()
          - new Date(a.updated_at ?? a.created_at ?? 0).getTime();
      });

      const listingUpdates: Record<string, unknown> = {
        sku_id,
        channel,
        v2_channel: channel === "web" ? "website" : channel,
        external_sku: skuRow.sku_code,
        listed_price: newPrice,
        fee_adjusted_price: newPrice,
        synced_at: new Date().toISOString(),
      };
      if (typeof listing_title === "string") listingUpdates.listing_title = listing_title.trim() || null;
      if (typeof listing_description === "string") listingUpdates.listing_description = listing_description.trim() || null;

      let listingId: string;
      const oldPrice = candidates[0]?.listed_price == null ? null : Number(candidates[0].listed_price);
      if (candidates[0]?.id) {
        const { data: updated, error: updErr } = await admin
          .from("channel_listing")
          .update(listingUpdates)
          .eq("id", candidates[0].id)
          .select("id")
          .single();
        if (updErr) throw updErr;
        listingId = updated.id;
      } else {
        const { data: inserted, error: insErr } = await admin
          .from("channel_listing")
          .insert({
            ...listingUpdates,
            listed_quantity: 0,
            offer_status: "DRAFT",
            v2_status: "draft",
          })
          .select("id")
          .single();
        if (insErr) throw insErr;
        listingId = inserted.id;
      }

      const { data: snapshotId, error: snapshotErr } = await admin.rpc("create_price_decision_snapshot", {
        p_sku_id: sku_id,
        p_channel: channel,
        p_channel_listing_id: listingId,
        p_candidate_price: newPrice,
        p_actor_id: userId,
      });
      if (snapshotErr) throw snapshotErr;

      const { data: snapshotRow } = await admin
        .from("price_decision_snapshot")
        .select("floor_price")
        .eq("id", snapshotId)
        .maybeSingle();
      const floorPrice = snapshotRow?.floor_price == null ? null : Number(snapshotRow.floor_price);
      const overrideType = floorPrice != null && newPrice < floorPrice ? "below_floor" : "manual_price";

      const { data: overrideRow, error: overrideErr } = await admin
        .from("price_override")
        .insert({
          price_decision_snapshot_id: snapshotId,
          sku_id,
          channel_listing_id: listingId,
          channel,
          override_type: overrideType,
          old_price: oldPrice,
          new_price: newPrice,
          reason_code: reason_code.trim(),
          reason_note: typeof reason_note === "string" && reason_note.trim() ? reason_note.trim() : null,
          approved_by: userId,
          performed_by: userId,
        })
        .select("id")
        .single();
      if (overrideErr) throw overrideErr;

      const { data: commandId, error: commandErr } = await admin.rpc("queue_listing_command", {
        p_channel_listing_id: listingId,
        p_command_type: "reprice",
        p_actor_id: userId,
        p_allow_below_floor: overrideType === "below_floor",
      });
      if (commandErr) throw commandErr;

      if (channel === "web") {
        await admin.from("sku").update({ price: newPrice }).eq("id", sku_id);
      }

      result = {
        success: true,
        listing_id: listingId,
        snapshot_id: snapshotId,
        override_id: overrideRow.id,
        command_id: commandId ?? null,
        override_type: overrideType,
      };

    } else if (action === "list-channel-pricing-config") {
      const { data, error } = await admin.from("channel_pricing_config").select("*").order("channel");
      if (error) throw error;
      result = data;

    } else if (action === "upsert-channel-pricing-config") {
      const {
        channel,
        auto_price_enabled,
        max_increase_pct,
        max_increase_amount,
        max_decrease_pct,
        max_decrease_amount,
        market_undercut_min_pct,
        market_undercut_min_amount,
        market_undercut_max_pct,
        market_undercut_max_amount,
      } = params;
      if (!channel) throw new Error("channel is required");
      const { error } = await admin.from("channel_pricing_config").upsert({
        channel: channel === "website" ? "web" : channel,
        auto_price_enabled: auto_price_enabled ?? false,
        max_increase_pct: max_increase_pct ?? null,
        max_increase_amount: max_increase_amount ?? null,
        max_decrease_pct: max_decrease_pct ?? null,
        max_decrease_amount: max_decrease_amount ?? null,
        market_undercut_min_pct: market_undercut_min_pct ?? 0,
        market_undercut_min_amount: market_undercut_min_amount ?? 0,
        market_undercut_max_pct: market_undercut_max_pct ?? null,
        market_undercut_max_amount: market_undercut_max_amount ?? null,
      }, { onConflict: "channel" });
      if (error) throw error;
      result = { success: true };

    } else if (action === "ensure-channel-listing") {
      const { sku_id, channel } = params;
      if (!sku_id || !channel) throw new Error("sku_id and channel are required");

      // Check for existing listing
      const { data: existing } = await admin
        .from("channel_listing")
        .select("id")
        .eq("sku_id", sku_id)
        .eq("channel", channel)
        .limit(1)
        .maybeSingle();

      if (existing) {
        result = { listing_id: existing.id, created: false };
      } else {
        // Get SKU code for external_sku
        const { data: sku } = await admin
          .from("sku")
          .select("sku_code")
          .eq("id", sku_id)
          .single();
        if (!sku) throw new Error("SKU not found");

        const { data: newListing, error: insertErr } = await admin
          .from("channel_listing")
          .upsert({
            channel,
            external_sku: sku.sku_code,
            sku_id,
            listed_quantity: 0,
            offer_status: "DRAFT",
            synced_at: new Date().toISOString(),
          }, { onConflict: "channel,external_sku", ignoreDuplicates: false })
          .select("id")
          .single();
        if (insertErr) throw insertErr;
        result = { listing_id: newListing!.id, created: true };
      }

    /* ── LEGO Catalog ── */

    } else if (action === "list-lego-catalog") {
      const page = params.page ?? 1;
      const pageSize = Math.min(params.pageSize ?? 25, 200);
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      const sortKey = params.sortKey ?? "mpn";
      const sortDir = params.sortDir === "desc" ? false : true; // ascending by default

      let query = admin
        .from("lego_catalog")
        .select("*, theme:theme_id(name)", { count: "exact" });

      // Search
      if (params.search) {
        const term = `%${params.search}%`;
        query = query.or(`name.ilike.${term},mpn.ilike.${term}`);
      }

      // Filters
      if (params.theme_id) query = query.eq("theme_id", params.theme_id);
      if (params.subtheme_name) query = query.eq("subtheme_name", params.subtheme_name);
      if (params.year) query = query.eq("release_year", Number(params.year));
      if (params.retired === "yes") query = query.eq("retired_flag", true);
      else if (params.retired === "no") query = query.eq("retired_flag", false);
      if (params.product_type) query = query.eq("product_type", params.product_type);
      if (params.status) query = query.eq("status", params.status);

      // Sort & paginate
      const sortColumn = ["mpn", "name", "release_year", "piece_count", "retired_flag", "product_type", "status", "created_at", "updated_at"].includes(sortKey) ? sortKey : "mpn";
      query = query.order(sortColumn, { ascending: sortDir }).range(from, to);

      const { data, count, error } = await query;
      if (error) throw error;

      // Flatten theme name
      const rows = (data ?? []).map((r: any) => ({
        ...r,
        theme_name: r.theme?.name ?? null,
        theme: undefined,
      }));

      result = { rows, totalCount: count ?? 0 };

    } else if (action === "lego-catalog-filter-options") {
      // Fetch distinct values for filter dropdowns
      const { data: themes, error: tErr } = await admin
        .from("theme")
        .select("id, name")
        .order("name");
      if (tErr) throw tErr;

      const { data: subthemes, error: sErr } = await admin
        .from("lego_catalog")
        .select("subtheme_name")
        .not("subtheme_name", "is", null)
        .order("subtheme_name");
      if (sErr) throw sErr;
      const uniqueSubthemes = [...new Set((subthemes ?? []).map((r: any) => r.subtheme_name).filter(Boolean))].sort();

      const { data: years, error: yErr } = await admin
        .from("lego_catalog")
        .select("release_year")
        .not("release_year", "is", null)
        .order("release_year", { ascending: false });
      if (yErr) throw yErr;
      const uniqueYears = [...new Set((years ?? []).map((r: any) => r.release_year).filter(Boolean))];

      const { data: productTypes, error: ptErr } = await admin
        .from("lego_catalog")
        .select("product_type")
        .order("product_type");
      if (ptErr) throw ptErr;
      const uniqueProductTypes = [...new Set((productTypes ?? []).map((r: any) => r.product_type).filter(Boolean))].sort();

      result = {
        themes: themes ?? [],
        subthemes: uniqueSubthemes,
        years: uniqueYears,
        productTypes: uniqueProductTypes,
      };

    } else if (action === "update-lego-catalog") {
      const { id, updates: rawUpdates } = params;
      if (!id) throw new ValidationError("id is required");
      if (!rawUpdates || typeof rawUpdates !== "object") throw new ValidationError("updates object is required");

      const ALLOWED_FIELDS = new Set([
        "name", "mpn", "subtheme_name", "piece_count", "release_year", "retired_flag",
        "description", "img_url", "product_type", "status", "version_descriptor",
        "brickeconomy_id", "bricklink_item_no", "brickowl_boid", "rebrickable_id", "theme_id",
      ]);

      const cleanUpdates: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawUpdates)) {
        if (ALLOWED_FIELDS.has(k)) cleanUpdates[k] = v;
      }
      if (Object.keys(cleanUpdates).length === 0) throw new ValidationError("No valid fields to update");

      cleanUpdates.updated_at = new Date().toISOString();

      const { data, error } = await admin
        .from("lego_catalog")
        .update(cleanUpdates)
        .eq("id", id)
        .select("*, theme:theme_id(name)")
        .single();
      if (error) throw error;

      result = { ...data, theme_name: (data as any).theme?.name ?? null, theme: undefined };

    } else if (action === "reconcile-stock") {
      // ── Reconcile stock: first close sold stock, then compare counts with QBO ──
      // Step A: Find sales order lines without linked stock and match available stock (FIFO)
      // Step B: Compare remaining app counts against QBO QtyOnHand
      const clientId = Deno.env.get("QBO_CLIENT_ID");
      const clientSecret = Deno.env.get("QBO_CLIENT_SECRET");
      const realmId = Deno.env.get("QBO_REALM_ID");
      if (!clientId || !clientSecret || !realmId) throw new Error("QBO credentials not configured");

      // Refresh token if needed
      const { data: conn, error: connErr } = await admin
        .from("qbo_connection").select("*").eq("realm_id", realmId).single();
      if (connErr || !conn) throw new Error("No QBO connection found");

      let accessToken = conn.access_token;
      if (new Date(conn.token_expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
        const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
            Accept: "application/json",
          },
          body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
        });
        if (!tokenRes.ok) throw new Error(`Token refresh failed [${tokenRes.status}]`);
        const tokens = await tokenRes.json();
        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
        await admin.from("qbo_connection").update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: expiresAt,
        }).eq("realm_id", realmId);
        accessToken = tokens.access_token;
      }

      const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
      const correlationId = crypto.randomUUID();

      // ── Step A: Close stock for sold orders with unlinked lines ──
      // ── Step A: Close stock for CONFIRMED sales with unlinked lines ──
      // Only process lines from orders that are genuinely completed sales.
      // First, find valid completed order IDs, then find their unlinked lines.
      let stockClosed = 0;
      const closedSkuIds = new Set<string>();
      const refreshedOrderIds = new Set<string>();

      // Step A0: Reopen stock incorrectly closed by previous runs that
      // didn't filter by order status. Find stock_units closed by our
      // reconciliation audit trail and check if the linked order is valid.
      // (audit_event with trigger_type = 'stock_reconciliation_sale')
      // and check if the linked order is still valid
      const { data: reconciledAudits } = await admin
        .from("audit_event")
        .select("entity_id, input_json")
        .eq("trigger_type", "stock_reconciliation_sale")
        .eq("entity_type", "stock_unit")
        .gte("created_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
        .limit(5000);

      let stockReopened = 0;
      for (const audit of (reconciledAudits ?? [])) {
        const lineId = audit.input_json?.sales_order_line_id;
        if (!lineId) continue;

        // Check if the order for this line is actually a valid completed sale
        const { data: lineOrder } = await admin
          .from("sales_order_line")
          .select("sales_order_id, sales_order:sales_order_id(status)")
          .eq("id", lineId)
          .maybeSingle();

        const orderStatus = (lineOrder as any)?.sales_order?.status;
        const validStatuses = VALID_SALE_STATUSES;
        if (orderStatus && !validStatuses.includes(orderStatus)) {
          // This stock was closed for an invalid order. Release the linked
          // line through the subledger so COGS/allocation events are reversed.
          const { error: releaseErr } = await admin.rpc("release_stock_allocation_for_order_line" as never, {
            p_sales_order_line_id: lineId,
            p_reason: "reconcile_stock_invalid_order_status",
          } as never);

          if (!releaseErr) {
            const { error: reopenErr } = await admin
              .from("stock_unit")
              .update({ status: "available", updated_at: new Date().toISOString() })
              .eq("id", audit.entity_id)
              .eq("status", "closed");

            if (!reopenErr) stockReopened++;
          } else {
            // Fall back to making the stock visibly available only when the
            // subledger release fails; leave the line untouched for review.
            await admin
              .from("stock_unit")
              .update({ status: "available", updated_at: new Date().toISOString() })
              .eq("id", audit.entity_id)
              .eq("status", "closed");
          }
        }
      }

      if (stockReopened > 0) {
        console.log(`Step A0: Reopened ${stockReopened} stock units incorrectly closed by prior reconciliation`);
      }

      // Now find unlinked lines ONLY from valid completed orders
      const { data: validOrders } = await admin
        .from("sales_order")
        .select("id")
        .in("status", VALID_SALE_STATUSES);

      const validOrderIds = (validOrders ?? []).map((o: any) => o.id);

      if (validOrderIds.length > 0) {
        // Process in batches (Supabase .in() has limits)
        const BATCH = 100;
        for (let b = 0; b < validOrderIds.length; b += BATCH) {
          const batchIds = validOrderIds.slice(b, b + BATCH);
          const { data: unlinkedLines } = await admin
            .from("sales_order_line")
            .select("id, sales_order_id, sku_id, quantity")
            .in("sales_order_id", batchIds)
            .is("stock_unit_id", null);

          for (const line of (unlinkedLines ?? [])) {
            if ((line.quantity ?? 1) !== 1) {
              await admin.from("reconciliation_case").insert({
                case_type: "unallocated_order_line",
                severity: "high",
                sales_order_id: line.sales_order_id,
                sales_order_line_id: line.id,
                related_entity_type: "sales_order_line",
                related_entity_id: line.id,
                suspected_root_cause: "Historical order line has quantity greater than one and cannot be represented by a single stock_unit_id.",
                recommended_action: "Split the order line into unit-level lines or record an approved manual allocation exception.",
                evidence: {
                  sku_id: line.sku_id,
                  quantity: line.quantity,
                  source: "admin-data.reconcile-stock",
                  correlation_id: correlationId,
                },
              });
              continue;
            }

            const { data: allocation, error: allocationErr } = await admin.rpc("allocate_stock_for_order_line" as never, {
              p_sales_order_line_id: line.id,
              p_actor_id: userId,
            } as never);

            if (allocationErr) {
              console.warn(`Subledger allocation failed for line ${line.id}:`, allocationErr.message);
              continue;
            }

            const allocationResult = allocation as Record<string, unknown> | null;
            if (allocationResult?.status === "allocated") {
              stockClosed++;
              closedSkuIds.add(line.sku_id);
              refreshedOrderIds.add(line.sales_order_id);
            }
          }
        }
      }

      for (const orderId of refreshedOrderIds) {
        await admin.rpc("refresh_order_line_economics" as never, { p_sales_order_id: orderId } as never);
      }

      if (stockClosed > 0) {
        console.log(`Step A: Closed ${stockClosed} stock units for ${closedSkuIds.size} SKUs with unlinked sales`);
      }

      // ── Step A2: Update channel listings for closed SKUs ──
      for (const skuId of closedSkuIds) {
        const { data: skuUnits } = await admin
          .from("stock_unit")
          .select("id, status, v2_status")
          .eq("sku_id", skuId);
        const availableCount = (skuUnits ?? []).filter(isAvailableStockUnit).length;

        await admin
          .from("channel_listing")
          .update({ listed_quantity: availableCount, synced_at: new Date().toISOString() })
          .eq("sku_id", skuId);
      }

      // ── Step B: Fetch all Inventory items from QBO (paginated) ──
      const qboItems: any[] = [];
      let startPos = 1;
      const pageSize = 1000;
      while (true) {
        const q = encodeURIComponent(`SELECT * FROM Item WHERE Type = 'Inventory' STARTPOSITION ${startPos} MAXRESULTS ${pageSize}`);
        const res = await fetch(`${baseUrl}/query?query=${q}`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`QBO query failed [${res.status}]: ${await res.text()}`);
        const data = await res.json();
        const page = data?.QueryResponse?.Item ?? [];
        qboItems.push(...page);
        if (page.length < pageSize) break;
        startPos += pageSize;
      }

      // Load all SKUs with qbo_item_id
      const { data: allSkus } = await admin
        .from("sku")
        .select("id, qbo_item_id, sku_code");
      const skuByQboId = new Map<string, { id: string; sku_code: string }>();
      for (const s of (allSkus ?? [])) {
        if (s.qbo_item_id) skuByQboId.set(s.qbo_item_id, { id: s.id, sku_code: s.sku_code });
      }

      let totalChecked = 0;
      let inSync = 0;
      let writtenOff = 0;
      let backfilled = 0;
      let appHigher = 0;
      let qboHigher = 0;
      const details: any[] = [];

      for (const qboItem of qboItems) {
        const qboItemId = String(qboItem.Id);
        const sku = skuByQboId.get(qboItemId);
        if (!sku) continue;

        const qboQty = Math.floor(Number(qboItem.QtyOnHand ?? 0));

        // Count units still saleable in the app. v2_status is the subledger
        // sale marker, so sold units are excluded even if legacy status lags.
        const { data: appUnits } = await admin
          .from("stock_unit")
          .select("id, status, v2_status")
          .eq("sku_id", sku.id);
        const availableUnits = (appUnits ?? []).filter(isAvailableStockUnit);
        const available = availableUnits.length;
        totalChecked++;

        if (available === qboQty) {
          inSync++;
          continue;
        }

        if (available > qboQty) {
          // App has more than QBO — auto write-off excess (FIFO, oldest first)
          const excess = available - qboQty;
          appHigher++;

          const { data: excessUnits } = await admin
            .from("stock_unit")
            .select("id, status, v2_status, landed_cost, carrying_value")
            .eq("sku_id", sku.id)
            .order("created_at", { ascending: true });

          let unitWrittenOff = 0;
          for (const unit of (excessUnits ?? []).filter(isAvailableStockUnit).slice(0, excess)) {
            await admin.from("stock_unit").update({
              status: "written_off",
              accumulated_impairment: unit.landed_cost ?? 0,
              updated_at: new Date().toISOString(),
            }).eq("id", unit.id);

            await admin.from("audit_event").insert({
              entity_type: "stock_unit", entity_id: unit.id,
              trigger_type: "stock_reconciliation_write_off", actor_type: "user",
              actor_id: userId, source_system: "admin-data",
              correlation_id: correlationId,
              before_json: { status: unit.status, carrying_value: unit.carrying_value },
              after_json: { status: "written_off", carrying_value: 0 },
              input_json: { sku_code: sku.sku_code, qbo_qty: qboQty, app_qty: available, reason: "app_higher_auto_write_off" },
            });
            unitWrittenOff++;
          }

          writtenOff += unitWrittenOff;
          details.push({
            sku_code: sku.sku_code,
            qbo_qty: qboQty,
            app_qty: available,
            diff: excess,
            direction: "app_higher",
            action: `wrote_off_${unitWrittenOff}`,
          });
        } else {
          // QBO has more than app — report only (do NOT auto-create ghost units)
          const shortfall = qboQty - available;
          qboHigher++;
          details.push({
            sku_code: sku.sku_code,
            qbo_qty: qboQty,
            app_qty: available,
            diff: shortfall,
            direction: "qbo_higher",
            action: "report_only",
          });
        }
      }

      // Sort details so biggest discrepancies appear first
      details.sort((a: any, b: any) => b.diff - a.diff);

      result = {
        success: true,
        correlation_id: correlationId,
        stock_reopened: stockReopened,
        stock_closed: stockClosed,
        stock_written_off: writtenOff,
        stock_backfilled: backfilled,
        total_qbo_items: qboItems.length,
        total_checked: totalChecked,
        in_sync: inSync,
        app_higher: appHigher,
        qbo_higher: qboHigher,
        details,
      };

    } else if (action === "cleanup-orphaned-stock") {
      // Delete ALL stock units with no receipt line link (ghost units from failed rebuilds)
      const { data: orphans } = await admin.from("stock_unit")
        .select("id")
        .is("inbound_receipt_line_id", null);

      const orphanIds = (orphans ?? []).map((o: any) => o.id);
      let deleted = 0;
      if (orphanIds.length > 0) {
        // Delete in batches of 100
        for (let i = 0; i < orphanIds.length; i += 100) {
          const batch = orphanIds.slice(i, i + 100);
          await admin.from("stock_unit").delete().in("id", batch);
          deleted += batch.length;
        }
      }

      await admin.from("audit_event").insert({
        entity_type: "system", entity_id: "00000000-0000-0000-0000-000000000000",
        trigger_type: "cleanup_orphaned_stock", actor_type: "user", actor_id: userId,
        source_system: "admin-data",
        output_json: { orphans_deleted: deleted },
      });

      result = { success: true, orphans_deleted: deleted };

    } else if (action === "rebuild-from-qbo") {
      // Full reset: QBO is the absolute source of truth.
      // Phase 1: Clear ALL QBO landing tables (stale data purge)
      // Phase 2: Delete all canonical transactional data
      // Phase 3: UI drives re-sync from QBO live, then processes
      const rebuildCorrelationId = crypto.randomUUID();
      let receiptsDeleted = 0, ordersDeleted = 0;
      let stockDeleted = 0;
      let payoutsDeleted = 0;

      // ═══ Phase 1: CLEAR all QBO landing tables (fresh start) ═══
      // This ensures deleted QBO records don't get re-created from stale landing data
      let landingPurchasesCleared = 0, landingSalesCleared = 0, landingRefundsCleared = 0;
      let landingItemsCleared = 0, landingCustomersCleared = 0, landingVendorsCleared = 0, landingTaxCleared = 0;

      const clearTable = async (table: string) => {
        const { data } = await admin.from(table).select("id");
        const ids = (data ?? []).map((r: any) => r.id);
        if (ids.length > 0) {
          for (let i = 0; i < ids.length; i += 100) {
            const batch = ids.slice(i, i + 100);
            await admin.from(table).delete().in("id", batch);
          }
        }
        return ids.length;
      };

      landingPurchasesCleared = await clearTable("landing_raw_qbo_purchase");
      landingSalesCleared = await clearTable("landing_raw_qbo_sales_receipt");
      landingRefundsCleared = await clearTable("landing_raw_qbo_refund_receipt");
      landingItemsCleared = await clearTable("landing_raw_qbo_item");
      landingCustomersCleared = await clearTable("landing_raw_qbo_customer");
      landingVendorsCleared = await clearTable("landing_raw_qbo_vendor");
      landingTaxCleared = await clearTable("landing_raw_qbo_tax_entity");
      await clearTable("landing_raw_qbo_deposit");

      console.log(`Phase 1 complete: cleared ${landingPurchasesCleared} purchases, ${landingSalesCleared} sales, ${landingRefundsCleared} refunds, ${landingItemsCleared} items, ${landingCustomersCleared} customers, ${landingVendorsCleared} vendors, ${landingTaxCleared} tax entities from landing tables`);

      // ═══ Phase 2: Delete ALL canonical transactional data ═══

      // Step 1: Delete ALL sales orders — NO stock reopening
      const { data: allOrders } = await admin.from("sales_order").select("id");
      for (const order of (allOrders ?? [])) {
        await admin.from("sales_order_line").delete().eq("sales_order_id", order.id);
        await admin.from("sales_order").delete().eq("id", order.id);
        ordersDeleted++;
      }

      // Step 2: Delete ALL payout data
      const { data: allPayouts } = await admin.from("payouts").select("id");
      for (const payout of (allPayouts ?? [])) {
        const { data: payoutFees } = await admin.from("payout_fee").select("id").eq("payout_id", payout.id);
        for (const fee of (payoutFees ?? [])) {
          await admin.from("payout_fee_line").delete().eq("payout_fee_id", fee.id);
        }
        await admin.from("payout_fee").delete().eq("payout_id", payout.id);
        await admin.from("payout_orders").delete().eq("payout_id", payout.id);
        await admin.from("payouts").delete().eq("id", payout.id);
        payoutsDeleted++;
      }

      // Step 3: Delete ALL stock units
      const { data: allStock } = await admin.from("stock_unit").select("id");
      const allStockIds = (allStock ?? []).map((u: any) => u.id);
      if (allStockIds.length > 0) {
        for (let i = 0; i < allStockIds.length; i += 100) {
          const batch = allStockIds.slice(i, i + 100);
          await admin.from("stock_unit").delete().in("id", batch);
        }
        stockDeleted = allStockIds.length;
      }

      // Step 3b: Delete ALL purchase_line_items then purchase_batches
      let purchaseBatchesDeleted = 0;
      await admin.from("purchase_line_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      const { data: allBatches } = await admin.from("purchase_batches").select("id");
      if ((allBatches ?? []).length > 0) {
        for (let i = 0; i < allBatches!.length; i += 100) {
          const batch = allBatches!.slice(i, i + 100);
          await admin.from("purchase_batches").delete().in("id", batch.map((b: any) => b.id));
        }
        purchaseBatchesDeleted = allBatches!.length;
      }

      // Step 4: Delete ALL inbound receipts and lines
      const { data: allReceipts } = await admin.from("inbound_receipt").select("id");
      for (const receipt of (allReceipts ?? [])) {
        await admin.from("inbound_receipt_line").delete().eq("inbound_receipt_id", receipt.id);
        await admin.from("inbound_receipt").delete().eq("id", receipt.id);
        receiptsDeleted++;
      }

      // Step 4b: Delete ALL SKUs
      let skusDeleted = 0;
      const { data: allSkus } = await admin.from("sku").select("id");
      const allSkuIds = (allSkus ?? []).map((s: any) => s.id);
      if (allSkuIds.length > 0) {
        for (let i = 0; i < allSkuIds.length; i += 100) {
          const batch = allSkuIds.slice(i, i + 100);
          await admin.from("price_audit_log").delete().in("sku_id", batch);
        }
        for (let i = 0; i < allSkuIds.length; i += 100) {
          const batch = allSkuIds.slice(i, i + 100);
          await admin.from("sku").delete().in("id", batch);
        }
        skusDeleted = allSkuIds.length;
      }

      // Step 4c: Delete ALL vendors
      let vendorsDeleted = 0;
      const { data: allVendors } = await admin.from("vendor").select("id");
      if ((allVendors ?? []).length > 0) {
        for (const v of allVendors!) {
          await admin.from("vendor").delete().eq("id", v.id);
        }
        vendorsDeleted = allVendors!.length;
      }

      // Step 5: Clean up audit events
      await admin.from("audit_event").delete()
        .in("trigger_type", [
          "qbo_inventory_adjustment", "qbo_qty_backfill",
          "stock_reconciliation_write_off", "stock_reconciliation_backfill",
          "stock_reconciliation_sale", "purchase_reprocessing",
          "cleanup_orphaned_stock",
        ]);

      // Step 6: Reset non-QBO landing tables for re-matching
      const { data: stripeData } = await admin.from("landing_raw_stripe_event")
        .update({ status: "pending", processed_at: null, error_message: null }).neq("status", "pending")
        .select("id");
      const stripeReset = stripeData?.length ?? 0;

      const { data: ebayOrderData } = await admin.from("landing_raw_ebay_order")
        .update({ status: "pending", processed_at: null, error_message: null }).neq("status", "pending")
        .select("id");
      const ebayOrdersReset = ebayOrderData?.length ?? 0;

      const { data: ebayPayoutData } = await admin.from("landing_raw_ebay_payout")
        .update({ status: "pending", processed_at: null, error_message: null }).neq("status", "pending")
        .select("id");
      const ebayPayoutsReset = ebayPayoutData?.length ?? 0;

      const { data: ebayListingData } = await admin.from("landing_raw_ebay_listing")
        .update({ status: "pending", processed_at: null, error_message: null }).neq("status", "pending")
        .select("id");
      const ebayListingsReset = ebayListingData?.length ?? 0;

      // Step 7: Delete ALL customers
      let customersDeleted = 0;
      const { data: allCustomers } = await admin.from("customer").select("id");
      const allCustomerIds = (allCustomers ?? []).map((c: any) => c.id);
      if (allCustomerIds.length > 0) {
        for (let i = 0; i < allCustomerIds.length; i += 100) {
          const batch = allCustomerIds.slice(i, i + 100);
          await admin.from("customer").delete().in("id", batch);
        }
        customersDeleted = allCustomerIds.length;
      }

      // Step 8: Delete ALL tax_code and vat_rate
      let taxCodesDeleted = 0, vatRatesDeleted = 0;
      const { data: allTaxCodes } = await admin.from("tax_code").select("id");
      if ((allTaxCodes ?? []).length > 0) {
        for (const tc of allTaxCodes!) {
          await admin.from("tax_code").delete().eq("id", tc.id);
        }
        taxCodesDeleted = allTaxCodes!.length;
      }
      const { data: allVatRates } = await admin.from("vat_rate").select("id");
      if ((allVatRates ?? []).length > 0) {
        for (const vr of allVatRates!) {
          await admin.from("vat_rate").delete().eq("id", vr.id);
        }
        vatRatesDeleted = allVatRates!.length;
      }

      // Delete eBay payout transactions
      await admin.from("ebay_payout_transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");

      await admin.from("audit_event").insert({
        entity_type: "system", entity_id: "00000000-0000-0000-0000-000000000000",
        trigger_type: "rebuild_from_qbo", actor_type: "user", actor_id: userId,
        source_system: "admin-data", correlation_id: rebuildCorrelationId,
        output_json: {
          landing_cleared: {
            purchases: landingPurchasesCleared, sales: landingSalesCleared,
            refunds: landingRefundsCleared, items: landingItemsCleared,
            customers: landingCustomersCleared, vendors: landingVendorsCleared,
            tax: landingTaxCleared,
          },
          canonical_deleted: {
            orders: ordersDeleted, receipts: receiptsDeleted, stock: stockDeleted,
            payouts: payoutsDeleted, skus: skusDeleted, vendors: vendorsDeleted,
            customers: customersDeleted, tax_codes: taxCodesDeleted, vat_rates: vatRatesDeleted,
          },
          non_qbo_reset: {
            stripe: stripeReset, ebay_orders: ebayOrdersReset,
            ebay_payouts: ebayPayoutsReset, ebay_listings: ebayListingsReset,
          },
        },
      });

      result = {
        success: true,
        correlation_id: rebuildCorrelationId,
        phase: "landing_cleared_and_canonical_wiped",
        landing_cleared: {
          purchases: landingPurchasesCleared, sales: landingSalesCleared,
          refunds: landingRefundsCleared, items: landingItemsCleared,
          customers: landingCustomersCleared, vendors: landingVendorsCleared,
          tax: landingTaxCleared,
        },
        receipts_deleted: receiptsDeleted,
        orders_deleted: ordersDeleted,
        stock_deleted: stockDeleted,
        payouts_deleted: payoutsDeleted,
        skus_deleted: skusDeleted,
        vendors_deleted: vendorsDeleted,
        stripe_reset: stripeReset,
        ebay_orders_reset: ebayOrdersReset,
        ebay_payouts_reset: ebayPayoutsReset,
        ebay_listings_reset: ebayListingsReset,
        customers_deleted: customersDeleted,
        tax_codes_deleted: taxCodesDeleted,
        vat_rates_deleted: vatRatesDeleted,
      };

    } else if (action === "proxy-function") {
      // Server-side proxy for Edge Functions that are unreachable from the browser
      // (e.g. CORS preflight failure due to cold-start or deployment issues).
      const fnName = params.function;
      if (!fnName || typeof fnName !== "string") throw new ValidationError("Missing 'function' parameter");

      const allowed = ["qbo-sync-sales", "qbo-sync-purchases", "qbo-sync-customers", "qbo-sync-items", "qbo-sync-vendors", "qbo-sync-tax-rates", "qbo-sync-deposits", "stripe-sync-customers", "stripe-sync-products"];
      if (!allowed.includes(fnName)) throw new ValidationError(`Function '${fnName}' not allowed for proxying`);

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const fnUrl = `${supabaseUrl}/functions/v1/${fnName}`;
      const fnBody = params.body ?? {};

      const fnRes = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          "x-webhook-trigger": "true",
        },
        body: JSON.stringify(fnBody),
      });

      if (!fnRes.ok) {
        let detail = `HTTP ${fnRes.status}`;
        try {
          const errPayload = await fnRes.json();
          detail = errPayload?.error ?? errPayload?.message ?? detail;
        } catch { /* not JSON */ }
        throw new Error(`${fnName} failed: ${detail}`);
      }

      result = await fnRes.json();

    } else if (action === "get-stripe-test-mode") {
      const { data } = await admin.from("app_settings")
        .select("stripe_test_mode").single();
      result = { stripe_test_mode: data?.stripe_test_mode ?? false };

    } else if (action === "get-ai-provider") {
      const { data } = await admin.from("app_settings")
        .select("ai_provider").single();
      const provider = (data as { ai_provider?: string } | null)?.ai_provider;
      result = { ai_provider: provider === "openai" ? "openai" : "lovable" };

    } else if (action === "set-ai-provider") {
      const { provider } = params;
      if (provider !== "lovable" && provider !== "openai") {
        throw new ValidationError("'provider' must be 'lovable' or 'openai'");
      }
      const { error: updErr } = await admin.from("app_settings")
        .update({
          ai_provider: provider,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        })
        .eq("id", "00000000-0000-0000-0000-000000000001");
      if (updErr) throw new Error(`Failed to update ai_provider: ${updErr.message}`);

      await admin.from("audit_event").insert({
        entity_type: "system",
        entity_id: "00000000-0000-0000-0000-000000000001",
        trigger_type: "ai_provider_changed",
        actor_type: "user",
        actor_id: userId,
        source_system: "admin-data",
        output_json: { ai_provider: provider },
      });
      result = { ai_provider: provider };

    } else if (action === "get-test-order-count") {
      const { count } = await admin.from("sales_order")
        .select("id", { count: "exact", head: true })
        .eq("is_test", true);
      result = { count: count ?? 0 };

    } else if (action === "set-stripe-test-mode") {
      const { enabled } = params;
      if (typeof enabled !== "boolean") throw new ValidationError("'enabled' must be a boolean");

      await admin.from("app_settings")
        .update({
          stripe_test_mode: enabled,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        })
        .eq("id", "00000000-0000-0000-0000-000000000001");

      // If disabling test mode, clean up all test data
      let ordersDeleted = 0, linesDeleted = 0, stockReopened = 0, eventsDeleted = 0;
      if (!enabled) {
        // 1. Find all test orders
        const { data: testOrders } = await admin.from("sales_order")
          .select("id").eq("is_test", true);

        for (const order of (testOrders ?? [])) {
          // Reopen stock units closed by test order lines
          const { data: lines } = await admin.from("sales_order_line")
            .select("stock_unit_id").eq("sales_order_id", order.id);
          for (const line of (lines ?? [])) {
            if (line.stock_unit_id) {
              const { data: updated } = await admin.from("stock_unit")
                .update({ status: "available" })
                .eq("id", line.stock_unit_id)
                .eq("status", "closed")
                .select("id");
              if (updated?.length) stockReopened++;
            }
          }
          // Delete order lines
          const { data: deletedLines } = await admin.from("sales_order_line")
            .delete().eq("sales_order_id", order.id).select("id");
          linesDeleted += deletedLines?.length ?? 0;

          // Delete audit events for this order
          await admin.from("audit_event").delete()
            .eq("entity_type", "sales_order").eq("entity_id", order.id);
        }

        // 2. Delete test orders
        if ((testOrders ?? []).length > 0) {
          await admin.from("sales_order").delete().eq("is_test", true);
          ordersDeleted = testOrders!.length;
        }

        // 3. Delete test landing events
        const { data: deletedEvents } = await admin.from("landing_raw_stripe_event")
          .delete().eq("is_test", true).select("id");
        eventsDeleted = deletedEvents?.length ?? 0;

        // 4. Audit the cleanup
        await admin.from("audit_event").insert({
          entity_type: "system",
          entity_id: "00000000-0000-0000-0000-000000000001",
          trigger_type: "stripe_test_mode_cleanup",
          actor_type: "user",
          actor_id: userId,
          source_system: "admin-data",
          after_json: {
            orders_deleted: ordersDeleted,
            lines_deleted: linesDeleted,
            stock_reopened: stockReopened,
            events_deleted: eventsDeleted,
          },
        });
      }

      result = {
        success: true,
        stripe_test_mode: enabled,
        cleanup: !enabled ? { orders_deleted: ordersDeleted, lines_deleted: linesDeleted, stock_reopened: stockReopened, events_deleted: eventsDeleted } : undefined,
      };

    } else if (action === "list-staging-errors") {
      // Query all landing tables for error records
      const LANDING_TABLES = [
        { table: "landing_raw_qbo_purchase", entity: "Purchase" },
        { table: "landing_raw_qbo_sales_receipt", entity: "Sales Receipt" },
        { table: "landing_raw_qbo_refund_receipt", entity: "Refund Receipt" },
        { table: "landing_raw_qbo_item", entity: "Item" },
        { table: "landing_raw_qbo_customer", entity: "Customer" },
        { table: "landing_raw_qbo_vendor", entity: "Vendor" },
        { table: "landing_raw_qbo_tax_entity", entity: "Tax Entity" },
        { table: "landing_raw_stripe_event", entity: "Stripe Event" },
        { table: "landing_raw_ebay_order", entity: "eBay Order" },
        { table: "landing_raw_ebay_payout", entity: "eBay Payout" },
        { table: "landing_raw_ebay_listing", entity: "eBay Listing" },
      ];

      const allErrors: any[] = [];
      for (const { table, entity } of LANDING_TABLES) {
        const { data } = await admin.from(table)
          .select("id, external_id, status, error_message, received_at, raw_payload")
          .eq("status", "error")
          .order("received_at", { ascending: false })
          .limit(50);
        for (const row of (data ?? [])) {
          allErrors.push({
            ...row,
            table_name: table,
            entity_type: entity,
          });
        }
      }

      // Sort by received_at desc
      allErrors.sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
      result = allErrors;

    } else if (action === "retry-landing-record") {
      const { table, id: recordId } = params;
      if (!table || !recordId) throw new ValidationError("table and id are required");
      const ALLOWED_TABLES = [
        "landing_raw_qbo_purchase", "landing_raw_qbo_sales_receipt", "landing_raw_qbo_refund_receipt",
        "landing_raw_qbo_item", "landing_raw_qbo_customer", "landing_raw_qbo_vendor",
        "landing_raw_qbo_tax_entity", "landing_raw_stripe_event",
        "landing_raw_ebay_order", "landing_raw_ebay_payout", "landing_raw_ebay_listing",
      ];
      if (!ALLOWED_TABLES.includes(table)) throw new ValidationError(`Invalid table: ${table}`);
      const { error } = await admin.from(table)
        .update({ status: "pending", processed_at: null, error_message: null })
        .eq("id", recordId);
      if (error) throw error;
      result = { success: true };

    } else if (action === "skip-landing-record") {
      const { table, id: recordId } = params;
      if (!table || !recordId) throw new ValidationError("table and id are required");
      const ALLOWED_TABLES = [
        "landing_raw_qbo_purchase", "landing_raw_qbo_sales_receipt", "landing_raw_qbo_refund_receipt",
        "landing_raw_qbo_item", "landing_raw_qbo_customer", "landing_raw_qbo_vendor",
        "landing_raw_qbo_tax_entity", "landing_raw_stripe_event",
        "landing_raw_ebay_order", "landing_raw_ebay_payout", "landing_raw_ebay_listing",
      ];
      if (!ALLOWED_TABLES.includes(table)) throw new ValidationError(`Invalid table: ${table}`);
      const { error } = await admin.from(table)
        .update({ status: "skipped", processed_at: new Date().toISOString() })
        .eq("id", recordId);
      if (error) throw error;
      result = { success: true };

    } else if (action === "reconcile-purchases" || action === "reconcile-sales" ||
               action === "reconcile-customers" || action === "reconcile-items" ||
               action === "reconcile-vendors") {
      // ── Generic QBO reconciliation ──
      const clientId = Deno.env.get("QBO_CLIENT_ID");
      const clientSecret = Deno.env.get("QBO_CLIENT_SECRET");
      const realmId = Deno.env.get("QBO_REALM_ID");
      if (!clientId || !clientSecret || !realmId) throw new Error("QBO credentials not configured");

      const { data: conn, error: connErr } = await admin
        .from("qbo_connection").select("*").eq("realm_id", realmId).single();
      if (connErr || !conn) throw new Error("No QBO connection found");

      let accessToken = conn.access_token;
      if (new Date(conn.token_expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
        const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
            Accept: "application/json",
          },
          body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
        });
        if (!tokenRes.ok) throw new Error(`Token refresh failed [${tokenRes.status}]`);
        const tokens = await tokenRes.json();
        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
        await admin.from("qbo_connection").update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: expiresAt,
        }).eq("realm_id", realmId);
        accessToken = tokens.access_token;
      }

      const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
      const correlationId = crypto.randomUUID();

      // Helper: paginated QBO query
      const queryQbo = async (sql: string, entityKey: string) => {
        const all: any[] = [];
        let startPos = 1;
        const pageSize = 1000;
        while (true) {
          const q = encodeURIComponent(`${sql} STARTPOSITION ${startPos} MAXRESULTS ${pageSize}`);
          const res = await fetch(`${baseUrl}/query?query=${q}`, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
          });
          if (!res.ok) throw new Error(`QBO query failed [${res.status}]: ${await res.text()}`);
          const data = await res.json();
          const page = data?.QueryResponse?.[entityKey] ?? [];
          all.push(...page);
          if (page.length < pageSize) break;
          startPos += pageSize;
        }
        return all;
      };

      const details: any[] = [];
      let totalQbo = 0, totalApp = 0, inSync = 0, missingInApp = 0, missingInQbo = 0, mismatched = 0, autoFixed = 0;

      if (action === "reconcile-purchases") {
        const qboRecords = await queryQbo("SELECT * FROM Purchase", "Purchase");
        // Filter to inventory-only purchases (matching processor logic)
        const inventoryPurchases = qboRecords.filter((r: any) =>
          (r.Line ?? []).some((l: any) => l.DetailType === "ItemBasedExpenseLineDetail")
        );
        totalQbo = inventoryPurchases.length;
        const qboMap = new Map(inventoryPurchases.map((r: any) => [String(r.Id), r]));

        const { data: appRecords } = await admin.from("inbound_receipt").select("id, qbo_purchase_id, total_amount, vendor_name, txn_date");
        totalApp = (appRecords ?? []).length;
        const appMap = new Map((appRecords ?? []).filter((r: any) => r.qbo_purchase_id).map((r: any) => [r.qbo_purchase_id, r]));

        // QBO records missing in app
        for (const [qboId, qbo] of qboMap) {
          if (!appMap.has(qboId)) {
            missingInApp++;
            details.push({ entity: qbo.EntityRef?.name ?? qboId, qbo_id: qboId, issue: "In QBO but missing from app", action: "flag" });
          } else {
            const app = appMap.get(qboId)!;
            const qboTotal = Math.round(Number(qbo.TotalAmt ?? 0) * 100) / 100;
            const appTotal = Math.round(Number(app.total_amount ?? 0) * 100) / 100;
            if (Math.abs(qboTotal - appTotal) > 0.01) {
              mismatched++;
              details.push({ entity: app.vendor_name ?? qboId, qbo_id: qboId, issue: `Amount mismatch: QBO £${qboTotal} vs App £${appTotal}`, action: "flag" });
            } else {
              inSync++;
            }
          }
        }
        // App records missing in QBO
        for (const [qboId, app] of appMap) {
          if (!qboMap.has(qboId)) {
            missingInQbo++;
            details.push({ entity: app.vendor_name ?? qboId, qbo_id: qboId, issue: "In app but deleted from QBO", action: "flag" });
          }
        }

      } else if (action === "reconcile-sales") {
        const qboRecords = await queryQbo("SELECT * FROM SalesReceipt", "SalesReceipt");
        totalQbo = qboRecords.length;
        const qboMap = new Map(qboRecords.map((r: any) => [String(r.Id), r]));

        const { data: appRecords } = await admin.from("sales_order").select("id, qbo_sales_receipt_id, gross_total, origin_channel, order_number");
        totalApp = (appRecords ?? []).length;
        const appMap = new Map((appRecords ?? []).filter((r: any) => r.qbo_sales_receipt_id).map((r: any) => [r.qbo_sales_receipt_id, r]));

        for (const [qboId, qbo] of qboMap) {
          if (!appMap.has(qboId)) {
            missingInApp++;
            details.push({ entity: qbo.DocNumber ?? qboId, qbo_id: qboId, issue: "In QBO but missing from app", action: "flag" });
          } else {
            const app = appMap.get(qboId)!;
            const qboTotalAmt = Number(qbo.TotalAmt ?? 0);
            const qboTotal = Math.round(qboTotalAmt * 100) / 100;
            const appTotal = Math.round(Number(app.gross_total ?? 0) * 100) / 100;
            if (Math.abs(qboTotal - appTotal) > 0.01) {
              mismatched++;
              details.push({ entity: app.order_number ?? qboId, qbo_id: qboId, issue: `Amount mismatch: QBO £${qboTotal} vs App £${appTotal}`, action: "flag" });
            } else {
              inSync++;
            }
          }
        }
        for (const [qboId, app] of appMap) {
          if (!qboMap.has(qboId)) {
            missingInQbo++;
            details.push({ entity: app.order_number ?? qboId, qbo_id: qboId, issue: "In app but deleted from QBO", action: "flag" });
          }
        }

      } else if (action === "reconcile-customers") {
        const qboRecords = await queryQbo("SELECT * FROM Customer WHERE Active = true", "Customer");
        totalQbo = qboRecords.length;
        const qboMap = new Map(qboRecords.map((r: any) => [String(r.Id), r]));

        const { data: appRecords } = await admin.from("customer").select("id, qbo_customer_id, display_name, email");
        totalApp = (appRecords ?? []).length;
        const appWithQbo = (appRecords ?? []).filter((r: any) => r.qbo_customer_id);
        const appMap = new Map(appWithQbo.map((r: any) => [r.qbo_customer_id, r]));

        for (const [qboId, qbo] of qboMap) {
          if (!appMap.has(qboId)) {
            missingInApp++;
            details.push({ entity: qbo.DisplayName ?? qboId, qbo_id: qboId, issue: "In QBO but missing from app", action: "flag" });
          } else {
            const app = appMap.get(qboId)!;
            if (app.display_name !== qbo.DisplayName) {
              mismatched++;
              details.push({ entity: qbo.DisplayName, qbo_id: qboId, issue: `Name mismatch: QBO "${qbo.DisplayName}" vs App "${app.display_name}"`, action: "flag" });
            } else {
              inSync++;
            }
          }
        }
        // Delete stale app customers not in QBO
        for (const [qboId, app] of appMap) {
          if (!qboMap.has(qboId)) {
            missingInQbo++;
            await admin.from("customer").delete().eq("id", app.id);
            autoFixed++;
            details.push({ entity: app.display_name ?? qboId, qbo_id: qboId, issue: "In app but deleted from QBO", action: "auto_deleted" });
          }
        }

      } else if (action === "reconcile-items") {
        const qboRecords = await queryQbo("SELECT * FROM Item WHERE Type = 'Inventory'", "Item");
        totalQbo = qboRecords.length;
        const qboMap = new Map(qboRecords.map((r: any) => [String(r.Id), r]));

        const { data: appRecords } = await admin.from("sku").select("id, qbo_item_id, sku_code, name");
        totalApp = (appRecords ?? []).length;
        const appWithQbo = (appRecords ?? []).filter((r: any) => r.qbo_item_id);
        const appMap = new Map(appWithQbo.map((r: any) => [r.qbo_item_id, r]));

        for (const [qboId, qbo] of qboMap) {
          if (!appMap.has(qboId)) {
            missingInApp++;
            details.push({ entity: qbo.Name ?? qboId, qbo_id: qboId, issue: "In QBO but no matching SKU in app", action: "flag" });
          } else {
            inSync++;
          }
        }
        for (const [qboId, app] of appMap) {
          if (!qboMap.has(qboId)) {
            missingInQbo++;
            details.push({ entity: app.sku_code ?? qboId, qbo_id: qboId, issue: "SKU in app but item deleted from QBO", action: "flag" });
          }
        }

      } else if (action === "reconcile-vendors") {
        const qboRecords = await queryQbo("SELECT * FROM Vendor WHERE Active = true", "Vendor");
        totalQbo = qboRecords.length;
        const qboMap = new Map(qboRecords.map((r: any) => [String(r.Id), r]));

        const { data: appRecords } = await admin.from("vendor").select("id, qbo_vendor_id, display_name");
        totalApp = (appRecords ?? []).length;
        const appWithQbo = (appRecords ?? []).filter((r: any) => r.qbo_vendor_id);
        const appMap = new Map(appWithQbo.map((r: any) => [r.qbo_vendor_id, r]));

        for (const [qboId, qbo] of qboMap) {
          if (!appMap.has(qboId)) {
            missingInApp++;
            details.push({ entity: qbo.DisplayName ?? qboId, qbo_id: qboId, issue: "In QBO but missing from app", action: "flag" });
          } else {
            const app = appMap.get(qboId)!;
            if (app.display_name !== qbo.DisplayName) {
              mismatched++;
              details.push({ entity: qbo.DisplayName, qbo_id: qboId, issue: `Name mismatch: QBO "${qbo.DisplayName}" vs App "${app.display_name}"`, action: "flag" });
            } else {
              inSync++;
            }
          }
        }
        // Delete stale app vendors not in QBO
        for (const [qboId, app] of appMap) {
          if (!qboMap.has(qboId)) {
            missingInQbo++;
            await admin.from("vendor").delete().eq("id", app.id);
            autoFixed++;
            details.push({ entity: app.display_name ?? qboId, qbo_id: qboId, issue: "In app but deleted from QBO", action: "auto_deleted" });
          }
        }
      }

      details.sort((a: any, b: any) => {
        const order: Record<string, number> = { auto_deleted: 0, flag: 1 };
        return (order[a.action] ?? 2) - (order[b.action] ?? 2);
      });

      result = {
        success: true,
        correlation_id: correlationId,
        total_qbo: totalQbo,
        total_app: totalApp,
        in_sync: inSync,
        missing_in_app: missingInApp,
        missing_in_qbo: missingInQbo,
        mismatched,
        auto_fixed: autoFixed,
        details,
      };

    } else if (action === "cleanup-ghost-units") {
      // Delete stock units with no purchase provenance (ghosts)
      const { data: ghosts, error: ghostErr } = await admin
        .from("stock_unit")
        .select("id")
        .is("batch_id", null)
        .is("line_item_id", null);
      if (ghostErr) throw ghostErr;

      const ghostIds = (ghosts ?? []).map((g: any) => g.id);
      let deleted = 0;
      let releasedLines = 0;
      // Delete in batches of 100
      for (let i = 0; i < ghostIds.length; i += 100) {
        const batch = ghostIds.slice(i, i + 100);
        // Release linked sale-line economics through the subledger before
        // deleting the orphaned stock units.
        const { data: linkedLines, error: linkedErr } = await admin
          .from("sales_order_line")
          .select("id")
          .in("stock_unit_id", batch);
        if (linkedErr) throw linkedErr;

        for (const line of (linkedLines ?? []) as Array<{ id: string }>) {
          const { error: releaseErr } = await admin.rpc("release_stock_allocation_for_order_line" as never, {
            p_sales_order_line_id: line.id,
            p_reason: "cleanup_ghost_units",
          } as never);
          if (releaseErr) throw releaseErr;
          releasedLines++;
        }

        const { error: delErr } = await admin
          .from("stock_unit")
          .delete()
          .in("id", batch);
        if (delErr) throw delErr;
        deleted += batch.length;
      }

      // Reset errored purchases that failed due to UID conflicts
      const { data: erroredPurchases } = await admin
        .from("landing_raw_qbo_purchase")
        .select("id, external_id")
        .eq("status", "error")
        .ilike("error_message", "%duplicate key%");

      let resetCount = 0;
      for (const ep of (erroredPurchases ?? [])) {
        await resetQboPurchase(admin, ep.external_id, ep.id);
        resetCount++;
      }

      result = { success: true, deleted, releasedLines, resetCount, message: `Deleted ${deleted} ghost stock units, released ${releasedLines} sale lines, reset ${resetCount} errored purchases to pending` };

    } else if (action === "reset-qbo-purchase") {
      // Targeted reset for specific stuck QBO purchases
      const ids: string[] = params.ids ?? [];
      if (ids.length === 0) throw new ValidationError("ids array required");
      let resetCount = 0;
      for (const qboPurchaseId of ids) {
        const { data: landing } = await admin
          .from("landing_raw_qbo_purchase")
          .select("id")
          .eq("external_id", qboPurchaseId)
          .maybeSingle();
        if (!landing) continue;
        await resetQboPurchase(admin, qboPurchaseId, landing.id);
        resetCount++;
      }
      result = { success: true, resetCount, message: `Reset ${resetCount} purchases to pending` };

    } else if (action === "recalc-avg-cost") {
      // Refresh deprecated compatibility rollups through the subledger RPC.
      const { data: updated, error: rollupErr } = await admin.rpc("refresh_sku_cost_rollups" as never, {
        p_sku_id: null,
      } as never);
      if (rollupErr) throw rollupErr;
      const updatedCount = Number(updated ?? 0);

      result = { success: true, updated: updatedCount, message: `Recalculated avg_cost on ${updatedCount} SKUs` };

    } else if (action === "retry-failed-qbo-push") {
      const { data: resetRows, error: resetErr } = await admin
        .from("sales_order")
        .update({ qbo_sync_status: "pending", qbo_retry_count: 0 } as any)
        .in("qbo_sync_status", ["failed", "needs_manual_review"])
        .select("id");
      if (resetErr) throw resetErr;

      let queued = 0;
      const queueErrors: Array<{ order_id: string; error: string }> = [];
      for (const row of (resetRows ?? []) as Array<{ id: string }>) {
        const { error: queueErr } = await admin
          .rpc("queue_qbo_posting_intents_for_order", { p_sales_order_id: row.id });
        if (queueErr) {
          queueErrors.push({ order_id: row.id, error: queueErr.message });
        } else {
          queued++;
        }
      }

      result = { reset: (resetRows ?? []).length, queued, queue_errors: queueErrors };

    } else if (action === "reset_payout_sync") {
      const { payoutId: resetPayoutId, scope } = params as { payoutId: string; scope: "expenses" | "deposit" | "all" };
      if (!resetPayoutId) throw new ValidationError("payoutId is required");
      if (!["expenses", "deposit", "all"].includes(scope)) throw new ValidationError("scope must be expenses, deposit, or all");

      const results: Record<string, number> = {};

      if (scope === "expenses" || scope === "all") {
        const { data: updated } = await admin
          .from("ebay_payout_transactions")
          .update({ qbo_purchase_id: null } as never)
          .eq("payout_id" as never, resetPayoutId)
          .select("id");
        results.expensesReset = (updated ?? []).length;
      }

      if (scope === "deposit" || scope === "all") {
        // Find the payout by external_payout_id
        const { data: payoutRow } = await admin
          .from("payouts")
          .select("id")
          .eq("external_payout_id", resetPayoutId)
          .maybeSingle();
        if (payoutRow) {
          await admin
            .from("payouts")
            .update({ qbo_deposit_id: null, qbo_expense_id: null, qbo_sync_status: "pending", qbo_sync_error: null } as never)
            .eq("id" as never, payoutRow.id);
          results.depositReset = 1;

          // Also clear linked sales_order.qbo_sales_receipt_id so the app's view
          // matches QBO after the user has manually deleted SalesReceipts there.
          // Linkage is via payout_orders AND via ebay_payout_transactions (SALE rows).
          const orderIds = new Set<string>();

          const { data: linkedOrders } = await admin
            .from("payout_orders")
            .select("sales_order_id")
            .eq("payout_id", payoutRow.id);
          for (const r of (linkedOrders ?? []) as Array<{ sales_order_id: string | null }>) {
            if (r.sales_order_id) orderIds.add(r.sales_order_id);
          }

          const { data: txnRows } = await admin
            .from("ebay_payout_transactions")
            .select("matched_order_id, order_id, transaction_id, transaction_type")
            .eq("payout_id" as never, resetPayoutId);
          const txnRefs: string[] = [];
          for (const t of (txnRows ?? []) as Array<{ matched_order_id: string | null; order_id: string | null; transaction_id: string | null; transaction_type: string | null }>) {
            if (t.matched_order_id) orderIds.add(t.matched_order_id);
            if (t.order_id) txnRefs.push(t.order_id);
            if (t.transaction_id) txnRefs.push(t.transaction_id);
          }
          if (txnRefs.length > 0) {
            const { data: refOrders } = await admin
              .from("sales_order")
              .select("id")
              .in("origin_reference", txnRefs);
            for (const r of (refOrders ?? []) as Array<{ id: string }>) {
              orderIds.add(r.id);
            }
          }

          let salesReceiptsReset = 0;
          if (orderIds.size > 0) {
            const { data: clearedOrders } = await admin
              .from("sales_order")
              .update({ qbo_sales_receipt_id: null, qbo_sync_status: "pending", qbo_last_error: null } as never)
              .in("id", Array.from(orderIds))
              .select("id");
            salesReceiptsReset = (clearedOrders ?? []).length;
          }
          results.salesReceiptsReset = salesReceiptsReset;
        } else {
          results.depositReset = 0;
          results.salesReceiptsReset = 0;
        }
      }

      result = { success: true, ...results };

    } else if (action === "backfill-stripe-payout-fees") {
      // One-off / repeatable backfill for Stripe payouts whose payout_fee
      // rows were never written (e.g. payouts received before the webhook
      // started inserting per-charge fees). Idempotent: skips existing fees
      // by external_order_id (= Stripe payment_intent id).
      const { payoutId: targetPayoutId } = params as { payoutId?: string };
      if (!targetPayoutId) throw new ValidationError("payoutId is required");

      // Resolve to local payout row (accept either the local UUID or the Stripe po_… id)
      type PayoutRow = { id: string; external_payout_id: string | null; channel: string | null; net_amount: number | null };
      let payoutRow: PayoutRow | null = null;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetPayoutId);
      if (isUuid) {
        const { data } = await admin.from("payouts").select("id, external_payout_id, channel, net_amount").eq("id", targetPayoutId).maybeSingle();
        payoutRow = data as PayoutRow | null;
      } else {
        const { data } = await admin.from("payouts").select("id, external_payout_id, channel, net_amount").eq("external_payout_id", targetPayoutId).maybeSingle();
        payoutRow = data as PayoutRow | null;
      }
      if (!payoutRow) throw new ValidationError(`Payout not found: ${targetPayoutId}`);
      if (payoutRow.channel !== "stripe") throw new ValidationError(`Payout ${payoutRow.id} is not a Stripe payout`);
      if (!payoutRow.external_payout_id) throw new ValidationError(`Payout ${payoutRow.id} has no external_payout_id`);

      // Pick the right Stripe key based on app_settings.stripe_test_mode
      const { data: settings } = await admin.from("app_settings").select("stripe_test_mode").maybeSingle();
      const isTestMode = !!(settings as { stripe_test_mode?: boolean } | null)?.stripe_test_mode;
      const stripeKey = isTestMode
        ? (Deno.env.get("STRIPE_SANDBOX_SECRET_KEY") || "")
        : (Deno.env.get("STRIPE_SECRET_KEY") || "");
      if (!stripeKey) throw new ValidationError(`Stripe ${isTestMode ? "sandbox " : ""}secret key is not configured`);

      const StripeMod = (await import("https://esm.sh/stripe@14.21.0?target=deno")).default;
      const stripe = new StripeMod(stripeKey, { apiVersion: "2024-06-20" });

      // Pull all balance transactions for this payout (paginate)
      type BT = { id: string; fee: number; source: string | null; type: string };
      const allBts: BT[] = [];
      let starting_after: string | undefined = undefined;
      // Defensive cap to avoid runaway loops
      for (let page = 0; page < 20; page++) {
        const resp: { data: BT[]; has_more: boolean } = await stripe.balanceTransactions.list({
          payout: payoutRow.external_payout_id,
          limit: 100,
          starting_after,
        } as Record<string, unknown>);
        for (const bt of resp.data as BT[]) allBts.push(bt);
        if (!resp.has_more) break;
        starting_after = resp.data[resp.data.length - 1]?.id;
        if (!starting_after) break;
      }

      // Resolve payment intents for each charge bt
      const perCharge: Array<{ pi: string; chargeId: string; feeAmount: number }> = [];
      let residualFee = 0;
      for (const bt of allBts) {
        if (bt.source && bt.source.startsWith("ch_")) {
          try {
            const charge = await stripe.charges.retrieve(bt.source);
            const pi = (charge as { payment_intent: string | null }).payment_intent;
            if (pi) {
              perCharge.push({ pi, chargeId: bt.source, feeAmount: bt.fee / 100 });
            } else {
              residualFee += bt.fee / 100;
            }
          } catch {
            residualFee += bt.fee / 100;
          }
        } else if (bt.fee > 0) {
          residualFee += bt.fee / 100;
        }
      }

      // Idempotency: skip pi's already in payout_fee for this payout
      const { data: existingFees } = await admin
        .from("payout_fee")
        .select("external_order_id")
        .eq("payout_id", payoutRow.id);
      const haveSet = new Set(
        ((existingFees ?? []) as Array<{ external_order_id: string | null }>)
          .map((r) => r.external_order_id)
          .filter((v): v is string => !!v)
      );
      const toInsertCharges = perCharge.filter((c) => !haveSet.has(c.pi));

      // Map pi → sales_order_id
      const piList = toInsertCharges.map((c) => c.pi);
      const piToOrder = new Map<string, string>();
      if (piList.length > 0) {
        const { data: orders } = await admin
          .from("sales_order")
          .select("id, payment_reference")
          .in("payment_reference", piList);
        for (const o of (orders ?? []) as Array<{ id: string; payment_reference: string | null }>) {
          if (o.payment_reference) piToOrder.set(o.payment_reference, o.id);
        }
      }

      let inserted = 0;
      if (toInsertCharges.length > 0) {
        const rows = toInsertCharges.map((c) => ({
          payout_id: payoutRow!.id,
          sales_order_id: piToOrder.get(c.pi) ?? null,
          external_order_id: c.pi,
          channel: "stripe",
          fee_category: "payment_processing",
          amount: Math.round(c.feeAmount * 100) / 100,
          description: `Stripe processing fee — charge ${c.chargeId}`,
        }));
        const { error: insErr, data: insData } = await admin
          .from("payout_fee")
          .insert(rows as never)
          .select("id");
        if (insErr) throw new Error(`Failed to insert payout_fee rows: ${insErr.message}`);
        inserted = (insData ?? []).length;
      }

      // Backfill missing payout_orders join rows so reconcile sees them.
      // Include order_gross sourced from sales_order.gross_total so that
      // reconcile can compute order_net = gross - fees correctly.
      let linkedOrders = 0;
      if (piToOrder.size > 0) {
        const orderIds = Array.from(new Set(piToOrder.values()));
        const { data: grossRows } = await admin
          .from("sales_order")
          .select("id, gross_total")
          .in("id", orderIds);
        const grossById = new Map<string, number>();
        for (const g of (grossRows ?? []) as Array<{ id: string; gross_total: number | null }>) {
          grossById.set(g.id, Number(g.gross_total ?? 0));
        }
        const links = orderIds.map((oid) => ({
          payout_id: payoutRow!.id,
          sales_order_id: oid,
          order_gross: grossById.get(oid) ?? 0,
        }));
        const { error: linkErr } = await admin
          .from("payout_orders")
          .upsert(links as never, { onConflict: "payout_id,sales_order_id" as never });
        if (linkErr) console.warn("Failed to upsert payout_orders:", linkErr);
        else linkedOrders = links.length;
      }

      // Re-trigger reconciliation so per-order fee/net columns are recomputed
      let reconcileTriggered = false;
      try {
        const url = `${supabaseUrl}/functions/v1/v2-reconcile-payout`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ payoutId: payoutRow.id }),
        });
        reconcileTriggered = resp.ok;
      } catch (e) {
        console.warn("v2-reconcile-payout trigger failed:", e);
      }

      result = {
        success: true,
        payoutId: payoutRow.id,
        externalPayoutId: payoutRow.external_payout_id,
        balanceTransactions: allBts.length,
        chargesFound: perCharge.length,
        feesInserted: inserted,
        feesSkipped: perCharge.length - toInsertCharges.length,
        residualFeeUnbooked: Math.round(residualFee * 100) / 100,
        ordersLinked: linkedOrders,
        reconcileTriggered,
      };

    } else if (action === "get-channel-schema") {
      // params: { channel, marketplace?, category_id }
      const channel = params.channel;
      const marketplace = params.marketplace ?? "EBAY_GB";
      const categoryId = params.category_id;
      if (!channel || !categoryId) {
        throw new ValidationError("channel and category_id are required");
      }
      const { data: schema } = await admin
        .from("channel_category_schema")
        .select("id, channel, marketplace, category_id, category_name, schema_fetched_at")
        .eq("channel", channel)
        .eq("marketplace", marketplace)
        .eq("category_id", categoryId)
        .maybeSingle();
      if (!schema) {
        result = { schema: null, attributes: [] };
      } else {
        const { data: attrs } = await admin
          .from("channel_category_attribute")
          .select("*")
          .eq("schema_id", schema.id)
          .order("sort_order", { ascending: true });
        result = { schema, attributes: attrs ?? [] };
      }
    } else if (action === "get-product-attributes") {
      // params: { product_id, namespace? }
      const productId = params.product_id;
      if (!productId) throw new ValidationError("product_id is required");
      const query = admin
        .from("product_attribute")
        .select("id, namespace, key, value, value_json, source, updated_at")
        .eq("product_id", productId);
      if (params.namespace) query.eq("namespace", params.namespace);
      const { data, error } = await query;
      if (error) throw error;
      result = data ?? [];
    } else if (action === "save-product-attributes") {
      // params: { product_id, namespace, attributes, source?,
      //           channel?, marketplace?, category_id? }
      const productId = params.product_id;
      const namespace = params.namespace;
      const attrs = params.attributes ?? {};
      const source = params.source ?? "manual";
      const channel = params.channel ?? null;
      const marketplace = params.marketplace ?? null;
      const categoryId = params.category_id ?? null;
      if (!productId || !namespace) {
        throw new ValidationError("product_id and namespace are required");
      }
      if (!["core", "ebay", "gmc", "meta"].includes(namespace)) {
        throw new ValidationError(`Invalid namespace: ${namespace}`);
      }

      const upserts: any[] = [];
      const deletes: string[] = [];
      for (const [key, raw] of Object.entries(attrs)) {
        const isArray = Array.isArray(raw);
        const isEmpty =
          raw == null ||
          (typeof raw === "string" && (raw as string).trim() === "") ||
          (isArray && (raw as unknown[]).length === 0);
        if (isEmpty) {
          deletes.push(key);
          continue;
        }
        upserts.push({
          product_id: productId,
          namespace,
          channel,
          marketplace,
          category_id: categoryId,
          aspect_key: key,
          key,
          value: isArray ? null : String(raw),
          value_json: isArray ? raw : null,
          source,
        });
      }

      const buildScopedDelete = (keys: string[]) => {
        let q = admin
          .from("product_attribute")
          .delete()
          .eq("product_id", productId)
          .eq("namespace", namespace)
          .in("key", keys);
        q = channel === null ? q.is("channel", null) : q.eq("channel", channel);
        q = marketplace === null ? q.is("marketplace", null) : q.eq("marketplace", marketplace);
        q = categoryId === null ? q.is("category_id", null) : q.eq("category_id", categoryId);
        return q;
      };

      if (deletes.length > 0) {
        await buildScopedDelete(deletes);
      }
      if (upserts.length > 0) {
        // Delete-then-insert per row so the partial unique index that uses
        // COALESCE on nullable scope cols works correctly.
        for (const row of upserts) {
          await buildScopedDelete([row.key]);
          const { error } = await admin.from("product_attribute").insert(row);
          if (error) throw error;
        }
      }
      result = { success: true, upserted: upserts.length, deleted: deletes.length };
    } else if (action === "diagnostics-snapshot") {
      const limit = Number(params.limit ?? 200);
      const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 10), 1000) : 200;

      const [
        { data: tableRows, error: tableErr },
        { data: rpcRows, error: rpcErr },
        { data: settingsRows, error: settingsErr },
        { data: rolesRows, error: rolesErr },
        { data: landingRows, error: landingErr },
        { data: auditRows, error: auditErr }
      ] = await Promise.all([
        admin.schema("information_schema").from("tables").select("table_schema, table_name").in("table_schema", ["public"]).order("table_schema").order("table_name"),
        admin.schema("information_schema").from("routines").select("routine_schema, routine_name").eq("routine_schema", "public").order("routine_name"),
        admin.from("app_settings").select("id, stripe_test_mode, updated_at, updated_by").limit(200),
        admin.from("user_roles").select("role"),
        admin.from("landing_raw_qbo_purchase").select("id, external_id, status, error_message, received_at, processed_at").in("status", ["error", "pending"]).order("received_at", { ascending: false }).limit(safeLimit),
        admin.from("audit_event").select("id, entity_type, entity_id, source_system, trigger_type, occurred_at, actor_id").order("occurred_at", { ascending: false }).limit(safeLimit)
      ]);

      const roleCounts: Record<string, number> = {};
      for (const row of rolesRows ?? []) roleCounts[row.role] = (roleCounts[row.role] ?? 0) + 1;

      result = {
        generated_at: new Date().toISOString(),
        schema: {
          tables: tableErr ? [] : (tableRows ?? []),
          table_error: tableErr?.message ?? null,
          routines: rpcErr ? [] : (rpcRows ?? []),
          routine_error: rpcErr?.message ?? null,
        },
        health: {
          app_settings_rows: settingsRows?.length ?? 0,
          user_role_counts: roleCounts,
          pending_or_error_qbo_landing: landingRows?.length ?? 0,
          settings_error: settingsErr?.message ?? null,
          roles_error: rolesErr?.message ?? null,
        },
        logs: {
          audit_events: auditErr ? [] : (auditRows ?? []),
          audit_error: auditErr?.message ?? null,
          landing_qbo_errors: landingErr ? [] : (landingRows ?? []),
          landing_error: landingErr?.message ?? null,
        },
      };
    } else if (action === "set-product-channel-category") {
      // params: { product_id, channel, category_id, marketplace? }
      const productId = params.product_id;
      const channel = params.channel;
      const categoryId = params.category_id;
      const marketplace = params.marketplace ?? "EBAY_GB";
      if (!productId || !channel) {
        throw new ValidationError("product_id and channel are required");
      }
      const updates: Record<string, unknown> = {};
      if (channel === "ebay") {
        updates.ebay_category_id = categoryId ?? null;
        updates.ebay_marketplace = marketplace;
      } else if (channel === "gmc") {
        updates.gmc_product_category = categoryId ?? null;
      } else if (channel === "meta") {
        updates.meta_category = categoryId ?? null;
      } else {
        throw new ValidationError(`Unsupported channel: ${channel}`);
      }
      const { error } = await admin.from("product").update(updates).eq("id", productId);
      if (error) throw error;
      result = { success: true };
    } else if (action === "bulk-set-product-channel-category") {
      // params: { product_ids: string[], channel, category_id, marketplace? }
      const productIds: string[] = Array.isArray(params.product_ids) ? params.product_ids : [];
      const channel = params.channel;
      const categoryId = params.category_id ?? null;
      const marketplace = params.marketplace ?? "EBAY_GB";
      if (productIds.length === 0 || !channel) {
        throw new ValidationError("product_ids and channel are required");
      }
      if (channel === "ebay") {
        // Caller is already authorized as admin/staff above; the bulk_set_ebay_category
        // RPC checks auth.uid() which is NULL under the service-role client, so we
        // perform the update directly instead.
        const { data: updatedRows, error } = await admin
          .from("product")
          .update({ ebay_category_id: categoryId, ebay_marketplace: marketplace })
          .in("id", productIds)
          .select("id");
        if (error) throw error;
        result = { success: true, updated: updatedRows?.length ?? productIds.length };
      } else {
        const updates: Record<string, unknown> = {};
        if (channel === "gmc") updates.gmc_product_category = categoryId;
        else if (channel === "meta") updates.meta_category = categoryId;
        else throw new ValidationError(`Unsupported channel: ${channel}`);
        const { error } = await admin.from("product").update(updates).in("id", productIds);
        if (error) throw error;
        result = { success: true, updated: productIds.length };
      }
    } else if (action === "diagnostics-snapshot") {
      const limit = Math.min(Number(params.limit) || 200, 1000);

      const [tablesRes, routinesRes, settingsRes, rolesRes, landingPendingRes, auditRes, landingErrRes] = await Promise.all([
        admin.from("information_schema.tables" as never).select("table_schema, table_name").eq("table_schema", "public"),
        admin.from("information_schema.routines" as never).select("routine_schema, routine_name").eq("routine_schema", "public"),
        admin.from("app_settings").select("*", { count: "exact", head: true }),
        admin.from("user_roles").select("role"),
        admin.from("landing_raw_qbo").select("*", { count: "exact", head: true }).in("status", ["pending", "error"]),
        admin.from("audit_events").select("*").order("created_at", { ascending: false }).limit(limit),
        admin.from("landing_raw_qbo").select("*").eq("status", "error").order("created_at", { ascending: false }).limit(limit),
      ]);

      const userRoleCounts: Record<string, number> = {};
      for (const r of (rolesRes.data ?? []) as Array<{ role: string }>) {
        userRoleCounts[r.role] = (userRoleCounts[r.role] ?? 0) + 1;
      }

      result = {
        generated_at: new Date().toISOString(),
        schema: {
          tables: tablesRes.data ?? [],
          routines: routinesRes.data ?? [],
          table_error: tablesRes.error?.message ?? null,
          routine_error: routinesRes.error?.message ?? null,
        },
        health: {
          app_settings_rows: settingsRes.count ?? 0,
          settings_error: settingsRes.error?.message ?? null,
          roles_error: rolesRes.error?.message ?? null,
          user_role_counts: userRoleCounts,
          pending_or_error_qbo_landing: landingPendingRes.count ?? 0,
        },
        logs: {
          audit_events: auditRes.data ?? [],
          landing_qbo_errors: landingErrRes.data ?? [],
          audit_error: auditRes.error?.message ?? null,
          landing_error: landingErrRes.error?.message ?? null,
        },
      };
    } else if (action === "gmc-readiness") {
      const limit = Math.min(Number(params.limit) || 250, 1000);
      const [
        connRes,
        skuRes,
        webListingRes,
        gmcListingRes,
        stockRes,
        commandRes,
        attrRes,
      ] = await Promise.all([
        admin
          .from("google_merchant_connection")
          .select("id, merchant_id, data_source, token_expires_at, updated_at")
          .limit(1)
          .maybeSingle(),
        admin
          .from("sku")
          .select("id, sku_code, condition_grade, active_flag, product_id, product:product_id(id, mpn, name, seo_title, seo_description, description, img_url, ean, upc, isbn, gmc_product_category, subtheme_name, weight_kg)")
          .eq("active_flag", true)
          .order("sku_code", { ascending: true })
          .limit(limit),
        admin
          .from("channel_listing")
          .select("id, sku_id, channel, external_sku, offer_status, v2_status, listed_price, listed_quantity, synced_at")
          .eq("channel", "web"),
        admin
          .from("channel_listing")
          .select("id, sku_id, channel, external_sku, external_listing_id, offer_status, v2_status, listed_price, listed_quantity, raw_data, synced_at")
          .in("channel", ["google_shopping", "gmc"]),
        admin
          .from("stock_unit")
          .select("sku_id, status, v2_status"),
        admin
          .from("v_outbound_command_with_references" as never)
          .select("*")
          .eq("entity_type" as never, "channel_listing")
          .in("target_system" as never, ["google_shopping", "gmc"] as never)
          .order("created_at" as never, { ascending: false })
          .limit(500),
        admin
          .from("product_attribute")
          .select("product_id, key, source_values_jsonb, chosen_source, custom_value")
          .eq("namespace", "core")
          .in("key", ["ean", "upc", "isbn"]),
      ]);

      if (connRes.error) throw connRes.error;
      if (skuRes.error) throw skuRes.error;
      if (webListingRes.error) throw webListingRes.error;
      if (gmcListingRes.error) throw gmcListingRes.error;
      if (stockRes.error) throw stockRes.error;
      if (commandRes.error) throw commandRes.error;
      if (attrRes.error) throw attrRes.error;

      const conn = connRes.data as any;
      const connected = Boolean(conn?.id);
      const dataSourceConfigured = Boolean(conn?.data_source);
      const tokenExpired = conn?.token_expires_at ? String(conn.token_expires_at) < new Date().toISOString() : null;

      const webBySku = new Map<string, any>();
      for (const listing of (webListingRes.data ?? []) as any[]) {
        const live = listing.v2_status === "live" || ["live", "published", "PUBLISHED"].includes(String(listing.offer_status ?? ""));
        if (live && listing.sku_id) webBySku.set(listing.sku_id, listing);
      }

      const gmcBySku = new Map<string, any>();
      for (const listing of (gmcListingRes.data ?? []) as any[]) {
        if (!listing.sku_id) continue;
        const existing = gmcBySku.get(listing.sku_id);
        if (!existing || String(listing.updated_at ?? listing.synced_at ?? "") > String(existing.updated_at ?? existing.synced_at ?? "")) {
          gmcBySku.set(listing.sku_id, listing);
        }
      }

      const stockBySku = new Map<string, number>();
      for (const unit of (stockRes.data ?? []) as any[]) {
        if (!unit.sku_id) continue;
        const available = unit.status === "available" || ["graded", "listed", "restocked"].includes(String(unit.v2_status ?? ""));
        if (available) stockBySku.set(unit.sku_id, (stockBySku.get(unit.sku_id) ?? 0) + 1);
      }

      const commandsByListing = new Map<string, any>();
      for (const command of (commandRes.data ?? []) as any[]) {
        const entityId = command.entity_id;
        if (entityId && !commandsByListing.has(entityId)) commandsByListing.set(entityId, command);
      }

      const attrsByProduct = new Map<string, Record<string, any>>();
      for (const attr of (attrRes.data ?? []) as any[]) {
        if (!attr.product_id) continue;
        const bucket = attrsByProduct.get(attr.product_id) ?? {};
        bucket[attr.key] = attr;
        attrsByProduct.set(attr.product_id, bucket);
      }

      const allSkus = (skuRes.data ?? []) as any[];
      const productIds = Array.from(new Set(
        allSkus
          .map((sku) => {
            const productRelation = sku.product;
            const product = Array.isArray(productRelation) ? productRelation[0] : productRelation;
            return product?.id ?? sku.product_id;
          })
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ));
      const primaryImageByProduct = new Map<string, string>();
      if (productIds.length > 0) {
        const { data: mediaRows, error: mediaErr } = await admin
          .from("product_media")
          .select("product_id, sort_order, is_primary, media_asset:media_asset_id(original_url)")
          .in("product_id", productIds)
          .order("product_id", { ascending: true })
          .order("is_primary", { ascending: false })
          .order("sort_order", { ascending: true });
        if (mediaErr) throw mediaErr;
        for (const mediaRow of (mediaRows ?? []) as Array<Record<string, unknown>>) {
          const mediaProductId = typeof mediaRow.product_id === "string" ? mediaRow.product_id : "";
          if (!mediaProductId || primaryImageByProduct.has(mediaProductId)) continue;
          const asset = mediaRow.media_asset as Record<string, unknown> | null;
          const url = typeof asset?.original_url === "string" ? asset.original_url.trim() : "";
          if (url) primaryImageByProduct.set(mediaProductId, url);
        }
      }

      const sourceSkus = allSkus.filter((sku) => webBySku.has(sku.id));
      const excludedNoWebPage = allSkus.length - sourceSkus.length;

      const rows = sourceSkus.map((sku) => {
        const productRelation = sku.product;
        const product = Array.isArray(productRelation) ? productRelation[0] : productRelation;
        const productId = product?.id ?? sku.product_id;
        const websitePrimaryImageUrl = primaryImageByProduct.get(productId) ?? null;
        const webListing = webBySku.get(sku.id);
        const gmcListing = gmcBySku.get(sku.id);
        const latestCommand = gmcListing?.id ? commandsByListing.get(gmcListing.id) : null;
        const price = Number(webListing?.listed_price ?? gmcListing?.listed_price ?? 0);
        const stock = stockBySku.get(sku.id) ?? 0;
        const barcode = product?.ean || product?.upc || product?.isbn || null;
        const blocking: string[] = [];
        const warnings: string[] = [];

        if (!connected) blocking.push("Google Merchant is not connected");
        if (!dataSourceConfigured) blocking.push("GMC data source is not configured");
        if (tokenExpired === true) blocking.push("Google Merchant token is expired");
        if (price <= 0) blocking.push("Missing listed price");
        if (!product?.mpn) blocking.push("Missing MPN");
        if (!product?.name && !product?.seo_title) blocking.push("Missing title");
        if (!product?.seo_description && !product?.description) blocking.push("Missing description");
        if (!websitePrimaryImageUrl) blocking.push("Missing website primary image");
        if (!product?.gmc_product_category) warnings.push("Missing Google product category");
        if (!barcode) warnings.push("Missing GTIN: publish will use LEGO + versioned MPN fallback");
        if (stock <= 0) warnings.push("No available stock: publish will mark out of stock");
        const commandError = latestCommand?.last_error ? String(latestCommand.last_error) : null;
        if (commandError) warnings.push(commandError);

        return {
          sku_id: sku.id,
          sku_code: sku.sku_code,
          condition_grade: sku.condition_grade,
          product_id: productId,
          mpn: product?.mpn ?? null,
          product_name: product?.name ?? null,
          title: product?.seo_title ?? product?.name ?? null,
          description: product?.seo_description ?? product?.description ?? null,
          image_url: websitePrimaryImageUrl,
          ean: product?.ean ?? null,
          upc: product?.upc ?? null,
          isbn: product?.isbn ?? null,
          gmc_product_category: product?.gmc_product_category ?? null,
          price,
          stock_count: stock,
          status: blocking.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
          blocking,
          warnings,
          barcode_source_candidates: attrsByProduct.get(product?.id ?? sku.product_id) ?? {},
          web_listing_id: webListing?.id ?? null,
          gmc_listing_id: gmcListing?.id ?? null,
          gmc_offer_status: gmcListing?.offer_status ?? null,
          gmc_v2_status: gmcListing?.v2_status ?? null,
          gmc_external_listing_id: gmcListing?.external_listing_id ?? null,
          checkout_link_template: buildGmcCheckoutLink(Deno.env.get("SITE_URL"), sku.sku_code),
          latest_command: latestCommand ? {
            id: latestCommand.id,
            status: latestCommand.status,
            command_type: latestCommand.command_type,
            retry_count: latestCommand.retry_count,
            last_error: latestCommand.last_error,
            next_attempt_at: latestCommand.next_attempt_at,
            created_at: latestCommand.created_at,
          } : null,
        };
      });

      const ready = rows.filter((row) => row.status === "ready").length;
      const warning = rows.filter((row) => row.status === "warning").length;
      const blocked = rows.filter((row) => row.status === "blocked").length;

      result = {
        connection: {
          connected,
          merchant_id: conn?.merchant_id ?? null,
          data_source: conn?.data_source ?? null,
          token_expires_at: conn?.token_expires_at ?? null,
          token_expired: tokenExpired,
          last_updated: conn?.updated_at ?? null,
        },
        summary: { total: rows.length, ready, warning, blocked, excluded_no_web_page: excludedNoWebPage },
        rows,
      };
    } else if (action === "gmc-publish-events") {
      const limit = Math.min(Number(params.limit) || 100, 250);
      const { data, error } = await admin
        .from("v_outbound_command_with_references" as never)
        .select("*")
        .eq("entity_type" as never, "channel_listing")
        .in("target_system" as never, ["google_shopping", "gmc"] as never)
        .order("created_at" as never, { ascending: false })
        .limit(limit);
      if (error) throw error;
      result = (data ?? []).map((row: any) => ({
        id: row.id,
        target_system: row.target_system,
        command_type: row.command_type,
        status: row.status,
        retry_count: row.retry_count,
        last_error: row.last_error,
        next_attempt_at: row.next_attempt_at,
        sent_at: row.sent_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        entity_id: row.entity_id,
        sku_code: row.sku_code,
        app_reference: row.app_reference,
        external_listing_id: row.external_listing_id,
        channel: row.channel,
        response_payload: row.response_payload,
      }));
    } else if (action === "gmc-save-enrichment") {
      const productId = params.product_id;
      if (!productId) throw new ValidationError("product_id is required");
      const patch: Record<string, unknown> = {};
      for (const key of ["ean", "upc", "isbn", "gmc_product_category"]) {
        if (Object.prototype.hasOwnProperty.call(params, key)) {
          const value = params[key];
          patch[key] = typeof value === "string" && value.trim() ? value.trim() : null;
        }
      }
      if (Object.keys(patch).length === 0) throw new ValidationError("No enrichment fields supplied");
      const { error } = await admin.from("product").update(patch).eq("id", productId);
      if (error) throw error;

      for (const key of ["ean", "upc", "isbn"]) {
        if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
        const value = patch[key];
        await admin
          .from("product_attribute")
          .delete()
          .eq("product_id", productId)
          .eq("namespace", "core")
          .eq("key", key)
          .is("channel", null)
          .is("marketplace", null)
          .is("category_id", null);
        if (value) {
          const { error: attrError } = await admin.from("product_attribute").insert({
            product_id: productId,
            namespace: "core",
            key,
            aspect_key: key,
            value: String(value),
            source: "manual",
            chosen_source: "custom",
            custom_value: String(value),
          });
          if (attrError) throw attrError;
        }
      }

      result = { success: true, updated: patch };
    } else if (action === "list-transcripts") {
      const role = (params as { role?: string }).role;
      const search = (params as { search?: string }).search?.trim();
      const from = Number((params as { from?: number }).from ?? 0);
      const to = Number((params as { to?: number }).to ?? 49);
      let q = admin
        .from("lovable_agent_transcripts")
        .select("*", { count: "exact" })
        .order("occurred_at", { ascending: false, nullsFirst: false })
        .order("message_index", { ascending: false })
        .range(from, to);
      if (role && role !== "all") q = q.eq("role", role);
      if (search) {
        const term = search.replace(/%/g, "");
        q = q.or(`body.ilike.%${term}%,title.ilike.%${term}%`);
      }
      const { data, error, count } = await q;
      if (error) throw error;
      result = { rows: data ?? [], total: count ?? 0 };
    } else {
      return new Response(
        JSON.stringify({ error: `Unknown action: ${action}` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const status = err instanceof ValidationError ? 400 : 500;
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
