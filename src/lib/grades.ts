export const GRADE_LABELS: Record<string, string> = {
  "1": "Mint",
  "2": "Excellent",
  "3": "Good",
  "4": "Acceptable",
  "5": "Fair",
};

export const GRADE_DETAILS: Record<string, { label: string; desc: string }> = {
  "1": { label: "Mint", desc: "Box and contents in near-perfect condition. No visible damage, creasing, or shelf wear." },
  "2": { label: "Excellent", desc: "Minor shelf wear or light marks. Contents complete and in great condition." },
  "3": { label: "Good", desc: "Noticeable wear, minor creasing, or small marks. Contents complete." },
  "4": { label: "Acceptable", desc: "Significant wear, dents or tears. All pieces present but box shows heavy use." },
  "5": { label: "Fair", desc: "Heavy wear or damage. May have missing non-essential items." },
};

export const GRADE_OPTIONS = [
  { value: null, label: "All" },
  { value: "1", label: "1 — Mint" },
  { value: "2", label: "2 — Excellent" },
  { value: "3", label: "3 — Good" },
  { value: "4", label: "4 — Acceptable" },
] as const;

export const GRADE_LABELS_NUMERIC: Record<number, string> = {
  1: "Mint", 2: "Excellent", 3: "Good", 4: "Acceptable", 5: "Fair",
};
