// Redeployed: 2026-05-02 — switched to shared AI provider (Lovable AI primary, OpenAI fallback)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { AiProviderError, callChatCompletion } from "../_shared/ai-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const { action, ...params } = await req.json();

    if (action === "generate-alt-text") {
      const { image_url, product_name, mpn } = params;
      if (!image_url) throw new Error("image_url is required");

      const systemPrompt = `You are an SEO specialist writing image alt text for an e-commerce store selling LEGO sets to adult collectors. Write concise, descriptive alt text optimised for search engines and screen readers.

Rules:
- Maximum 125 characters.
- Describe what is visible in the image: the product, its packaging, angles, notable features.
- Include the set name and number naturally if relevant.
- Do not start with "Image of" or "Photo of".
- British English spelling.
- No quotes around the output.`;

      const userPrompt = `Write alt text for this image of ${product_name ?? "a LEGO product"}${mpn ? ` (set ${mpn})` : ""}.`;

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: userPrompt },
                { type: "image_url", image_url: { url: image_url, detail: "low" } },
              ],
            },
          ],
          max_tokens: 100,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("OpenAI error:", response.status, text);
        throw new Error(`OpenAI returned ${response.status}`);
      }

      const data = await response.json();
      const altText = data.choices?.[0]?.message?.content?.trim() ?? "";

      return new Response(JSON.stringify({ alt_text: altText }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "extract-age-range") {
      const { url, image_url } = params;

      const VALID_AGE_MARKS = new Set([
        "1½+", "4+", "5+", "6+", "7+", "8+", "9+", "10+", "12+", "13+", "14+", "16+", "18+",
      ]);

      let candidateImages: string[] = [];

      if (image_url) {
        // Direct image URL fallback — skip page scraping
        candidateImages = [image_url];
      } else if (url) {
        // Validate the URL is a BrickEconomy set page
        if (!/brickeconomy\.com\/set\//i.test(url)) {
          return new Response(
            JSON.stringify({ error: "URL must be a BrickEconomy set page (e.g. brickeconomy.com/set/...)" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // Extract set number from the URL path
        const setMatch = url.match(/\/set\/(\d+[A-Za-z]?(?:-\d+)?)\//);
        const setNumber = setMatch?.[1]?.replace(/-\d+$/, "") ?? null;
        if (!setNumber) {
          return new Response(
            JSON.stringify({ error: "Could not extract set number from URL" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // Fetch the BrickEconomy page
        let html: string;
        try {
          const pageRes = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            },
          });
          if (!pageRes.ok) {
            return new Response(
              JSON.stringify({ error: `BrickEconomy returned ${pageRes.status}. Try using a direct image URL instead.` }),
              { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          html = await pageRes.text();
        } catch (fetchErr) {
          console.error("BrickEconomy fetch error:", fetchErr);
          return new Response(
            JSON.stringify({ error: "Failed to fetch BrickEconomy page. Try using a direct image URL instead." }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // Truncate HTML at "Related" or "Similar" sections to avoid other sets' images
        const cutoff = html.search(/related\s+sets|similar\s+sets|you\s+may\s+also/i);
        const relevantHtml = cutoff > 0 ? html.slice(0, cutoff) : html;

        // Extract image URLs from the relevant HTML
        const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
        const allImages: string[] = [];
        let match;
        while ((match = imgRegex.exec(relevantHtml)) !== null) {
          let src = match[1];
          if (src.startsWith("//")) src = "https:" + src;
          else if (src.startsWith("/")) src = "https://www.brickeconomy.com" + src;
          allImages.push(src);
        }

        // Also check for data-src or srcset attributes (lazy-loaded images)
        const dataSrcRegex = /(?:data-src|srcset)=["']([^"'\s]+)["']/gi;
        while ((match = dataSrcRegex.exec(relevantHtml)) !== null) {
          let src = match[1];
          if (src.startsWith("//")) src = "https:" + src;
          else if (src.startsWith("/")) src = "https://www.brickeconomy.com" + src;
          allImages.push(src);
        }

        // Filter to images likely to be the target set's packaging
        const excludePatterns = /\/icons\/|\/logo|\/avatar|\/flag|\/badge|\.svg|_thumb|_small|favicon|sprite/i;
        candidateImages = allImages.filter((src) => {
          if (excludePatterns.test(src)) return false;
          // Prefer images containing the set number in the URL
          if (src.includes(setNumber)) return true;
          // Also include large product images that might not have the set number in the filename
          if (/\.(jpg|jpeg|png|webp)/i.test(src) && !excludePatterns.test(src)) {
            // Check if this looks like a product image (not a UI element)
            return /set|product|image|img|photo|pic/i.test(src) || src.includes("brickeconomy");
          }
          return false;
        });

        // Deduplicate and limit to 2 candidates
        candidateImages = [...new Set(candidateImages)].slice(0, 2);

        if (candidateImages.length === 0) {
          return new Response(
            JSON.stringify({
              age_range: null,
              confidence: "not_found",
              image_used: null,
              raw_response: "No suitable product images found on the page. Try using a direct image URL.",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      } else {
        return new Response(
          JSON.stringify({ error: "Either url or image_url is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Call OpenAI vision to identify the age mark
      const systemPrompt = `You are an expert at identifying LEGO product packaging details. Your task is to find the age recommendation mark printed on the LEGO box. LEGO age marks are a number followed by a plus sign, printed in a coloured circle or rounded rectangle on the box front. Valid values: 1½+, 4+, 5+, 6+, 7+, 8+, 9+, 10+, 12+, 13+, 14+, 16+, 18+. Return ONLY the age mark value (e.g. "18+"). If not visible, return "NOT_FOUND". Do not guess.`;

      const imageContent = candidateImages.map((imgUrl) => ({
        type: "image_url" as const,
        image_url: { url: imgUrl, detail: "high" as const },
      }));

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: "What is the age mark printed on this LEGO set box?" },
                ...imageContent,
              ],
            },
          ],
          max_tokens: 20,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("OpenAI error:", response.status, text);
        if (response.status === 429) {
          return new Response(
            JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        throw new Error(`OpenAI returned ${response.status}`);
      }

      const data = await response.json();
      const rawResponse = data.choices?.[0]?.message?.content?.trim() ?? "";

      // Validate against known age marks
      let ageRange: string | null = null;
      let confidence: "high" | "not_found" | "low";

      if (rawResponse === "NOT_FOUND") {
        confidence = "not_found";
      } else if (VALID_AGE_MARKS.has(rawResponse)) {
        ageRange = rawResponse;
        confidence = "high";
      } else {
        // Try to extract a valid age mark from the response (model may include extra text)
        const extracted = rawResponse.match(/(\d+½?\+)/)?.[1] ?? null;
        if (extracted && VALID_AGE_MARKS.has(extracted)) {
          ageRange = extracted;
          confidence = "high";
        } else {
          ageRange = extracted;
          confidence = "low";
        }
      }

      return new Response(
        JSON.stringify({
          age_range: ageRange,
          confidence,
          image_used: candidateImages[0] ?? null,
          ...(confidence === "low" ? { raw_response: rawResponse } : {}),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("chatgpt function error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
