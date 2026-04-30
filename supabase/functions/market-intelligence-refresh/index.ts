import {
  corsHeaders,
  authenticateRequest,
  createAdminClient,
  fetchWithTimeout,
  jsonResponse,
  errorResponse,
} from "../_shared/qbo-helpers.ts";
import { blGet, getBlCreds, BlHttpError } from "../_shared/bricklink-client.ts";

const BO_BASE = "https://api.brickowl.com/v1";
type SupabaseAdminClient = ReturnType<typeof createAdminClient>;

const SOURCE_CODES = [
  "ebay_sold",
  "bricklink_price_guide",
  "brickowl_availability",
  "brickeconomy",
] as const;

type SourceCode = typeof SOURCE_CODES[number];

interface RefreshRequest {
  sku_id?: string;
  skuId?: string;
  sku_code?: string;
  skuCode?: string;
  mpn?: string;
  sources?: SourceCode[];
  limit?: number;
  refresh_snapshots?: boolean;
}

interface TargetSku {
  id: string;
  sku_code: string;
  mpn: string | null;
  condition_grade: number | string | null;
  product_id: string | null;
  product?: {
    id?: string | null;
    mpn?: string | null;
    name?: string | null;
    bricklink_item_no?: string | null;
    brickowl_boid?: string | null;
    brickeconomy_id?: string | null;
  } | null;
}

interface SourceResult {
  source: SourceCode;
  requested: number;
  inserted: number;
  skipped: number;
  errors: Array<{ sku: string; error: string }>;
  details?: Record<string, unknown>;
}

interface SignalRow {
  source_id: string;
  sku_id: string;
  mpn: string | null;
  condition_grade: number | string | null;
  channel: string;
  signal_type: "sold_price" | "asking_price" | "availability" | "valuation";
  observed_price: number;
  observed_price_min: number | null;
  observed_price_max: number | null;
  sample_size: number;
  vat_treatment: "inclusive" | "exclusive" | "not_applicable" | "unknown";
  source_confidence: number;
  freshness_score: number;
  observed_at: string;
  metadata: Record<string, unknown>;
}

function clamp(value: number, min = 0.05, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "string" ? Number.parseFloat(value.replace(/[£,]/g, "")) : Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function freshnessFromDate(value: string | null | undefined, staleAfterDays = 365): number {
  if (!value) return 0.35;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return 0.35;
  const ageDays = Math.max(0, (Date.now() - t) / 86_400_000);
  return clamp(1 - ageDays / staleAfterDays, 0.1, 1);
}

function baseMpn(mpn: string | null | undefined): string | null {
  if (!mpn) return null;
  return mpn.replace(/-\d+$/, "");
}

function productOf(target: TargetSku): TargetSku["product"] {
  const product = target.product as unknown;
  return Array.isArray(product) ? (product[0] ?? null) : (product as TargetSku["product"]);
}

function skuMpn(target: TargetSku): string | null {
  return target.mpn ?? productOf(target)?.mpn ?? target.sku_code.split(".")[0] ?? null;
}

function isNewCondition(conditionGrade: TargetSku["condition_grade"]): boolean {
  const grade = Number(conditionGrade);
  return Number.isFinite(grade) && grade <= 2;
}

async function requireStaff(req: Request, admin: SupabaseAdminClient): Promise<string> {
  const auth = await authenticateRequest(req, admin);
  if (auth.userId === "service-role") return auth.userId;

  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", auth.userId);
  if (error) throw error;
  const ok = (data ?? []).some((row: { role: string }) => row.role === "admin" || row.role === "staff");
  if (!ok) throw new Error("Forbidden");
  return auth.userId;
}

async function ensureSources(admin: SupabaseAdminClient): Promise<Record<SourceCode, string>> {
  const rows = [
    { source_code: "ebay_sold", name: "eBay Sold Orders", source_type: "market_data" },
    { source_code: "bricklink_price_guide", name: "BrickLink Price Guide", source_type: "market_data" },
    { source_code: "brickowl_availability", name: "BrickOwl Availability", source_type: "market_data" },
    {
      source_code: "brickeconomy",
      name: "BrickEconomy Valuation",
      source_type: "valuation",
      rate_limit_per_day: 100,
      metadata: { respect_daily_limit: true },
    },
  ];
  const { error: upsertError } = await admin
    .from("market_signal_source")
    .upsert(rows, { onConflict: "source_code" });
  if (upsertError) throw upsertError;

  const { data, error } = await admin
    .from("market_signal_source")
    .select("id, source_code")
    .in("source_code", [...SOURCE_CODES]);
  if (error) throw error;

  const out = {} as Record<SourceCode, string>;
  for (const row of data ?? []) {
    out[row.source_code as SourceCode] = row.id as string;
  }
  for (const source of SOURCE_CODES) {
    if (!out[source]) throw new Error(`market_signal_source ${source} is missing`);
  }
  return out;
}

async function resolveTargets(admin: SupabaseAdminClient, body: RefreshRequest): Promise<TargetSku[]> {
  const skuId = body.sku_id ?? body.skuId;
  const skuCode = body.sku_code ?? body.skuCode;
  const limit = Math.max(1, Math.min(Number(body.limit ?? 50), 250));

  let query = admin
    .from("sku")
    .select("id, sku_code, mpn, condition_grade, product_id, product:product_id(id, mpn, name, bricklink_item_no, brickowl_boid, brickeconomy_id)")
    .eq("active_flag", true)
    .not("product_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (skuId) query = query.eq("id", skuId);
  if (skuCode) query = query.eq("sku_code", skuCode.trim());

  const { data, error } = await query;
  if (error) throw error;

  let targets = ((data ?? []) as TargetSku[]).filter((row) => skuMpn(row));
  if (body.mpn) {
    const wanted = body.mpn.trim();
    const wantedBase = baseMpn(wanted);
    targets = targets.filter((row) => {
      const rowMpn = skuMpn(row);
      return rowMpn === wanted || baseMpn(rowMpn) === wantedBase;
    });
  }
  return targets;
}

async function replaceGeneratedSignals(
  admin: SupabaseAdminClient,
  sourceId: string,
  targets: TargetSku[],
) {
  const skuIds = targets.map((target) => target.id);
  if (skuIds.length === 0) return;
  const { error } = await admin
    .from("market_signal")
    .delete()
    .eq("source_id", sourceId)
    .in("sku_id", skuIds)
    .eq("metadata->>generated_by", "market-intelligence-refresh");
  if (error) throw error;
}

async function insertSignals(admin: SupabaseAdminClient, rows: SignalRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error, count } = await admin
      .from("market_signal")
      .insert(batch, { count: "exact" });
    if (error) throw error;
    inserted += count ?? batch.length;
  }
  return inserted;
}

async function refreshEbaySold(
  admin: SupabaseAdminClient,
  sourceId: string,
  targets: TargetSku[],
): Promise<SourceResult> {
  const result: SourceResult = { source: "ebay_sold", requested: targets.length, inserted: 0, skipped: 0, errors: [] };
  await replaceGeneratedSignals(admin, sourceId, targets);

  const skuIds = targets.map((target) => target.id);
  if (skuIds.length === 0) return result;

  const { data, error } = await admin
    .from("sales_order_line")
    .select("id, sku_id, quantity, line_total, unit_price, created_at, sales_order:sales_order_id(id, order_number, origin_channel, origin_reference, status, currency, created_at)")
    .in("sku_id", skuIds)
    .gt("line_total", 0);
  if (error) throw error;

  const bySku = new Map(targets.map((target) => [target.id, target]));
  const rows: SignalRow[] = [];
  for (const line of data ?? []) {
    const order = Array.isArray(line.sales_order) ? line.sales_order[0] : line.sales_order;
    if (!order || order.origin_channel !== "ebay") continue;
    if (["cancelled", "refunded"].includes(String(order.status ?? ""))) continue;

    const target = bySku.get(line.sku_id as string);
    if (!target) continue;
    const quantity = Math.max(1, Number(line.quantity ?? 1));
    const total = toNumber(line.line_total) ?? toNumber(line.unit_price);
    if (!total || total <= 0) continue;
    const observedAt = (order.created_at ?? line.created_at ?? new Date().toISOString()) as string;
    rows.push({
      source_id: sourceId,
      sku_id: target.id,
      mpn: skuMpn(target),
      condition_grade: target.condition_grade,
      channel: "ebay",
      signal_type: "sold_price",
      observed_price: roundMoney(total / quantity),
      observed_price_min: roundMoney(total / quantity),
      observed_price_max: roundMoney(total / quantity),
      sample_size: quantity,
      vat_treatment: "inclusive",
      source_confidence: 0.86,
      freshness_score: freshnessFromDate(observedAt),
      observed_at: observedAt,
      metadata: {
        generated_by: "market-intelligence-refresh",
        sales_order_id: order.id,
        sales_order_line_id: line.id,
        order_number: order.order_number,
        origin_reference: order.origin_reference,
        currency: order.currency ?? "GBP",
      },
    });
  }

  result.inserted = await insertSignals(admin, rows);
  result.skipped = Math.max(0, targets.length - new Set(rows.map((row) => row.sku_id)).size);
  return result;
}

type BlPriceGuide = {
  avg_price?: string | number;
  min_price?: string | number;
  max_price?: string | number;
  qty_avg_price?: string | number;
  total_quantity?: number;
  price_detail?: unknown[];
};

async function refreshBrickLink(
  admin: SupabaseAdminClient,
  sourceId: string,
  targets: TargetSku[],
): Promise<SourceResult> {
  const result: SourceResult = { source: "bricklink_price_guide", requested: targets.length, inserted: 0, skipped: 0, errors: [] };
  const creds = getBlCreds();
  if (!creds) {
    result.skipped = targets.length;
    result.details = { configured: false };
    return result;
  }

  await replaceGeneratedSignals(admin, sourceId, targets);
  const rows: SignalRow[] = [];
  for (const target of targets) {
    const product = productOf(target);
    const itemNo = product?.bricklink_item_no ?? skuMpn(target);
    if (!itemNo) {
      result.skipped++;
      continue;
    }

    try {
      const data = await blGet<BlPriceGuide>(
        `/items/SET/${encodeURIComponent(itemNo)}/price`,
        {
          guide_type: "sold",
          new_or_used: isNewCondition(target.condition_grade) ? "N" : "U",
          country_code: "UK",
          currency_code: "GBP",
        },
        creds,
      );
      const avg = toNumber(data.avg_price) ?? toNumber(data.qty_avg_price);
      if (!avg || avg <= 0) {
        result.skipped++;
        continue;
      }
      const sampleSize = Number(data.total_quantity ?? data.price_detail?.length ?? 1);
      rows.push({
        source_id: sourceId,
        sku_id: target.id,
        mpn: skuMpn(target),
        condition_grade: target.condition_grade,
        channel: "bricklink",
        signal_type: "sold_price",
        observed_price: roundMoney(avg),
        observed_price_min: toNumber(data.min_price) ?? roundMoney(avg),
        observed_price_max: toNumber(data.max_price) ?? roundMoney(avg),
        sample_size: Math.max(1, Number.isFinite(sampleSize) ? sampleSize : 1),
        vat_treatment: "unknown",
        source_confidence: 0.78,
        freshness_score: 0.95,
        observed_at: new Date().toISOString(),
        metadata: {
          generated_by: "market-intelligence-refresh",
          external_signal_key: `bricklink:${itemNo}:${isNewCondition(target.condition_grade) ? "N" : "U"}`,
          item_no: itemNo,
          guide_type: "sold",
          new_or_used: isNewCondition(target.condition_grade) ? "N" : "U",
          sample_quality: sampleSize > 5 ? "usable" : "thin",
        },
      });
    } catch (err) {
      if (err instanceof BlHttpError && err.status === 404) {
        result.skipped++;
      } else {
        result.errors.push({ sku: target.sku_code, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  result.inserted = await insertSignals(admin, rows);
  return result;
}

function extractBrickOwlOffers(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (!payload || typeof payload !== "object") return [];
  const body = payload as Record<string, unknown>;
  for (const key of ["data", "results", "lots", "items", "availability"]) {
    if (Array.isArray(body[key])) return body[key] as Array<Record<string, unknown>>;
  }
  return [];
}

async function resolveBrickOwlBoid(admin: SupabaseAdminClient, target: TargetSku): Promise<string | null> {
  const product = productOf(target);
  if (product?.brickowl_boid) return product.brickowl_boid;
  const mpn = skuMpn(target);
  if (!mpn) return null;
  const { data } = await admin
    .from("brickowl_mpn_alias")
    .select("boid")
    .eq("mpn", mpn)
    .maybeSingle();
  return (data?.boid as string | undefined) ?? null;
}

async function refreshBrickOwl(
  admin: SupabaseAdminClient,
  sourceId: string,
  targets: TargetSku[],
): Promise<SourceResult> {
  const result: SourceResult = { source: "brickowl_availability", requested: targets.length, inserted: 0, skipped: 0, errors: [] };
  const key = Deno.env.get("BRICKOWL_API_KEY") ?? "";
  if (!key) {
    result.skipped = targets.length;
    result.details = { configured: false };
    return result;
  }

  await replaceGeneratedSignals(admin, sourceId, targets);
  const rows: SignalRow[] = [];
  for (const target of targets) {
    try {
      const boid = await resolveBrickOwlBoid(admin, target);
      if (!boid) {
        result.skipped++;
        continue;
      }
      const url = `${BO_BASE}/catalog/availability?key=${encodeURIComponent(key)}&boid=${encodeURIComponent(boid)}&quantity=1&country=GB`;
      const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        result.errors.push({ sku: target.sku_code, error: `BrickOwl ${res.status}: ${await res.text()}` });
        continue;
      }
      const body = await res.json().catch(() => null);
      const offers = extractBrickOwlOffers(body);
      const prices = offers
        .map((offer) => toNumber(offer.price ?? offer.unit_price ?? offer.sale_price ?? offer.amount))
        .filter((price): price is number => price != null && price > 0);
      if (prices.length === 0) {
        result.skipped++;
        continue;
      }
      const avg = prices.reduce((sum, price) => sum + price, 0) / prices.length;
      rows.push({
        source_id: sourceId,
        sku_id: target.id,
        mpn: skuMpn(target),
        condition_grade: target.condition_grade,
        channel: "brickowl",
        signal_type: "asking_price",
        observed_price: roundMoney(avg),
        observed_price_min: roundMoney(Math.min(...prices)),
        observed_price_max: roundMoney(Math.max(...prices)),
        sample_size: prices.length,
        vat_treatment: "unknown",
        source_confidence: 0.56,
        freshness_score: 0.95,
        observed_at: new Date().toISOString(),
        metadata: {
          generated_by: "market-intelligence-refresh",
          external_signal_key: `brickowl:${boid}`,
          boid,
          sample_quality: prices.length > 5 ? "usable" : "thin",
          signal_note: "Availability asks are treated as weaker pricing signals than sold prices.",
        },
      });
    } catch (err) {
      result.errors.push({ sku: target.sku_code, error: err instanceof Error ? err.message : String(err) });
    }
  }

  result.inserted = await insertSignals(admin, rows);
  return result;
}

async function refreshBrickEconomy(
  admin: SupabaseAdminClient,
  sourceId: string,
  targets: TargetSku[],
): Promise<SourceResult> {
  const result: SourceResult = { source: "brickeconomy", requested: targets.length, inserted: 0, skipped: 0, errors: [] };
  await replaceGeneratedSignals(admin, sourceId, targets);

  const rows: SignalRow[] = [];
  for (const target of targets) {
    const product = productOf(target);
    const mpn = skuMpn(target);
    const candidates = [
      product?.brickeconomy_id,
      mpn,
      baseMpn(mpn),
    ].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);

    if (candidates.length === 0) {
      result.skipped++;
      continue;
    }

    const { data, error } = await admin
      .from("brickeconomy_collection")
      .select("id, item_type, item_number, name, condition, current_value, retail_price, growth, currency, synced_at")
      .in("item_number", candidates)
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      result.errors.push({ sku: target.sku_code, error: error.message });
      continue;
    }
    const value = toNumber(data?.current_value);
    if (!value || value <= 0) {
      result.skipped++;
      continue;
    }

    rows.push({
      source_id: sourceId,
      sku_id: target.id,
      mpn,
      condition_grade: target.condition_grade,
      channel: "all",
      signal_type: "valuation",
      observed_price: roundMoney(value),
      observed_price_min: roundMoney(value),
      observed_price_max: roundMoney(value),
      sample_size: 1,
      vat_treatment: "unknown",
      source_confidence: 0.66,
      freshness_score: freshnessFromDate(data.synced_at as string | null, 180),
      observed_at: (data.synced_at as string | null) ?? new Date().toISOString(),
      metadata: {
        generated_by: "market-intelligence-refresh",
        external_signal_key: `brickeconomy:${data.item_number}`,
        collection_id: data.id,
        item_number: data.item_number,
        condition: data.condition,
        growth: data.growth,
        retail_price: data.retail_price,
        currency: data.currency ?? "GBP",
        source_note: "Uses cached BrickEconomy collection data; does not bypass API quota.",
      },
    });
  }

  result.inserted = await insertSignals(admin, rows);
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    const actorId = await requireStaff(req, admin);
    const body = await req.json().catch(() => ({})) as RefreshRequest;
    const requestedSources = (Array.isArray(body.sources) && body.sources.length > 0 ? body.sources : [...SOURCE_CODES])
      .filter((source): source is SourceCode => SOURCE_CODES.includes(source as SourceCode));
    const sources = requestedSources.length > 0 ? requestedSources : [...SOURCE_CODES];

    const targets = await resolveTargets(admin, body);
    const sourceIds = await ensureSources(admin);
    const results: SourceResult[] = [];

    for (const source of sources) {
      if (source === "ebay_sold") results.push(await refreshEbaySold(admin, sourceIds[source], targets));
      if (source === "bricklink_price_guide") results.push(await refreshBrickLink(admin, sourceIds[source], targets));
      if (source === "brickowl_availability") results.push(await refreshBrickOwl(admin, sourceIds[source], targets));
      if (source === "brickeconomy") results.push(await refreshBrickEconomy(admin, sourceIds[source], targets));
    }

    let snapshotRows = 0;
    if (body.refresh_snapshots !== false) {
      if ((body.sku_id ?? body.skuId ?? body.sku_code ?? body.skuCode) && targets.length === 1) {
        const { data, error } = await admin.rpc("refresh_market_price_snapshots", { p_sku_id: targets[0].id });
        if (error) throw error;
        snapshotRows = Number(data ?? 0);
      } else {
        const { data, error } = await admin.rpc("refresh_market_price_snapshots");
        if (error) throw error;
        snapshotRows = Number(data ?? 0);
      }
    }

    const correlationId = crypto.randomUUID();
    await admin.from("audit_event").insert({
      id: crypto.randomUUID(),
      actor_id: actorId === "service-role" ? null : actorId,
      actor_type: actorId === "service-role" ? "system" : "user",
      entity_type: "market_intelligence",
      entity_id: correlationId,
      trigger_type: "market_intelligence_refresh",
      source_system: "market-intelligence-refresh",
      correlation_id: correlationId,
      after_json: {
        target_count: targets.length,
        sources,
        results,
        snapshot_rows: snapshotRows,
      },
    }).select("id").maybeSingle();

    return jsonResponse({
      success: true,
      target_count: targets.length,
      sources,
      results,
      snapshot_rows: snapshotRows,
    });
  } catch (err) {
    const status = err instanceof Error && err.message === "Forbidden" ? 403 : 400;
    return errorResponse(err, status);
  }
});
