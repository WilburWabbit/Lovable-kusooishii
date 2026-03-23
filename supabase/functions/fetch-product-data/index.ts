// Redeployed: 2026-03-23
// ============================================================
// Fetch Product Data
// On MPN add, fetches product specs and market prices from
// Rebrickable, BrickEconomy, and BrickLink APIs.
// Upserts into the product table and caches market prices.
// ============================================================

import {
  corsHeaders,
  createAdminClient,
  authenticateRequest,
  fetchWithTimeout,
  jsonResponse,
  errorResponse,
} from "../_shared/qbo-helpers.ts";

const REBRICKABLE_API = "https://rebrickable.com/api/v3/lego";
const BRICKLINK_API = "https://api.bricklink.com/api/store/v1";
const BE_BASE = "https://www.brickeconomy.com/api/v1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);

    const { mpn } = await req.json();
    if (!mpn || typeof mpn !== "string") throw new Error("mpn is required (e.g. '75367-1')");

    // Parse MPN: "75367-1" → set_number "75367", variant "1"
    const parts = mpn.split("-");
    const setNumber = parts[0];
    const variant = parts[1] ?? "1";

    // ─── Fetch from all sources in parallel ────────────────
    const [rebrickableResult, brickEconomyResult, brickLinkResult] = await Promise.allSettled([
      fetchRebrickable(setNumber, variant),
      fetchBrickEconomy(setNumber, admin),
      fetchBrickLink(setNumber, variant),
    ]);

    const rebrickable = rebrickableResult.status === "fulfilled" ? rebrickableResult.value : null;
    const brickEconomy = brickEconomyResult.status === "fulfilled" ? brickEconomyResult.value : null;
    const brickLink = brickLinkResult.status === "fulfilled" ? brickLinkResult.value : null;

    if (rebrickableResult.status === "rejected") {
      console.warn("Rebrickable fetch failed:", rebrickableResult.reason);
    }
    if (brickEconomyResult.status === "rejected") {
      console.warn("BrickEconomy fetch failed:", brickEconomyResult.reason);
    }
    if (brickLinkResult.status === "rejected") {
      console.warn("BrickLink fetch failed:", brickLinkResult.reason);
    }

    // ─── Upsert product ────────────────────────────────────
    const productData: Record<string, unknown> = {
      mpn,
      set_number: setNumber,
    };

    if (rebrickable) {
      if (rebrickable.name) productData.name = rebrickable.name;
      if (rebrickable.theme) productData.theme = rebrickable.theme;
      if (rebrickable.subtheme) productData.subtheme = rebrickable.subtheme;
      if (rebrickable.num_parts) productData.piece_count = rebrickable.num_parts;
      if (rebrickable.year) productData.release_date = `${rebrickable.year}-01-01`;
    }

    if (brickEconomy) {
      if (brickEconomy.retail_price != null) productData.rrp = brickEconomy.retail_price;
      if (brickEconomy.retired_date) productData.retired_date = brickEconomy.retired_date;
    }

    // Check if product already exists
    const { data: existingProduct } = await admin
      .from("product")
      .select("id")
      .eq("mpn", mpn)
      .maybeSingle();

    let productId: string;
    if (existingProduct) {
      productId = existingProduct.id;
      await admin
        .from("product")
        .update(productData as never)
        .eq("id", productId);
    } else {
      const { data: newProduct, error: insertErr } = await admin
        .from("product")
        .insert(productData as never)
        .select("id")
        .single();

      if (insertErr) throw new Error(`Failed to create product: ${insertErr.message}`);
      productId = (newProduct as { id: string }).id;
    }

    // ─── Cache market prices ───────────────────────────────
    // Determine the base market price (G1 equivalent)
    const GRADE_RATIOS: Record<number, number> = { 1: 1.0, 2: 0.8, 3: 0.6, 4: 0.4 };
    let baseMarketPrice: number | null = null;

    // Prefer BrickEconomy current_value, fall back to BrickLink avg
    if (brickEconomy?.current_value) {
      baseMarketPrice = brickEconomy.current_value;
    } else if (brickLink?.avgPrice) {
      baseMarketPrice = brickLink.avgPrice;
    }

    const marketPrices: Record<number, number | null> = {};
    for (let grade = 1; grade <= 4; grade++) {
      marketPrices[grade] = baseMarketPrice
        ? Math.round(baseMarketPrice * GRADE_RATIOS[grade] * 100) / 100
        : null;
    }

    // Store market prices in brickeconomy_collection for later use during grading
    if (brickEconomy) {
      await admin
        .from("brickeconomy_collection")
        .upsert({
          item_type: "set",
          item_number: setNumber,
          name: rebrickable?.name ?? null,
          theme: rebrickable?.theme ?? null,
          current_value: brickEconomy.current_value,
          retail_price: brickEconomy.retail_price,
          synced_at: new Date().toISOString(),
          currency: "GBP",
        } as never, { onConflict: "item_number" as never });
    }

    return jsonResponse({
      success: true,
      mpn,
      productId,
      sources: {
        rebrickable: rebrickable ? "ok" : "failed",
        brickEconomy: brickEconomy ? "ok" : "failed",
        brickLink: brickLink ? "ok" : "failed",
      },
      product: {
        name: productData.name ?? null,
        theme: productData.theme ?? null,
        pieceCount: productData.piece_count ?? null,
      },
      marketPrices,
    });
  } catch (err) {
    return errorResponse(err);
  }
});

// ─── Rebrickable API ─────────────────────────────────────────

interface RebrickableSet {
  name: string | null;
  theme: string | null;
  subtheme: string | null;
  num_parts: number | null;
  year: number | null;
  set_img_url: string | null;
}

async function fetchRebrickable(setNumber: string, variant: string): Promise<RebrickableSet> {
  const apiKey = Deno.env.get("REBRICKABLE_API_KEY");
  if (!apiKey) throw new Error("REBRICKABLE_API_KEY not configured");

  const setId = `${setNumber}-${variant}`;
  const res = await fetchWithTimeout(`${REBRICKABLE_API}/sets/${setId}/`, {
    headers: { Authorization: `key ${apiKey}`, Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Rebrickable API [${res.status}]: ${text}`);
  }

  const data = await res.json();

  // Fetch theme name from theme_id
  let themeName: string | null = null;
  if (data.theme_id) {
    try {
      const themeRes = await fetchWithTimeout(`${REBRICKABLE_API}/themes/${data.theme_id}/`, {
        headers: { Authorization: `key ${apiKey}`, Accept: "application/json" },
      });
      if (themeRes.ok) {
        const themeData = await themeRes.json();
        themeName = themeData.name ?? null;
      }
    } catch {
      // Non-critical — theme name is a nice-to-have
    }
  }

  return {
    name: data.name ?? null,
    theme: themeName,
    subtheme: null, // Rebrickable doesn't have subtheme in set response
    num_parts: data.num_parts ?? null,
    year: data.year ?? null,
    set_img_url: data.set_img_url ?? null,
  };
}

// ─── BrickEconomy API ────────────────────────────────────────

interface BrickEconomyData {
  current_value: number | null;
  retail_price: number | null;
  retired_date: string | null;
}

async function fetchBrickEconomy(setNumber: string, admin: ReturnType<typeof createAdminClient>): Promise<BrickEconomyData> {
  const apiKey = Deno.env.get("BRICKECONOMY_API_KEY");
  if (!apiKey) throw new Error("BRICKECONOMY_API_KEY not configured");

  // Check daily quota (100 req/day hard limit)
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count: syncsToday } = await admin
    .from("audit_event")
    .select("id", { count: "exact", head: true })
    .eq("entity_type", "brickeconomy_sync")
    .gte("created_at", todayStart.toISOString());

  if ((syncsToday ?? 0) >= 98) {
    console.warn("BrickEconomy daily quota near limit — skipping API call");
    // Try to serve from cache instead
    return fetchBrickEconomyFromCache(setNumber, admin);
  }

  const res = await fetchWithTimeout(`${BE_BASE}/set/${setNumber}?currency=GBP`, {
    headers: {
      "x-apikey": apiKey,
      "User-Agent": "BrickKeeperSync/1.0",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    // If rate limited or not found, try cache
    if (res.status === 429 || res.status === 404) {
      console.warn(`BrickEconomy API [${res.status}] for set ${setNumber} — falling back to cache`);
      return fetchBrickEconomyFromCache(setNumber, admin);
    }
    throw new Error(`BrickEconomy API [${res.status}]: ${text}`);
  }

  // Record API call for quota tracking
  await admin.from("audit_event").insert({
    entity_type: "brickeconomy_sync",
    entity_id: setNumber,
    trigger_type: "brickeconomy_sync",
    actor_type: "system",
    source_system: "fetch-product-data",
    correlation_id: crypto.randomUUID(),
    after_json: { set_number: setNumber, api_calls: 1 },
  });

  const data = await res.json();
  const setData = data.data ?? data;

  return {
    current_value: setData.current_value ?? setData.currentValue ?? null,
    retail_price: setData.retail_price ?? setData.retailPrice ?? null,
    retired_date: setData.retired_date ?? setData.retiredDate ?? null,
  };
}

async function fetchBrickEconomyFromCache(
  setNumber: string,
  admin: ReturnType<typeof createAdminClient>,
): Promise<BrickEconomyData> {
  const { data } = await admin
    .from("brickeconomy_collection")
    .select("current_value, retail_price, retired_date")
    .eq("item_number", setNumber)
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    return { current_value: null, retail_price: null, retired_date: null };
  }

  const row = data as Record<string, unknown>;
  return {
    current_value: (row.current_value as number) ?? null,
    retail_price: (row.retail_price as number) ?? null,
    retired_date: (row.retired_date as string) ?? null,
  };
}

// ─── BrickLink API ───────────────────────────────────────────

interface BrickLinkData {
  avgPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  totalQty: number | null;
}

async function fetchBrickLink(setNumber: string, variant: string): Promise<BrickLinkData> {
  const consumerKey = Deno.env.get("BRICKLINK_CONSUMER_KEY");
  const consumerSecret = Deno.env.get("BRICKLINK_CONSUMER_SECRET");
  const tokenValue = Deno.env.get("BRICKLINK_TOKEN_VALUE");
  const tokenSecret = Deno.env.get("BRICKLINK_TOKEN_SECRET");

  if (!consumerKey || !consumerSecret || !tokenValue || !tokenSecret) {
    throw new Error("BrickLink API credentials not configured");
  }

  // BrickLink uses OAuth 1.0a — build the auth header
  const itemNo = `${setNumber}-${variant}`;
  const url = `${BRICKLINK_API}/items/SET/${itemNo}/price?guide_type=sold&new_or_used=N&country_code=UK&currency_code=GBP`;

  const oauthHeader = buildOAuth1Header(
    "GET",
    url,
    consumerKey,
    consumerSecret,
    tokenValue,
    tokenSecret,
  );

  const res = await fetchWithTimeout(url, {
    headers: {
      Authorization: oauthHeader,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BrickLink API [${res.status}]: ${text}`);
  }

  const body = await res.json();
  const data = body.data ?? body;

  return {
    avgPrice: data.avg_price ? parseFloat(data.avg_price) : null,
    minPrice: data.min_price ? parseFloat(data.min_price) : null,
    maxPrice: data.max_price ? parseFloat(data.max_price) : null,
    totalQty: data.total_quantity ?? null,
  };
}

// ─── OAuth 1.0a Helper for BrickLink ─────────────────────────

function buildOAuth1Header(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  tokenValue: string,
  tokenSecret: string,
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");

  // Parse URL for base string
  const urlObj = new URL(url);
  const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;

  // Collect all params (query + oauth)
  const params: [string, string][] = [];
  urlObj.searchParams.forEach((v, k) => params.push([k, v]));
  params.push(["oauth_consumer_key", consumerKey]);
  params.push(["oauth_nonce", nonce]);
  params.push(["oauth_signature_method", "HMAC-SHA1"]);
  params.push(["oauth_timestamp", timestamp]);
  params.push(["oauth_token", tokenValue]);
  params.push(["oauth_version", "1.0"]);

  // Sort and encode
  params.sort((a, b) => a[0].localeCompare(b[0]));
  const paramString = params
    .map(([k, v]) => `${encodeRFC3986(k)}=${encodeRFC3986(v)}`)
    .join("&");

  const baseString = `${method.toUpperCase()}&${encodeRFC3986(baseUrl)}&${encodeRFC3986(paramString)}`;
  const signingKey = `${encodeRFC3986(consumerSecret)}&${encodeRFC3986(tokenSecret)}`;

  // HMAC-SHA1 signature
  const signature = hmacSha1(signingKey, baseString);

  return `OAuth oauth_consumer_key="${encodeRFC3986(consumerKey)}", oauth_nonce="${nonce}", oauth_signature="${encodeRFC3986(signature)}", oauth_signature_method="HMAC-SHA1", oauth_timestamp="${timestamp}", oauth_token="${encodeRFC3986(tokenValue)}", oauth_version="1.0"`;
}

function encodeRFC3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmacSha1(key: string, data: string): string {
  // Use Web Crypto API for HMAC-SHA1
  // Deno supports crypto.subtle — but we need sync base64.
  // For Deno runtime, use the built-in crypto:
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const msgData = encoder.encode(data);

  // Simple HMAC-SHA1 using Deno's std library approach
  // We'll use a synchronous fallback with manual HMAC calculation
  const BLOCK_SIZE = 64;
  let keyBytes = keyData;
  if (keyBytes.length > BLOCK_SIZE) {
    // SHA-1 hash the key if it's too long (unlikely for OAuth)
    keyBytes = sha1Bytes(keyBytes);
  }

  const iPad = new Uint8Array(BLOCK_SIZE);
  const oPad = new Uint8Array(BLOCK_SIZE);
  for (let i = 0; i < BLOCK_SIZE; i++) {
    iPad[i] = (keyBytes[i] ?? 0) ^ 0x36;
    oPad[i] = (keyBytes[i] ?? 0) ^ 0x5c;
  }

  const innerData = new Uint8Array(BLOCK_SIZE + msgData.length);
  innerData.set(iPad);
  innerData.set(msgData, BLOCK_SIZE);
  const innerHash = sha1Bytes(innerData);

  const outerData = new Uint8Array(BLOCK_SIZE + 20);
  outerData.set(oPad);
  outerData.set(innerHash, BLOCK_SIZE);
  const hmac = sha1Bytes(outerData);

  return btoa(String.fromCharCode(...hmac));
}

// Minimal SHA-1 for HMAC (synchronous)
function sha1Bytes(data: Uint8Array): Uint8Array {
  let h0 = 0x67452301;
  let h1 = 0xEFCDAB89;
  let h2 = 0x98BADCFE;
  let h3 = 0x10325476;
  let h4 = 0xC3D2E1F0;

  const ml = data.length * 8;
  // Pre-processing: pad to 512-bit blocks
  const paddedLen = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  // Append length in bits as big-endian 64-bit
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, ml >>> 0, false);
  view.setUint32(paddedLen - 8, Math.floor(ml / 0x100000000), false);

  const w = new Int32Array(80);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getInt32(offset + i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }

      const temp = (rotl(a, 5) + f + e + k + w[i]) | 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const result = new Uint8Array(20);
  const rv = new DataView(result.buffer);
  rv.setUint32(0, h0 >>> 0, false);
  rv.setUint32(4, h1 >>> 0, false);
  rv.setUint32(8, h2 >>> 0, false);
  rv.setUint32(12, h3 >>> 0, false);
  rv.setUint32(16, h4 >>> 0, false);
  return result;
}

function rotl(n: number, s: number): number {
  return (n << s) | (n >>> (32 - s));
}
