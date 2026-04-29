// Shared BrickLink API client.
//
// BrickLink uses OAuth 1.0a (HMAC-SHA1) signing on every request. Credentials
// come from four secrets:
//   BRICKLINK_CONSUMER_KEY
//   BRICKLINK_COMSUMER_SECRET   (note: existing project secret has this typo;
//                                we also accept the correctly-spelt name)
//   BRICKLINK_TOKEN_VALUE
//   BRICKLINK_TOKEN_SECRET
//
// Docs: https://www.bricklink.com/v3/api.page

const BL_BASE = "https://api.bricklink.com/api/store/v1";

export interface BlCreds {
  consumerKey: string;
  consumerSecret: string;
  tokenValue: string;
  tokenSecret: string;
}

export function getBlCreds(): BlCreds | null {
  const consumerKey = Deno.env.get("BRICKLINK_CONSUMER_KEY") ?? "";
  // Accept both the typo'd existing secret and the correctly-spelt name.
  const consumerSecret =
    Deno.env.get("BRICKLINK_CONSUMER_SECRET") ??
    Deno.env.get("BRICKLINK_COMSUMER_SECRET") ??
    "";
  const tokenValue = Deno.env.get("BRICKLINK_TOKEN_VALUE") ?? "";
  const tokenSecret = Deno.env.get("BRICKLINK_TOKEN_SECRET") ?? "";
  if (!consumerKey || !consumerSecret || !tokenValue || !tokenSecret) {
    return null;
  }
  return { consumerKey, consumerSecret, tokenValue, tokenSecret };
}

// RFC 3986 percent-encoding (stricter than encodeURIComponent).
function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

async function hmacSha1Base64(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  // base64
  let bin = "";
  const bytes = new Uint8Array(sig);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function buildAuthHeader(
  method: string,
  url: string,
  query: Record<string, string>,
  creds: BlCreds,
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_token: creds.tokenValue,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_version: "1.0",
  };

  // Combine for signature base string
  const all: Record<string, string> = { ...oauthParams, ...query };
  const sortedKeys = Object.keys(all).sort();
  const paramString = sortedKeys
    .map((k) => `${pctEncode(k)}=${pctEncode(all[k])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    pctEncode(url),
    pctEncode(paramString),
  ].join("&");

  const signingKey = `${pctEncode(creds.consumerSecret)}&${pctEncode(creds.tokenSecret)}`;
  const signature = await hmacSha1Base64(signingKey, baseString);

  oauthParams.oauth_signature = signature;

  const header =
    "OAuth " +
    Object.keys(oauthParams)
      .sort()
      .map((k) => `${pctEncode(k)}="${pctEncode(oauthParams[k])}"`)
      .join(", ");
  return header;
}

export class BlHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "BlHttpError";
  }
}

interface BlMeta {
  description: string;
  message: string;
  code: number;
}

interface BlEnvelope<T> {
  meta: BlMeta;
  data: T;
}

export async function blGet<T>(
  path: string,
  query: Record<string, string>,
  creds: BlCreds,
): Promise<T> {
  const url = `${BL_BASE}${path}`;
  const auth = await buildAuthHeader("GET", url, query, creds);
  const qs = new URLSearchParams(query).toString();
  const fullUrl = qs ? `${url}?${qs}` : url;

  const res = await fetch(fullUrl, {
    method: "GET",
    headers: { Authorization: auth, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new BlHttpError(res.status, `BrickLink ${res.status}: ${text}`);
  }
  let env: BlEnvelope<T>;
  try {
    env = JSON.parse(text) as BlEnvelope<T>;
  } catch {
    throw new BlHttpError(res.status, `BrickLink invalid JSON: ${text}`);
  }
  if (env.meta && env.meta.code >= 400) {
    throw new BlHttpError(
      env.meta.code,
      `BrickLink ${env.meta.code}: ${env.meta.message} — ${env.meta.description}`,
    );
  }
  return env.data;
}

// ---------------------------------------------------------------------------
// /items/SET/{set_no}/subsets
// Returns every item that makes up the set, including minifigs. Minifig items
// have item.type === "MINIFIG" and item.no is the BrickLink minifig MPN
// (e.g. "sw0001").
// ---------------------------------------------------------------------------

export interface BlSubsetItem {
  no: string;
  name: string;
  type: string; // "PART" | "MINIFIG" | "GEAR" | ...
  category_id?: number;
}

interface BlSubsetEntry {
  match_no: number;
  entries: Array<{
    item: BlSubsetItem;
    color_id: number;
    quantity: number;
    extra_quantity: number;
    is_alternate: boolean;
    is_counterpart: boolean;
  }>;
}

export interface BlMinifig {
  no: string; // BrickLink MPN, e.g. "sw0001"
  name: string;
  quantity: number;
}

/**
 * Fetch all minifigs included in a LEGO set from BrickLink.
 * `setNo` should be the BrickLink set number, including the version suffix
 * (e.g. "75367-1").
 *
 * Returns null when the set is not found on BrickLink (404).
 */
export async function fetchSetMinifigs(
  setNo: string,
  creds: BlCreds,
): Promise<BlMinifig[] | null> {
  try {
    const data = await blGet<BlSubsetEntry[]>(
      `/items/SET/${encodeURIComponent(setNo)}/subsets`,
      { break_minifigs: "false" },
      creds,
    );
    const out: BlMinifig[] = [];
    for (const group of data) {
      for (const e of group.entries) {
        if (e.item.type !== "MINIFIG") continue;
        if (e.is_alternate || e.is_counterpart) continue;
        out.push({
          no: e.item.no,
          name: e.item.name,
          quantity: (e.quantity ?? 0) + (e.extra_quantity ?? 0),
        });
      }
    }
    return out;
  } catch (err) {
    if (err instanceof BlHttpError && err.status === 404) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// /items/MINIFIG/{no}
// Returns the catalog metadata for a single minifig, including image_url and
// thumbnail_url. Returns null on 404 so callers can fall back gracefully.
// ---------------------------------------------------------------------------

export interface BlMinifigItem {
  no: string;
  name: string;
  type: string; // "MINIFIG"
  image_url?: string;
  thumbnail_url?: string;
  category_id?: number;
  weight?: string | number;
}

export async function fetchMinifigItem(
  no: string,
  creds: BlCreds,
): Promise<BlMinifigItem | null> {
  try {
    const data = await blGet<BlMinifigItem>(
      `/items/MINIFIG/${encodeURIComponent(no)}`,
      {},
      creds,
    );
    return data;
  } catch (err) {
    if (err instanceof BlHttpError && err.status === 404) return null;
    throw err;
  }
}

// Normalise a minifig name for fuzzy matching across BrickLink and Rebrickable.
// Both vendors use slightly different punctuation/casing/qualifiers.
export function normalizeMinifigName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ") // drop "(reddish brown hair)" etc.
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
