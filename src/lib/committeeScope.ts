/** Aligns with DB enum `committee_purpose` on tests + committees (incl. practice). */

export type CommitteePurpose = "practice" | "formative" | "summative";

export function committeePurposeLabel(p: CommitteePurpose): string {
  if (p === "practice") return "Practice";
  if (p === "formative") return "Formative (real low-stakes)";
  return "Summative (real high-stakes)";
}

export function committeeScopesMatchTest(params: {
  committeeCourseCode: string;
  committeeYear: number;
  committeePurpose: CommitteePurpose;
  testCourseCode: string;
  testYear: number;
  testFunction: "practice" | "real_test";
  assessmentPurpose: "formative" | "summative";
}): boolean {
  const codeOk =
    params.committeeCourseCode.trim().toUpperCase() === params.testCourseCode.trim().toUpperCase() &&
    params.committeeYear === params.testYear;

  const purposeOk =
    (params.committeePurpose === "practice" && params.testFunction === "practice") ||
    (params.committeePurpose === "formative" &&
      params.testFunction === "real_test" &&
      params.assessmentPurpose === "formative") ||
    (params.committeePurpose === "summative" &&
      params.testFunction === "real_test" &&
      params.assessmentPurpose === "summative");

  return codeOk && purposeOk;
}
