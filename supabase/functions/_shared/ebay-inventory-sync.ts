// ============================================================
// Shared eBay Inventory Sync Helper
// ------------------------------------------------------------
// Single point of truth for "after our local stock changed,
// update eBay's available quantity (and end the offer if 0)".
//
// Used by every code path that mutates stock_unit.v2_status,
// so eBay never lags behind the database.
// ============================================================

import { getEbayAccessToken } from "./ebay-auth.ts";

const EBAY_API = "https://api.ebay.com";
const FETCH_TIMEOUT_MS = 30_000;

function ebayFetchTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function ebayFetch(token: string, path: string, options: RequestInit = {}): Promise<any> {
  const res = await ebayFetchTimeout(`${EBAY_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-GB",
      "Accept-Language": "en-GB",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_GB",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay API [${res.status}] ${path}: ${text}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text?.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Count the available stock units for a SKU.
 * v2_status is the source of truth (the legacy `status` column drifts).
 * "Available" = graded (ready to ship) or listed (currently on a channel).
 */
async function countAvailable(admin: any, skuId: string): Promise<number> {
  const { count } = await admin
    .from("stock_unit")
    .select("id", { count: "exact", head: true })
    .eq("sku_id", skuId)
    .in("v2_status", ["graded", "listed"]);
  return count ?? 0;
}

/**
 * Push the current available stock count for a SKU to every live eBay
 * listing for that SKU. If the new quantity is 0, withdraw the offer
 * (which ends the listing on eBay) so it stops showing as buyable.
 *
 * Non-throwing: failures are logged and audited but do not bubble up,
 * because callers (Stripe webhook, order processors) must succeed even
 * when eBay is unreachable.
 */
export async function pushEbayQuantityForSku(
  admin: any,
  skuId: string,
  opts: { source: string; correlationId?: string; orderId?: string } = { source: "unknown" },
): Promise<{ pushed: number; withdrawn: number; failed: number }> {
  const result = { pushed: 0, withdrawn: 0, failed: 0 };

  // Find live eBay listings for this SKU. We only push to listings that
  // were actually created on eBay (have an external_listing_id).
  const { data: listings, error: listErr } = await admin
    .from("channel_listing")
    .select("id, external_sku, external_listing_id, listed_quantity")
    .eq("sku_id", skuId)
    .eq("channel", "ebay")
    .eq("v2_status", "live")
    .not("external_listing_id", "is", null);

  if (listErr) {
    console.error(`[ebay-inventory-sync] listing lookup failed for sku ${skuId}: ${listErr.message}`);
    return result;
  }

  if (!listings || listings.length === 0) return result;

  const qty = await countAvailable(admin, skuId);

  let token: string;
  try {
    token = await getEbayAccessToken(admin);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ebay-inventory-sync] could not get eBay token: ${msg}`);
    for (const l of listings) {
      result.failed++;
      await auditFailure(admin, l, qty, msg, opts);
    }
    return result;
  }

  for (const listing of listings) {
    const sku = listing.external_sku as string;
    const offerId = listing.external_listing_id as string;
    try {
      // 1. Update the inventory item quantity
      const existing = await ebayFetch(token, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`);
      if (!existing) {
        // Inventory item doesn't exist on eBay — nothing to update; skip silently.
        console.log(`[ebay-inventory-sync] no inventory item on eBay for ${sku}, skipping`);
        continue;
      }
      const updated = {
        ...existing,
        availability: {
          ...(existing.availability || {}),
          shipToLocationAvailability: {
            ...(existing.availability?.shipToLocationAvailability || {}),
            quantity: qty,
          },
        },
      };
      await ebayFetch(token, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
        method: "PUT",
        body: JSON.stringify(updated),
      });

      // 2. If we just hit zero, end the listing by withdrawing the offer.
      // eBay treats "qty=0 + offer published" as out-of-stock but the
      // listing card stays visible; withdraw makes it actually go away.
      let withdrew = false;
      if (qty === 0) {
        try {
          await ebayFetch(token, `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`, {
            method: "POST",
          });
          withdrew = true;
        } catch (wErr) {
          // 404 / "offer not published" is fine — listing already ended.
          const msg = wErr instanceof Error ? wErr.message : String(wErr);
          if (!/404|not.*published|already/i.test(msg)) {
            throw wErr;
          }
        }
      }

      // 3. Persist the new state locally
      const patch: Record<string, unknown> = {
        listed_quantity: qty,
        synced_at: new Date().toISOString(),
      };
      if (withdrew) {
        patch.v2_status = "ended";
      }
      await admin.from("channel_listing").update(patch as never).eq("id", listing.id);

      if (withdrew) result.withdrawn++;
      else result.pushed++;

      console.log(
        `[ebay-inventory-sync] ${sku} → qty ${qty}` + (withdrew ? " (offer withdrawn)" : ""),
      );
    } catch (e) {
      result.failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ebay-inventory-sync] failed for ${sku} (qty ${qty}): ${msg}`);
      await auditFailure(admin, listing, qty, msg, opts);
    }
  }

  return result;
}

/**
 * Convenience wrapper for callers that have a set of affected SKU IDs.
 * Runs sequentially to stay under eBay rate limits and to make logs readable.
 */
export async function pushEbayQuantityForSkus(
  admin: any,
  skuIds: Iterable<string>,
  opts: { source: string; correlationId?: string; orderId?: string } = { source: "unknown" },
): Promise<{ pushed: number; withdrawn: number; failed: number }> {
  const totals = { pushed: 0, withdrawn: 0, failed: 0 };
  for (const skuId of skuIds) {
    const r = await pushEbayQuantityForSku(admin, skuId, opts);
    totals.pushed += r.pushed;
    totals.withdrawn += r.withdrawn;
    totals.failed += r.failed;
  }
  return totals;
}

async function auditFailure(
  admin: any,
  listing: { id: string; external_sku: string },
  qty: number,
  errorMessage: string,
  opts: { source: string; correlationId?: string; orderId?: string },
) {
  try {
    await admin.from("audit_event").insert({
      entity_type: "channel_listing",
      entity_id: listing.id,
      trigger_type: "ebay_stock_desync",
      actor_type: "system",
      source_system: opts.source,
      correlation_id: opts.correlationId ?? null,
      after_json: {
        external_sku: listing.external_sku,
        intended_quantity: qty,
        order_id: opts.orderId ?? null,
        error: errorMessage,
      },
    });
  } catch (e) {
    console.error(`[ebay-inventory-sync] failed to write audit_event: ${e}`);
  }
}
