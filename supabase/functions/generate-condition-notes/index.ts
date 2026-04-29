// Redeployed: 2026-03-23
// ============================================================
// Generate Condition Notes
// Uses Claude API to draft condition notes from grade + flags.
// Returns text for user review — does NOT auto-save.
// ============================================================

import {
  corsHeaders,
  createAdminClient,
  authenticateRequest,
  jsonResponse,
  errorResponse,
} from "../_shared/qbo-helpers.ts";

const GRADE_DESCRIPTIONS: Record<number, string> = {
  1: "Gold Standard — Factory sealed, flawless or near-flawless box",
  2: "Silver Lining — Sealed box with cosmetic damage, complete inside",
  3: "Bronze Age — Opened or heavily damaged box, complete but lived-in",
  4: "Black Sheep — Opened or pre-built, missing key items, fully disclosed",
};

const FLAG_LABELS: Record<string, string> = {
  resealed: "Box has been resealed",
  shelf_wear: "Minor shelf wear present",
  box_dent: "Box has dent(s)",
  box_crush: "Box has crush damage",
  missing_outer_carton: "Missing outer shipping carton",
  bags_opened: "Internal bags have been opened",
  parts_verified: "Parts have been verified complete",
  sun_yellowing: "Sun yellowing on box",
  price_sticker_residue: "Price sticker residue present",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const { mpn, grade, conditionFlags, productName, unitNotes, imageUrls } = await req.json();
    if (!grade) throw new Error("grade is required");

    const gradeDesc = GRADE_DESCRIPTIONS[grade] ?? `Grade ${grade}`;
    const flags = (conditionFlags ?? [])
      .map((f: string) => FLAG_LABELS[f] ?? f)
      .join("\n- ");
    const notesBlob = Array.isArray(unitNotes)
      ? (unitNotes as unknown[])
          .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
          .map((n, i) => `${i + 1}. ${n.trim()}`)
          .join("\n")
      : "";

    const prompt = `You are writing condition notes for a LEGO set listing on a resale e-commerce store called "Kuso".
The brand voice is honest, direct, and collector-aware — never euphemistic about defects.

Product: ${productName ?? mpn ?? "LEGO set"}
MPN: ${mpn ?? "unknown"}
Grade: ${gradeDesc}
${flags ? `Condition flags:\n- ${flags}` : "No specific condition flags noted."}
${notesBlob ? `\nGrader notes captured against individual stock units of this grade:\n${notesBlob}` : ""}
${Array.isArray(imageUrls) && imageUrls.length > 0 ? "\nPhotos of the actual item are attached. Reference visible defects or condition cues honestly." : ""}

Write condition notes (2-4 sentences) that:
1. State the grade and what it means for this specific set
2. Describe each condition flag and any defects visible in photos or grader notes honestly and specifically
3. Reassure the buyer about what IS good about the item
4. Use a confident, no-nonsense tone

Return ONLY the condition notes text, no quotes or explanation.`;

    const userContent: unknown = Array.isArray(imageUrls) && imageUrls.length > 0
      ? [
          { type: "text", text: prompt },
          ...(imageUrls as string[])
            .filter((u) => typeof u === "string" && u.length > 0)
            .slice(0, 4)
            .map((url) => ({
              type: "image",
              source: { type: "url", url },
            })),
        ]
      : prompt;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error [${response.status}]: ${errorText}`);
    }

    const result = await response.json();
    const conditionNotes = (result.content?.[0]?.text ?? "").trim();

    return jsonResponse({
      success: true,
      conditionNotes,
      mpn: mpn ?? null,
      grade,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
