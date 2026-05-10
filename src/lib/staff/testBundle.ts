/** Matches tests created with Practice pool vs Real formative/summative on the bundle builder. */
export type BundleTrack = "practice" | "formative" | "summative";

export function rowMatchesBundleTrack(
  r: { test_function: string; assessment_purpose: string },
  tr: BundleTrack,
): boolean {
  if (tr === "practice") return r.test_function === "practice";
  if (tr === "formative")
    return r.test_function === "real_test" && r.assessment_purpose === "formative";
  return r.test_function === "real_test" && r.assessment_purpose === "summative";
}
