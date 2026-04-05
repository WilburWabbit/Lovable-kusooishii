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

function buildAddress(customer: Record<string, unknown>) {
  const line1 = cleanText(customer.billing_line_1 as string | null | undefined);
  const city = cleanText(customer.billing_city as string | null | undefined);
  const postcode = cleanText(customer.billing_postcode as string | null | undefined);
  const country = cleanText(customer.billing_country as string | null | undefined);

  if (!line1 && !city && !postcode && !country) return undefined;

  return {
    line1: line1 ?? undefined,
    line2: cleanText(customer.billing_line_2 as string | null | undefined) ?? undefined,
    city: city ?? undefined,
    state: cleanText(customer.billing_county as string | null | undefined) ?? undefined,
    postal_code: postcode ?? undefined,
    country: (country ?? "GB").toUpperCase(),
  };
}

async function authenticateAdmin(req: Request, admin: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) throw new Error("Unauthorized");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
  const hasAccess = (roles ?? []).some((r: { role: string }) => r.role === "admin" || r.role === "staff");
  if (!hasAccess) throw new Error("Forbidden");
}

async function getStripeClient(admin: ReturnType<typeof createClient>) {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);
    await authenticateAdmin(req, admin);
    const { stripe, isTestMode } = await getStripeClient(admin);

    const { data: customers, error } = await admin
      .from("customer")
      .select("id, stripe_customer_id, qbo_customer_id, user_id, display_name, company_name, email, phone, mobile, billing_line_1, billing_line_2, billing_city, billing_county, billing_postcode, billing_country, active")
      .order("updated_at", { ascending: false });

    if (error) throw new Error(`Failed to load customers: ${error.message}`);

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let errors = 0;

    for (const row of (customers ?? []) as Record<string, unknown>[]) {
      try {
        const localCustomerId = row.id as string;
        const email = cleanText(row.email as string | null | undefined);
        const displayName = cleanText(row.display_name as string | null | undefined)
          ?? cleanText(row.company_name as string | null | undefined)
          ?? email
          ?? `Customer ${localCustomerId.slice(0, 8)}`;
        const phone = cleanText((row.mobile as string | null | undefined) ?? (row.phone as string | null | undefined));
        const address = buildAddress(row);
        const active = (row.active as boolean) !== false;

        const metadata = {
          local_customer_id: localCustomerId,
          qbo_customer_id: cleanText(row.qbo_customer_id as string | null | undefined) ?? "",
          user_id: cleanText(row.user_id as string | null | undefined) ?? "",
          source: "kusooishii",
        };

        let stripeCustomerId = cleanText(row.stripe_customer_id as string | null | undefined);
        let stripeCustomer: Stripe.Customer | null = null;

        if (stripeCustomerId) {
          const existing = await stripe.customers.retrieve(stripeCustomerId);
          if (!("deleted" in existing) || existing.deleted !== true) {
            stripeCustomer = existing as Stripe.Customer;
          } else {
            stripeCustomerId = null;
          }
        }

        if (!stripeCustomer && email) {
          const existingByEmail = await stripe.customers.list({ email, limit: 10 });
          stripeCustomer = existingByEmail.data.find((candidate) =>
            candidate.metadata?.local_customer_id === localCustomerId
            || candidate.email?.toLowerCase() === email.toLowerCase()
          ) ?? null;
          stripeCustomerId = stripeCustomer?.id ?? stripeCustomerId;
        }

        if (!stripeCustomer) {
          stripeCustomer = await stripe.customers.create({
            name: displayName,
            email: email ?? undefined,
            phone: phone ?? undefined,
            address,
            metadata,
          });
          stripeCustomerId = stripeCustomer.id;
          created++;
        } else {
          await stripe.customers.update(stripeCustomer.id, {
            name: displayName,
            email: email ?? undefined,
            phone: phone ?? undefined,
            address,
            metadata,
          });
          if (stripeCustomerId !== stripeCustomer.id || stripeCustomer.name !== displayName || stripeCustomer.email !== email || stripeCustomer.phone !== phone) {
            updated++;
          } else {
            unchanged++;
          }
          stripeCustomerId = stripeCustomer.id;
        }

        await admin
          .from("customer")
          .update({ stripe_customer_id: stripeCustomerId, synced_at: new Date().toISOString() })
          .eq("id", localCustomerId);

        if (!active && stripeCustomerId) {
          await stripe.customers.update(stripeCustomerId, {
            metadata: {
              ...metadata,
              active: "false",
            },
          });
        }
      } catch (syncErr) {
        errors++;
        console.error("stripe-sync-customers row failed:", syncErr);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      mode: isTestMode ? "test" : "live",
      total: customers?.length ?? 0,
      created,
      updated,
      unchanged,
      errors,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("stripe-sync-customers error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
    );
  }
});
