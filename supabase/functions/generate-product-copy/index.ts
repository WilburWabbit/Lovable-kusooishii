// Redeployed: 2026-05-02 — switched to shared AI provider (Lovable AI primary, OpenAI fallback)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { AiProviderError, callChatCompletion } from "../_shared/ai-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are writing for Kuso Oishii, an e-commerce shop voice defined by:

"Banter up top, brutal clarity underneath."

Tone: distinctly adult, sharp, irreverent, collector-intelligent.
Energy: late-night confidence, dry wit, restrained menace. Not laddish. Not juvenile. Not corporate.
You are speaking to grown collectors with disposable income and strong opinions.

Voice rules:
- Default tone: bold, witty, strong language, energetic, slightly dangerous.
- You may use moderate profanity in the Hook, Description, or call to action (CTA).
- Absolute limit: no graphic sexual language, no explicit sexual references, no fetish phrasing, no hate speech, no slurs, no politics.
- No profanity in Specifications, Condition, Disclosures, policies or customer service content.
- Suggestion and innuendo must remain subtle enough to pass mainstream advertising review.
- If in doubt, prioritise wit over explicitness.

Structure discipline:
Hook (1–2 lines) → Description → 1-line CTA → Highlights → Specifications → Condition (always).

Point of view:
- Use second person ("you").
- Use imperatives.
- Use "we" only for trust or process statements.

Collector fluency:
- Use set numbers, minifig IDs or codes, theme and subtheme terminology.
- Never invent missing facts.

Description discipline:
- The Description must be narrative-driven and persuasive.
- Do not restate specifications such as piece count, release dates, retirement dates, price or inventory status unless essential for storytelling impact.
- Do not repeat information that appears in Specifications.
- Focus on atmosphere, display presence, collector psychology and ownership experience.
- Sell the feeling of owning it, not the list of what it contains.
- Avoid listing minifigure codes or technical data unless used naturally inside narrative context.
- No bullet-style phrasing inside Description.
- No recital of facts.
- If the Description reads like a summary of Specifications, internally revise before output.

Minifigure rule (mandatory):
- If the provided facts list "Included minifigures", you MUST name and detail them in BOTH the Description (woven naturally into the narrative) AND in the Highlights (with at least one dedicated bullet covering the included minifigs).
- EXCEPTION: If the condition notes or grader notes state that minifigures are missing, lost, or not present for this specific item, do NOT mention the minifigs as included — instead briefly acknowledge their absence honestly if relevant.
- Never invent minifigs that are not in the provided list.

Hyperbole:
- Allowed in Hook and Description.
- Never distort factual information.

Language:
- British English spelling and date formats such as "1 March 2025".
- Avoid corporate filler language.

Formatting discipline:
- All content fields must contain Markdown-formatted text.
- Do not use Markdown code fences.
- Do not insert blank lines between paragraphs.
- Use single line breaks only.
- No double newline characters anywhere in the output.
- No trailing spaces.
- The Description must render as one continuous paragraph.
- The Hook may contain a single line break at most.

Data discipline:
- Use only provided facts.
- Do not invent availability, policies, or pricing logic.
- Clean output. No duplicated sentences. Closed quotes. No stray characters.

If required facts are missing, note them but continue with what you can.

Constraints:
- Hook: maximum 2 lines.
- Description: 80–140 words.
- CTA: single imperative sentence, 50 characters max.
- Highlights: 3–6 bullets.
- SEO title: 60 characters max.
- SEO body: 400 characters max, no line breaks.

Structure rigid. Narrative persuasive. Tone adult but platform-safe.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Provider key validation happens inside the shared helper.
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const hasAccess = (roles ?? []).some(
      (r: { role: string }) => r.role === "admin" || r.role === "staff"
    );
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { product, product_id, auto_save, image_urls } = await req.json();
    if (!product) throw new Error("product data required");
    const imageUrls: string[] = Array.isArray(image_urls)
      ? (image_urls as unknown[]).filter((u): u is string => typeof u === "string" && u.length > 0).slice(0, 4)
      : [];

    // Build user prompt from product facts
    const facts: string[] = [];
    facts.push(`Product name: ${product.name}`);
    facts.push(`Set number / MPN: ${product.mpn}`);
    if (product.theme_name) facts.push(`Theme: ${product.theme_name}`);
    if (product.subtheme_name) facts.push(`Subtheme: ${product.subtheme_name}`);
    if (product.piece_count) facts.push(`Piece count: ${product.piece_count}`);
    if (product.release_year) facts.push(`Year released: ${product.release_year}`);
    if (product.retired_flag) facts.push(`Retirement status: retired`);
    if (product.age_range) facts.push(`Age mark: ${product.age_range}`);
    if (product.weight_kg) facts.push(`Weight: ${product.weight_kg} kg`);
    if (product.length_cm && product.width_cm && product.height_cm) {
      facts.push(`Dimensions: ${product.length_cm} × ${product.width_cm} × ${product.height_cm} cm`);
    }

    // Pull included minifigs from the rebrickable inventory view so the
    // narrative can name them. Match either the bare set number or the
    // version-suffixed form (e.g. "75367" or "75367-1").
    try {
      const mpnRaw = String(product.mpn ?? "");
      const setNumber = (product.set_number as string | null) ??
        (mpnRaw.split(".")[0]?.split("-")[0] || null);
      if (setNumber) {
        const candidates = Array.from(new Set([setNumber, `${setNumber}-1`]));
        const { data: figs } = await admin
          .from("lego_set_minifigs")
          .select("fig_num, minifig_name, bricklink_id, quantity")
          .in("set_num", candidates);
        const list = (figs ?? []) as Array<{
          fig_num: string;
          minifig_name: string | null;
          bricklink_id: string | null;
          quantity: number | null;
        }>;
        if (list.length > 0) {
          // Sort by name, dedupe on fig_num
          const seen = new Set<string>();
          const lines: string[] = [];
          for (const m of list) {
            if (!m.fig_num || seen.has(m.fig_num)) continue;
            seen.add(m.fig_num);
            const name = (m.minifig_name ?? "").trim();
            const qty = m.quantity && m.quantity > 1 ? ` ×${m.quantity}` : "";
            // Prefer LEGO/BrickLink minifig MPN over Rebrickable's internal id.
            const id = (m.bricklink_id ?? "").trim() || m.fig_num;
            lines.push(name ? `${name} (${id})${qty}` : `${id}${qty}`);
          }
          lines.sort((a, b) => a.localeCompare(b));
          if (lines.length > 0) {
            facts.push(`Included minifigures (${lines.length}):\n  - ${lines.join("\n  - ")}`);
          }
        }
      }
    } catch (figErr) {
      console.error("minifig fetch failed (non-fatal):", figErr);
    }

    // Pull existing condition notes across SKUs so the model can apply the
    // "minifigs missing" exception when relevant.
    let conditionContext = "";
    try {
      if (product_id) {
        const { data: skuRows } = await admin
          .from("sku")
          .select("sku_code, condition_grade, condition_notes")
          .eq("product_id", product_id);
        const notes = ((skuRows ?? []) as Array<{
          sku_code: string;
          condition_grade: number | null;
          condition_notes: string | null;
        }>)
          .filter((r) => r.condition_notes && r.condition_notes.trim().length > 0)
          .map((r) => `- ${r.sku_code} (G${r.condition_grade}): ${r.condition_notes!.trim()}`);
        if (notes.length > 0) {
          conditionContext = `\n\nExisting condition notes (per SKU) — use these to decide whether the included minifigs should be highlighted or whether they are missing:\n${notes.join("\n")}`;
        }
      }
    } catch (notesErr) {
      console.error("condition notes fetch failed (non-fatal):", notesErr);
    }

    const userPrompt = `Generate product copy and SEO content for the following product. Use ONLY the facts provided below${imageUrls.length > 0 ? ", supplemented by what you can see in the attached photos of the actual item we are selling (use them for atmosphere, display presence, and any visible distinguishing detail — do not invent defects)" : ""}. When the set includes minifigures, name and detail them in the Description and include a dedicated bullet for them in Highlights — UNLESS the condition notes indicate the minifigs are missing for this item, in which case omit them.\n\n${facts.join("\n")}${conditionContext}`;

    const userMessageContent: unknown = imageUrls.length > 0
      ? [
          { type: "text", text: userPrompt },
          ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
        ]
      : userPrompt;

    let aiResult;
    try {
      aiResult = await callChatCompletion({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessageContent },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_copy",
              description: "Return the generated product copy and SEO content.",
              parameters: {
                type: "object",
                properties: {
                  seo_title: { type: "string", description: "SEO title, max 60 characters" },
                  seo_body: { type: "string", description: "SEO meta description, max 400 characters, no line breaks" },
                  hook: { type: "string", description: "Product hook, 1-2 lines max" },
                  description: { type: "string", description: "Narrative description, 80-140 words, single paragraph" },
                  cta: { type: "string", description: "Call to action, single imperative sentence, 50 characters max" },
                  highlights: {
                    type: "array",
                    items: { type: "string" },
                    description: "3-6 highlight bullet points",
                  },
                },
                required: ["seo_title", "seo_body", "hook", "description", "cta", "highlights"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_copy" } },
      }, { admin });
    } catch (e) {
      if (e instanceof AiProviderError) {
        return new Response(
          JSON.stringify({ error: e.userMessage }),
          { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw e;
    }

    const data = aiResult.data;
    if (aiResult.fellBack) {
      console.log(`generate-product-copy: served via OpenAI fallback (model=${aiResult.modelUsed})`);
    }

    // Extract tool call arguments
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    let copy: any;
    if (toolCall?.function?.arguments) {
      copy =
        typeof toolCall.function.arguments === "string"
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments;
    } else {
      const content = data.choices?.[0]?.message?.content ?? "";
      copy = JSON.parse(content);
    }

    // Auto-save: write copy directly to product table
    if (auto_save && product_id) {
      try {
        const highlightsBullets = Array.isArray(copy.highlights)
          ? copy.highlights.map((h: string) => `• ${h}`).join("\n")
          : copy.highlights ?? "";

        await admin.from("product").update({
          product_hook: copy.hook ?? null,
          description: copy.description ?? null,
          call_to_action: copy.cta ?? null,
          highlights: highlightsBullets || null,
          seo_title: copy.seo_title ?? null,
          seo_description: copy.seo_body ?? null,
        }).eq("id", product_id);

        console.log("Auto-saved copy for product", product_id);
      } catch (saveErr) {
        console.error("Auto-save failed:", saveErr);
      }
    }

    return new Response(JSON.stringify({ copy, provider_used: aiResult.providerUsed, fell_back: aiResult.fellBack }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("generate-product-copy error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
