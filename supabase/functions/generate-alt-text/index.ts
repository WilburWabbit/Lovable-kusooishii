// ============================================================
// Generate Alt Text
// Uses Claude API with vision to describe a product image.
// Auto-saves to media_asset.alt_text after generation.
// ============================================================

import {
  corsHeaders,
  createAdminClient,
  authenticateRequest,
  jsonResponse,
  errorResponse,
} from "../_shared/qbo-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const { imageUrl, productName, mediaAssetId } = await req.json();
    if (!imageUrl) throw new Error("imageUrl is required");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "url", url: imageUrl },
              },
              {
                type: "text",
                text: `Write a concise, descriptive alt text for this product image. The product is: ${productName ?? "a LEGO set"}.
The alt text should be:
- 1-2 sentences (max 125 characters preferred)
- Descriptive of what's visually shown (box, built set, minifigures, etc.)
- Useful for accessibility and SEO
Return ONLY the alt text string, no quotes or explanation.`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error [${response.status}]: ${errorText}`);
    }

    const result = await response.json();
    const altText = (result.content?.[0]?.text ?? "").trim();

    // Auto-save to media_asset if ID provided
    if (mediaAssetId && altText) {
      await admin
        .from("media_asset")
        .update({ alt_text: altText })
        .eq("id", mediaAssetId);
    }

    return jsonResponse({
      success: true,
      altText,
      mediaAssetId: mediaAssetId ?? null,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
