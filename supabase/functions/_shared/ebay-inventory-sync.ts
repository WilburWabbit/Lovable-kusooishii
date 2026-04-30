// ============================================================
// Shared eBay Inventory Sync Outbox Helper
// ------------------------------------------------------------
// Single point of truth for "after our local stock changed, queue an
// eBay available-quantity update (and end the offer if 0)".
//
// Used by every code path that mutates stock_unit.v2_status,
// so external writes go through the app-side listing outbox.
// ============================================================

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
 * Queue the current available stock count for every live eBay listing for
 * this SKU. The listing-command processor performs the external eBay write.
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

  // Find live eBay listings for this SKU. We only queue listings that
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

  for (const listing of listings) {
    try {
      const { error: commandErr } = await admin.rpc("queue_listing_command", {
        p_channel_listing_id: listing.id,
        p_command_type: "sync_quantity",
      });
      if (commandErr) throw commandErr;

      console.log(
        `[ebay-inventory-sync] queued ${listing.external_sku} → qty ${qty}`,
      );
      if (qty === 0) {
        result.withdrawn++;
      } else {
        result.pushed++;
      }
    } catch (e) {
      result.failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ebay-inventory-sync] failed to queue ${listing.external_sku} (qty ${qty}): ${msg}`);
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
