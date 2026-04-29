// ============================================================
// bricklink-minifigs-sync
//
// Per-set sync of minifigs from BrickLink. Calls the subsets
// API to enumerate minifig MPNs (e.g. "sw0001") for one set,
// then fetches each minifig's catalog entry to grab its image.
//
// Writes to public.bricklink_set_minifig (set_no, bl_mpn,
// name, image_url, quantity).
//
// Triggered on demand from the product detail Specifications
// tab. Sets MPN must include the BrickLink version suffix
// (e.g. "75367-1"); if the caller passes a bare set number
// (e.g. "75367"), we try "{n}-1" as a fallback.
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import {
  fetchSetMinifigs,
  fetchMinifigItem,
  getBlCreds,
  type BlMinifig,
} from "../_shared/bricklink-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normaliseImage(url: string | undefined | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("http://")) return trimmed.replace(/^http:/, "https:");
  if (trimmed.startsWith("https://")) return trimmed;
  return null;
}

async function requireStaff(
  admin: ReturnType<typeof createClient>,
  authHeader: string | null,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!authHeader) return { ok: false, status: 401, error: "Missing auth" };
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, error: "Invalid auth" };
  }
  const userId = userData.user.id;
  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const allowed = (roles ?? []).some((r) =>
    ["admin", "staff"].includes((r as { role: string }).role),
  );
  if (!allowed) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const auth = await requireStaff(admin, req.headers.get("Authorization"));
    if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

    const creds = getBlCreds();
    if (!creds) {
      return jsonResponse(
        {
          error: "BrickLink credentials not configured",
          configured: false,
        },
        200,
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawMpn: string =
      typeof body.mpn === "string" && body.mpn.trim().length > 0
        ? body.mpn.trim()
        : "";
    if (!rawMpn) return jsonResponse({ error: "mpn required" }, 400);

    // Strip any "MPN.grade" suffix and try the version-suffixed form.
    const baseMpn = rawMpn.split(".")[0];
    const candidates = Array.from(
      new Set([baseMpn, baseMpn.includes("-") ? baseMpn : `${baseMpn}-1`]),
    );

    let resolvedSetNo: string | null = null;
    let figs: BlMinifig[] | null = null;
    for (const cand of candidates) {
      figs = await fetchSetMinifigs(cand, creds);
      if (figs) {
        resolvedSetNo = cand;
        break;
      }
    }

    if (!figs || !resolvedSetNo) {
      return jsonResponse(
        {
          source: "bricklink",
          mpn: rawMpn,
          resolved: null,
          fetched: 0,
          upserted: 0,
          minifigs: [],
          message: "Set not found on BrickLink",
        },
        200,
      );
    }

    // De-dupe minifigs by MPN (a set may list the same fig twice with
    // is_alternate already filtered out, but be defensive).
    const dedup = new Map<string, BlMinifig>();
    for (const f of figs) {
      if (!f.no) continue;
      const existing = dedup.get(f.no);
      if (existing) {
        existing.quantity += f.quantity;
      } else {
        dedup.set(f.no, { ...f });
      }
    }
    const uniqueFigs = Array.from(dedup.values());

    // Fetch image_url per minifig. Sequential keeps us under BrickLink's
    // soft rate limit and keeps logs readable; the figure count per set
    // is typically small (<20).
    const enriched: Array<{
      bl_mpn: string;
      name: string | null;
      image_url: string | null;
      quantity: number;
    }> = [];
    let imagesFetched = 0;
    for (const f of uniqueFigs) {
      let imageUrl: string | null = null;
      try {
        const item = await fetchMinifigItem(f.no, creds);
        imageUrl =
          normaliseImage(item?.image_url) ??
          normaliseImage(item?.thumbnail_url);
        if (imageUrl) imagesFetched++;
      } catch (e) {
        console.warn(
          `[bricklink-minifigs-sync] image fetch failed for ${f.no}:`,
          (e as Error).message,
        );
      }
      enriched.push({
        bl_mpn: f.no,
        name: f.name ?? null,
        image_url: imageUrl,
        quantity: f.quantity,
      });
    }

    // Upsert (set_no, bl_mpn) — refresh name/image/qty/fetched_at.
    const now = new Date().toISOString();
    const rows = enriched.map((e) => ({
      set_no: resolvedSetNo!,
      bl_mpn: e.bl_mpn,
      name: e.name,
      image_url: e.image_url,
      quantity: e.quantity,
      fetched_at: now,
    }));

    let upserted = 0;
    if (rows.length > 0) {
      const { error: upErr, count } = await admin
        .from("bricklink_set_minifig")
        .upsert(rows, { onConflict: "set_no,bl_mpn", count: "exact" });
      if (upErr) {
        return jsonResponse(
          { error: `Upsert failed: ${upErr.message}` },
          500,
        );
      }
      upserted = count ?? rows.length;
    }

    return jsonResponse({
      source: "bricklink",
      mpn: rawMpn,
      resolved: resolvedSetNo,
      fetched: uniqueFigs.length,
      images_fetched: imagesFetched,
      upserted,
      minifigs: enriched,
    });
  } catch (err) {
    console.error("[bricklink-minifigs-sync] error:", err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
