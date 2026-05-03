import {
  GOOGLE_PRODUCT_TAXONOMY_ROWS,
  GOOGLE_PRODUCT_TAXONOMY_VERSION,
} from "./google-product-taxonomy-data.ts";

export interface GoogleProductTaxonomyEntry {
  id: string;
  name: string;
  path: string;
  keywords: string[];
}

export interface GoogleProductTaxonomyCandidate {
  id: string;
  name: string;
  path: string;
  score: number;
  source: "google-product-taxonomy";
}

export { GOOGLE_PRODUCT_TAXONOMY_VERSION };

export const DEFAULT_LEGO_GOOGLE_PRODUCT_CATEGORY_ID = "3287";

const TAXONOMY_KEYWORDS_BY_ID: Record<string, string[]> = {
  "3287": ["lego", "brick", "bricks", "block", "blocks", "interlocking", "set", "sets", "building", "construction"],
  "1254": ["lego", "toy", "toys", "building", "construction", "set", "sets", "blocks"],
  "3805": ["construction", "set", "sets", "kit", "model", "building"],
  "6058": ["minifigure", "minifig", "figure", "figures", "character", "collectible", "collectable"],
  "3166": ["playset", "playsets", "scene", "display", "diorama"],
  "1255": ["figure", "figures", "doll", "playset", "playsets", "minifigure", "minifig"],
  "1262": ["educational", "learning", "stem", "technic", "science", "exploration"],
  "499938": ["space", "astronomy", "rocket", "nasa", "planet", "moon", "star wars"],
  "2505": ["vehicle", "vehicles", "car", "cars", "truck", "lorry", "ship", "boat", "plane", "helicopter"],
  "5152": ["train", "trains", "locomotive", "railway", "railroad"],
  "3589": ["spaceship", "space", "starship", "shuttle", "star wars"],
  "3551": ["car", "cars", "speed", "racer", "vehicle"],
  "3296": ["lorry", "truck", "construction", "digger", "crane", "vehicle"],
  "3792": ["boat", "boats", "ship", "ships", "vessel"],
  "3444": ["plane", "planes", "airplane", "aeroplane", "jet", "aircraft"],
  "1246": ["board game", "boardgame", "game", "games"],
  "3867": ["puzzle", "puzzles"],
  "1239": ["toy", "toys", "game", "games"],
};

export const GOOGLE_PRODUCT_TAXONOMY_ENTRIES: GoogleProductTaxonomyEntry[] =
  GOOGLE_PRODUCT_TAXONOMY_ROWS.map(([id, path]) => ({
    id,
    path,
    name: path.split(" > ").at(-1) ?? path,
    keywords: TAXONOMY_KEYWORDS_BY_ID[id] ?? [],
  }));

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9&]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2),
  );
}

function textFromProductSample(sample: Record<string, unknown>): string {
  return [
    sample.mpn,
    sample.name,
    sample.product_type,
    sample.lego_theme,
    sample.lego_subtheme,
    sample.subtheme_name,
    sample.status,
    sample.gmc_product_category,
  ]
    .map((value) => typeof value === "string" ? value : "")
    .filter(Boolean)
    .join(" ");
}

function scoreEntry(entry: GoogleProductTaxonomyEntry, tokens: Set<string>, fullText: string): number {
  let score = 0;
  const pathTokens = tokenize(`${entry.name} ${entry.path}`);
  for (const token of tokens) {
    if (pathTokens.has(token)) score += 2;
    if (entry.keywords.includes(token)) score += 5;
  }
  if (fullText.includes(entry.name.toLowerCase())) score += 10;
  for (const keyword of entry.keywords) {
    if (keyword.includes(" ") && fullText.includes(keyword)) score += 8;
  }
  if (entry.id === DEFAULT_LEGO_GOOGLE_PRODUCT_CATEGORY_ID && /\blego\b|\bbrick|\bset\b|\bbuilding\b/.test(fullText)) score += 10;
  if (entry.id === "6058" && /\bmini[- ]?fig|\bfigure|\bcharacter/.test(fullText)) score += 12;
  if (entry.id === "3589" && /\bstar wars\b|\bspace\b|\bship\b/.test(fullText)) score += 4;
  return score;
}

export function selectGoogleProductTaxonomyCandidates(input: {
  prompt?: unknown;
  productSamples?: Record<string, unknown>[];
  limit?: number;
}): GoogleProductTaxonomyCandidate[] {
  const productText = (input.productSamples ?? []).map(textFromProductSample).join(" ");
  const fullText = `${clean(input.prompt)} ${productText.toLowerCase()}`.trim();
  const tokens = tokenize(fullText);
  const limit = Math.max(1, Math.min(Number(input.limit ?? 16), 30));

  const candidates = GOOGLE_PRODUCT_TAXONOMY_ENTRIES
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      path: entry.path,
      score: scoreEntry(entry, tokens, fullText),
      source: "google-product-taxonomy" as const,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.id === DEFAULT_LEGO_GOOGLE_PRODUCT_CATEGORY_ID) return -1;
      if (b.id === DEFAULT_LEGO_GOOGLE_PRODUCT_CATEGORY_ID) return 1;
      return a.path.localeCompare(b.path);
    });

  const selected = candidates.filter((candidate) => candidate.score > 0).slice(0, limit);
  if (!selected.some((candidate) => candidate.id === DEFAULT_LEGO_GOOGLE_PRODUCT_CATEGORY_ID)) {
    const fallback = candidates.find((candidate) => candidate.id === DEFAULT_LEGO_GOOGLE_PRODUCT_CATEGORY_ID);
    if (fallback) selected.unshift(fallback);
  }
  return selected.slice(0, limit);
}

export function normalizeGoogleProductCategoryValue(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const idMatch = raw.match(/\b\d{2,6}\b/);
  if (idMatch && GOOGLE_PRODUCT_TAXONOMY_ENTRIES.some((entry) => entry.id === idMatch[0])) {
    return idMatch[0];
  }
  const lower = raw.toLowerCase();
  const exact = GOOGLE_PRODUCT_TAXONOMY_ENTRIES.find((entry) =>
    entry.name.toLowerCase() === lower || entry.path.toLowerCase() === lower
  );
  return exact?.id ?? null;
}

export function normalizeGoogleProductCategoryTransformValues(transform: unknown): {
  transform: unknown;
  warnings: string[];
} {
  if (!transform || typeof transform !== "object" || Array.isArray(transform)) {
    return { transform, warnings: [] };
  }
  const source = transform as { rules?: unknown; default?: unknown };
  const warnings: string[] = [];
  const rules = Array.isArray(source.rules)
    ? source.rules.map((rule) => {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) return rule;
      const row = rule as { value?: unknown };
      const normalized = normalizeGoogleProductCategoryValue(row.value);
      if (!normalized && typeof row.value === "string" && row.value.trim()) {
        warnings.push(`Unmatched Google product taxonomy value: ${row.value.trim()}`);
      }
      return { ...row, value: normalized ?? row.value };
    })
    : source.rules;
  const normalizedDefault = normalizeGoogleProductCategoryValue(source.default);
  if (!normalizedDefault && typeof source.default === "string" && source.default.trim()) {
    warnings.push(`Unmatched Google product taxonomy default: ${source.default.trim()}`);
  }
  return {
    transform: { ...source, rules, default: normalizedDefault ?? source.default },
    warnings,
  };
}
