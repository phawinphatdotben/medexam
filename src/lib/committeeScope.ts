/** Aligns with DB enum `committee_purpose` on tests + committees. */

export type CommitteePurpose = "formative" | "summative";

export function committeeScopesMatchTest(params: {
  committeeCourseCode: string;
  committeeYear: number;
  committeePurpose: CommitteePurpose;
  testCourseCode: string;
  testYear: number;
  testFunction: "practice" | "real_test";
  assessmentPurpose: CommitteePurpose;
}): boolean {
  const codeOk =
    params.committeeCourseCode.trim().toUpperCase() === params.testCourseCode.trim().toUpperCase() &&
    params.committeeYear === params.testYear;

  const purposeOk =
    (params.committeePurpose === "formative" &&
      (params.testFunction === "practice" ||
        (params.testFunction === "real_test" && params.assessmentPurpose === "formative"))) ||
    (params.committeePurpose === "summative" &&
      params.testFunction === "real_test" &&
      params.assessmentPurpose === "summative");

  return codeOk && purposeOk;
}
