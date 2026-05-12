/** Stored on `meq_stage_items.task_category` — must match DB check constraint. */
export const MEQ_TASK_CATEGORY_SLUGS = [
  "problem_identification",
  "hypothesis_generation",
  "data_gathering",
  "data_interpretation",
  "clinical_reasoning",
  "patient_management",
  "patient_education_counseling",
  "ethics_jurisprudences",
  "evidence_based_medicine_biostatistics",
  "basic_knowledge",
] as const;

export type MeqTaskCategorySlug = (typeof MEQ_TASK_CATEGORY_SLUGS)[number];

export const MEQ_TASK_CATEGORIES: { slug: MeqTaskCategorySlug; label: string }[] = [
  { slug: "problem_identification", label: "1. Problem Identification" },
  { slug: "hypothesis_generation", label: "2. Hypothesis Generation" },
  { slug: "data_gathering", label: "3. Data Gathering" },
  { slug: "data_interpretation", label: "4. Data Interpretation" },
  { slug: "clinical_reasoning", label: "5. Clinical Reasoning" },
  { slug: "patient_management", label: "6. Patient Management" },
  { slug: "patient_education_counseling", label: "7. Patient Education/Counseling" },
  { slug: "ethics_jurisprudences", label: "8. Ethics/Jurisprudences" },
  { slug: "evidence_based_medicine_biostatistics", label: "9. Evidence-based medicine/Biostatistics" },
  { slug: "basic_knowledge", label: "10. Basic knowledge" },
];

const SLUG_SET = new Set<string>(MEQ_TASK_CATEGORY_SLUGS);

export function isMeqTaskCategorySlug(v: string): v is MeqTaskCategorySlug {
  return SLUG_SET.has(v);
}

/** Accepts DB slug (any case) or leading category number 1–10 from CSV; returns null if unknown. */
export function parseMeqTaskCategorySlug(raw: string): MeqTaskCategorySlug | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (isMeqTaskCategorySlug(t)) return t;
  const digit = /^(\d{1,2})\b/.exec(t);
  if (digit) {
    const n = parseInt(digit[1]!, 10);
    if (n >= 1 && n <= 10) return MEQ_TASK_CATEGORY_SLUGS[n - 1]!;
  }
  return null;
}

export const DEFAULT_MEQ_TASK_CATEGORY: MeqTaskCategorySlug = "problem_identification";
