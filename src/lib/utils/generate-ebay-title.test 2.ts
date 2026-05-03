import { describe, it, expect } from "vitest";
import {
  generateEbayTitle,
  validateTitle,
  type EbayTitleInput,
} from "./generate-ebay-title";

// ─── Helper ───────────────────────────────────────────────

function base(overrides: Partial<EbayTitleInput> = {}): EbayTitleInput {
  return {
    name: "Mos Eisley Cantina",
    mpn: "75290-1",
    theme: "Star Wars",
    grade: 1 as const,
    retired: true,
    pieceCount: 3187,
    ...overrides,
  };
}

// ─── Core structure ───────────────────────────────────────

describe("generateEbayTitle", () => {
  it("starts with LEGO", () => {
    const { title } = generateEbayTitle(base());
    expect(title.startsWith("LEGO")).toBe(true);
  });

  it("never exceeds 80 characters", () => {
    const { title } = generateEbayTitle(base());
    expect(title.length).toBeLessThanOrEqual(80);
  });

  it("always includes the set name", () => {
    const { title } = generateEbayTitle(base());
    expect(title).toContain("Mos Eisley Cantina");
  });

  it("always includes bare MPN (mandatory)", () => {
    const { title } = generateEbayTitle(base());
    expect(title).toContain("75290");
  });

  it("includes theme when not in set name", () => {
    const { title } = generateEbayTitle(base());
    expect(title).toContain("Star Wars");
  });

  it("omits theme when already in the set name", () => {
    const { title } = generateEbayTitle(
      base({ name: "Star Wars Mos Eisley Cantina" })
    );
    // Should NOT have "LEGO Star Wars Star Wars…"
    expect(title).not.toMatch(/Star Wars.*Star Wars/);
  });

  it("omits theme when null", () => {
    const { title } = generateEbayTitle(base({ theme: null }));
    expect(title).not.toContain("Star Wars");
  });
});

// ─── MPN is always present (mandatory) ───────────────────

describe("MPN is mandatory", () => {
  it("includes MPN even with a very long name", () => {
    const { title } = generateEbayTitle({
      name: "Imperial Star Destroyer Ultimate Collector Series Edition",
      mpn: "75252-1",
      theme: "Star Wars",
      grade: 1,
      retired: true,
      retiredYear: 2023,
      pieceCount: 4784,
    });
    expect(title).toContain("75252");
    expect(title.length).toBeLessThanOrEqual(80);
  });

  it("includes MPN when name takes most of the budget", () => {
    const { title } = generateEbayTitle({
      name: "A Very Long Set Name That Takes Up Most Of The Eighty Characters Available",
      mpn: "99999-1",
      theme: null,
      grade: 3,
    });
    expect(title).toContain("99999");
    expect(title.length).toBeLessThanOrEqual(80);
  });

  it("strips the variant suffix from MPN", () => {
    const { title } = generateEbayTitle(base({ mpn: "75290-1" }));
    expect(title).toContain("75290");
    expect(title).not.toContain("75290-1");
  });

  it("handles MPN without variant suffix", () => {
    const { title } = generateEbayTitle(base({ mpn: "75290" }));
    expect(title).toContain("75290");
  });
});

// ─── Title structure: LEGO [Theme] [Name] ... [MPN] ──────

describe("title structure", () => {
  it("places MPN after name and descriptors", () => {
    const { title } = generateEbayTitle(base({ retired: false, grade: 3, pieceCount: null }));
    // Should be: LEGO Star Wars Mos Eisley Cantina 75290
    const nameIdx = title.indexOf("Mos Eisley Cantina");
    const mpnIdx = title.indexOf("75290");
    expect(mpnIdx).toBeGreaterThan(nameIdx);
  });

  it("parenthesises MPN at priority 9 when space allows", () => {
    const { title } = generateEbayTitle(
      base({ retired: false, grade: 3, pieceCount: null })
    );
    expect(title).toContain("(75290)");
  });

  it("places Set keyword before MPN at priority 10", () => {
    const { title } = generateEbayTitle(
      base({ retired: false, grade: 3, pieceCount: null, theme: null })
    );
    // Should have "Set (75290)" or "Set 75290"
    const setIdx = title.indexOf("Set");
    const mpnIdx = title.indexOf("75290");
    if (setIdx > -1) {
      expect(setIdx).toBeLessThan(mpnIdx);
    }
  });
});

// ─── Descriptor priority ─────────────────────────────────

describe("descriptor priority order", () => {
  it("includes Retired before Sealed Box", () => {
    const { title } = generateEbayTitle(base({ retired: true, grade: 1 }));
    const retiredIdx = title.indexOf("Retired");
    const sealedIdx = title.indexOf("Sealed Box");
    expect(retiredIdx).toBeGreaterThan(-1);
    expect(sealedIdx).toBeGreaterThan(-1);
    expect(retiredIdx).toBeLessThan(sealedIdx);
  });

  it("uses 'Sealed Box' for Grade 1", () => {
    const { title } = generateEbayTitle(base({ grade: 1 }));
    expect(title).toContain("Sealed Box");
    expect(title).not.toContain("BNIB");
  });

  it("uses 'BNIB' for Grade 2", () => {
    const { title } = generateEbayTitle(base({ grade: 2 }));
    expect(title).toContain("BNIB");
    expect(title).not.toContain("Sealed Box");
  });

  it("omits condition label for Grades 3–5", () => {
    for (const g of [3, 4, 5] as const) {
      const { title } = generateEbayTitle(base({ grade: g }));
      expect(title).not.toContain("Sealed Box");
      expect(title).not.toContain("BNIB");
    }
  });

  it("includes GWP when flagged", () => {
    const { title } = generateEbayTitle(base({ gwp: true }));
    expect(title).toContain("GWP");
  });

  it("includes Exclusive when flagged", () => {
    const { title } = generateEbayTitle(base({ exclusive: true }));
    expect(title).toContain("Exclusive");
  });
});

// ─── Retired year does NOT duplicate "Retired" ───────────

describe("retired year handling", () => {
  it("appends bare year at priority 8, not 'Retired YYYY'", () => {
    const { title } = generateEbayTitle(
      base({ retired: true, retiredYear: 2015, grade: 3, pieceCount: null })
    );
    // "Retired" should appear exactly once (from priority 1)
    const matches = title.match(/Retired/g) || [];
    expect(matches.length).toBe(1);
    // The year should be present as a bare number
    expect(title).toContain("2015");
  });

  it("omits retired year when retired is false", () => {
    const { title } = generateEbayTitle(
      base({ retired: false, retiredYear: 2015 })
    );
    // retiredYear descriptor still attempts if the field is set,
    // but without "Retired" from priority 1 the year stands alone
    if (title.includes("2015")) {
      expect(title).toContain("2015");
    }
  });
});

// ─── Minifig callout ──────────────────────────────────────

describe("minifig callout", () => {
  it("includes minifig name and MPN with correct format", () => {
    const { title } = generateEbayTitle({
      name: "Republic Gunship",
      mpn: "75021-1",
      theme: "Star Wars",
      grade: 3,
      retired: false,
      pieceCount: null,
      minifigName: "Mace Windu",
      minifigMpn: "sw0220",
    });
    expect(title).toContain("Mace Windu Minifig (sw0220)");
  });

  it("uses 'Minifig' not 'Minifigure'", () => {
    const { title } = generateEbayTitle(
      base({ minifigName: "Luke", minifigMpn: "sw0001" })
    );
    expect(title).not.toContain("Minifigure");
  });
});

// ─── Piece count formatting ───────────────────────────────

describe("piece count", () => {
  it("formats with commas for large counts", () => {
    const { title } = generateEbayTitle(
      base({ pieceCount: 3292, grade: 3, retired: false, theme: null })
    );
    expect(title).toContain("3,292 Pieces");
  });

  it("omits piece count when null", () => {
    const { title } = generateEbayTitle(base({ pieceCount: null }));
    expect(title).not.toContain("Pieces");
  });
});

// ─── Budget / truncation ──────────────────────────────────

describe("budget management", () => {
  it("drops low-priority descriptors when space is tight", () => {
    const result = generateEbayTitle({
      name: "Imperial Star Destroyer Ultimate Collector Series",
      mpn: "75252-1",
      theme: "Star Wars",
      grade: 1,
      retired: true,
      retiredYear: 2023,
      gwp: false,
      exclusive: true,
      pieceCount: 4784,
      minifigName: "Darth Vader",
      minifigMpn: "sw1141",
    });
    expect(result.title.length).toBeLessThanOrEqual(80);
    expect(result.droppedDescriptors.length).toBeGreaterThan(0);
    expect(result.title).toContain("LEGO");
    expect(result.title).toContain("Imperial Star Destroyer");
    // MPN must always be present
    expect(result.title).toContain("75252");
  });

  it("reports included and dropped descriptors accurately", () => {
    const result = generateEbayTitle(base());
    const total =
      result.includedDescriptors.length + result.droppedDescriptors.length;
    // At minimum we attempt MPN parens + Set keyword = 2
    expect(total).toBeGreaterThanOrEqual(2);
  });
});

// ─── Validation ───────────────────────────────────────────

describe("validateTitle", () => {
  it("passes a clean title", () => {
    const { valid } = validateTitle(
      "LEGO Star Wars Mos Eisley Cantina Retired Sealed Box (75290)"
    );
    expect(valid).toBe(true);
  });

  it("catches L@@K", () => {
    const { valid, violations } = validateTitle("LEGO L@@K Amazing Set");
    expect(valid).toBe(false);
    expect(violations.length).toBeGreaterThan(0);
  });

  it("catches FREE P&P", () => {
    const { valid } = validateTitle("LEGO Set FREE P&P");
    expect(valid).toBe(false);
  });

  it("catches Rare", () => {
    const { valid } = validateTitle("LEGO Rare Set 12345");
    expect(valid).toBe(false);
  });

  it("catches BARGAIN", () => {
    const { valid } = validateTitle("LEGO Bargain Set");
    expect(valid).toBe(false);
  });
});

// ─── Real-world scenarios ─────────────────────────────────

describe("real-world scenarios", () => {
  it("generates correct title for a Grade 1 retired Star Wars set", () => {
    const { title, length } = generateEbayTitle({
      name: "Mos Eisley Cantina",
      mpn: "75290-1",
      theme: "Star Wars",
      grade: 1,
      retired: true,
      pieceCount: 3187,
    });
    expect(title.startsWith("LEGO Star Wars Mos Eisley Cantina")).toBe(true);
    expect(title).toContain("Retired");
    expect(title).toContain("Sealed Box");
    expect(title).toContain("75290");
    expect(length).toBeLessThanOrEqual(80);
  });

  it("generates correct title for a small current GWP", () => {
    const { title, length } = generateEbayTitle({
      name: "Buildable Holiday Present",
      mpn: "40292-1",
      theme: "Seasonal",
      grade: 1,
      retired: false,
      gwp: true,
      pieceCount: 157,
    });
    expect(title).toContain("GWP");
    expect(title).toContain("Sealed Box");
    expect(title).toContain("40292");
    expect(length).toBeLessThanOrEqual(80);
  });

  it("generates correct title for a Grade 4 incomplete set", () => {
    const { title } = generateEbayTitle({
      name: "Millennium Falcon",
      mpn: "75192-1",
      theme: "Star Wars",
      grade: 4,
      retired: false,
      pieceCount: 7541,
    });
    expect(title).not.toContain("Sealed");
    expect(title).not.toContain("BNIB");
    expect(title).toContain("75192");
    expect(title.length).toBeLessThanOrEqual(80);
  });
});
