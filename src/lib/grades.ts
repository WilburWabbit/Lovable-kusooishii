export const GRADE_LABELS: Record<string, string> = {
  "1": "Gold Standard",
  "2": "Silver Lining",
  "3": "Bronze Age",
  "4": "Black Sheep",
  "5": "Red Card",
};

export const GRADE_DETAILS: Record<string, { label: string; shortDesc: string; longDesc: string; icon: string }> = {
  "1": {
    label: "Gold Standard",
    shortDesc: "Factory sealed. Flawless or near-flawless box. The real deal.",
    longDesc: "This is the one collectors dream about. Factory sealed, untouched, box in mint or near-mint condition with only minor shelf wear. Loose minifigs at this grade are complete — every accessory present — and in excellent cosmetic condition. If LEGO® packed it yesterday, you wouldn't know the difference. We guarantee it.",
    icon: "/grade-1-gold.png",
  },
  "2": {
    label: "Silver Lining",
    shortDesc: "Sealed box, cosmetic damage. Complete inside.",
    longDesc: "Still sealed, still complete — the box just took a knock somewhere along the way. Dented corners, minor scuffs, the kind of wear that happens between the factory and your shelf. Everything inside is untouched. Minifigs at this grade are in great condition but may be missing a utensil, weapon, or accessory. You're buying the set, not the packaging — and the set is spot on.",
    icon: "/grade-2-silver.png",
  },
  "3": {
    label: "Bronze Age",
    shortDesc: "Opened or heavily damaged box. Complete but lived-in.",
    longDesc: "These sets have been out in the world. Either the box has been opened, or it's sealed but the packaging has taken a proper beating. The bricks are all there, but the minifigs have had a tough life and they look it — scuffs, wear, the telltale signs of a set that's been loved hard. Everything's accounted for. We guarantee completeness, and we photograph every blemish.",
    icon: "/grade-3-bronze.png",
  },
  "4": {
    label: "Black Sheep",
    shortDesc: "Opened or pre-built. Missing key items. Fully disclosed.",
    longDesc: "The set's been opened, possibly built, and it's missing something that matters — minifigs, original instructions, or the extras you'd expect in a new box. But every brick that should be there, is there. We list exactly what's included, what's missing, and what condition it's all in. No surprises. You know precisely what you're getting, and the price reflects it.",
    icon: "/grade-4-black.png",
  },
  "5": {
    label: "Red Card",
    shortDesc: "Parts only. Rarely listed. Internal use.",
    longDesc: "A box of parts — sometimes not even the box. These sets have been stripped, donated to, or arrived incomplete beyond redemption. We don't usually sell them as sets, but individual parts, minifigs, or bulk pieces may appear on the site, graded separately. If you see a Grade 5 listing, it's because something in there is worth rescuing.",
    icon: "/grade-5-red.png",
  },
};

export const GRADE_OPTIONS = [
  { value: null, label: "All" },
  { value: "1", label: "1 — Gold Standard" },
  { value: "2", label: "2 — Silver Lining" },
  { value: "3", label: "3 — Bronze Age" },
  { value: "4", label: "4 — Black Sheep" },
] as const;

export const GRADE_LABELS_NUMERIC: Record<number, string> = {
  1: "Gold Standard", 2: "Silver Lining", 3: "Bronze Age", 4: "Black Sheep", 5: "Red Card",
};

export const GRADE_ICONS: Record<string, string> = {
  "1": "/grade-1-gold.png",
  "2": "/grade-2-silver.png",
  "3": "/grade-3-bronze.png",
  "4": "/grade-4-black.png",
  "5": "/grade-5-red.png",
};
