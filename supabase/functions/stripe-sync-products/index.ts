// Redeployed: 2026-04-05
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned.length > 0 ? cleaned : null;
}

async function authenticateAdmin(req: Request, admin: any) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) throw new Error("Unauthorized");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
  const hasAccess = (roles ?? []).some((r: { role: string }) => r.role === "admin" || r.role === "staff");
  if (!hasAccess) throw new Error("Forbidden");
}

async function getStripeClient(admin: any) {
  const { data: appSettings } = await admin
    .from("app_settings")
    .select("stripe_test_mode")
    .single();
  const isTestMode = appSettings?.stripe_test_mode ?? false;
  const secretKey = isTestMode
    ? Deno.env.get("STRIPE_SANDBOX_SECRET_KEY") || ""
    : Deno.env.get("STRIPE_SECRET_KEY") || "";
  if (!secretKey) {
    throw new Error(isTestMode ? "STRIPE_SANDBOX_SECRET_KEY is not configured" : "STRIPE_SECRET_KEY is not configured");
  }

  return {
    isTestMode,
    stripe: new Stripe(secretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    }),
  };
}

function buildStripeProductName(row: Record<string, unknown>): string {
  const product = (row.product as Record<string, unknown> | null) ?? null;
  const productName = cleanText(product?.name as string | null | undefined);
  const skuName = cleanText(row.name as string | null | undefined);
  const skuCode = row.sku_code as string;
  const grade = String(row.condition_grade ?? "");

  return `${productName ?? skuName ?? skuCode} [${skuCode}]${grade ? ` G${grade}` : ""}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);
    await authenticateAdmin(req, admin);
    const { stripe, isTestMode } = await getStripeClient(admin);

    const { data: skus, error } = await admin
      .from("sku")
      .select("id, sku_code, condition_grade, price, active_flag, saleable_flag, name, stripe_product_id, stripe_price_id, product:product_id(mpn, name, img_url)")
      .order("updated_at", { ascending: false });

    if (error) throw new Error(`Failed to load SKUs: ${error.message}`);

    let createdProducts = 0;
    let updatedProducts = 0;
    let createdPrices = 0;
    let deactivatedProducts = 0;
    let unchanged = 0;
    let errors = 0;

    for (const row of (skus ?? []) as Record<string, unknown>[]) {
      try {
        const skuId = row.id as string;
        const skuCode = row.sku_code as string;
        const price = Number(row.price ?? 0);
        const stripeProductId = cleanText(row.stripe_product_id as string | null | undefined);
        const stripePriceId = cleanText(row.stripe_price_id as string | null | undefined);
        const product = (row.product as Record<string, unknown> | null) ?? null;
        const active = (row.active_flag as boolean) !== false
          && (row.saleable_flag as boolean) !== false
          && price > 0;
        const name = buildStripeProductName(row);
        const description = [
          cleanText(product?.name as string | null | undefined),
          `SKU ${skuCode}`,
          `Condition grade ${row.condition_grade as string | number}`,
        ].filter(Boolean).join(" · ");
        const image = cleanText(product?.img_url as string | null | undefined);
        const metadata = {
          local_sku_id: skuId,
          sku_code: skuCode,
          mpn: cleanText(product?.mpn as string | null | undefined) ?? "",
          condition_grade: String(row.condition_grade ?? ""),
          source: "kusooishii",
        };

        let stripeProduct: Stripe.Product | null = null;
        if (stripeProductId) {
          const existingProduct = await stripe.products.retrieve(stripeProductId);
          if (!("deleted" in existingProduct) || existingProduct.deleted !== true) {
            stripeProduct = existingProduct as Stripe.Product;
          }
        }

        if (!stripeProduct) {
          stripeProduct = await stripe.products.create({
            name,
            description,
            active,
            images: image ? [image] : undefined,
            metadata,
          });
          createdProducts++;
        } else {
          await stripe.products.update(stripeProduct.id, {
            name,
            description,
            active,
            images: image ? [image] : undefined,
            metadata,
          });
          updatedProducts++;
        }

        let nextPriceId = stripePriceId;

        if (active) {
          const targetAmount = Math.round(price * 100);
          let currentPriceMatches = false;

          if (stripePriceId) {
            const existingPrice = await stripe.prices.retrieve(stripePriceId);
            currentPriceMatches = existingPrice.active && existingPrice.unit_amount === targetAmount && existingPrice.currency === "gbp";
          }

          if (!currentPriceMatches) {
            const newPrice = await stripe.prices.create({
              currency: "gbp",
              unit_amount: targetAmount,
              product: stripeProduct.id,
              nickname: skuCode,
              metadata,
            });
            nextPriceId = newPrice.id;
            createdPrices++;

            await stripe.products.update(stripeProduct.id, {
              default_price: newPrice.id,
            });

            if (stripePriceId && stripePriceId !== newPrice.id) {
              await stripe.prices.update(stripePriceId, { active: false });
            }
          } else {
            unchanged++;
          }
        } else {
          if (stripeProduct.active) {
            await stripe.products.update(stripeProduct.id, { active: false });
          }
          nextPriceId = stripePriceId;
          deactivatedProducts++;
        }

        await admin
          .from("sku")
          .update({
            stripe_product_id: stripeProduct.id,
            stripe_price_id: nextPriceId,
          })
          .eq("id", skuId);
      } catch (syncErr) {
        errors++;
        console.error("stripe-sync-products row failed:", syncErr);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      mode: isTestMode ? "test" : "live",
      total: skus?.length ?? 0,
      created_products: createdProducts,
      updated_products: updatedProducts,
      created_prices: createdPrices,
      deactivated_products: deactivatedProducts,
      unchanged,
      errors,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("stripe-sync-products error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
    );
  }
});
