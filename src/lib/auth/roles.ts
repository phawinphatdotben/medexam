/** Roles that may open the staff dashboard shell. */
export const STAFF_DASHBOARD_ROLES = ["admin", "educator", "sub_admin"] as const;

/** Roles allowed to grade MEQ submissions. */
export const GRADING_ROLES = STAFF_DASHBOARD_ROLES;

/** Seasonal test-assignment authoring (migration 020). */
export const TEST_ASSIGNMENT_ROLES = ["admin", "sub_admin"] as const;

/** Exclusive admin tooling. */
export const ADMIN_ONLY_ROLES = ["admin"] as const;

/** Exam review committee page (subset of staff). */
export const COMMITTEE_PAGE_ROLES = ["admin", "sub_admin", "educator"] as const;

/** Live proctor log for assigned real tests. */
export const EXAM_MONITOR_ROLES = STAFF_DASHBOARD_ROLES;

export function isRoleAllowed(
  role: string | null | undefined,
  allowed: readonly string[],
): role is string {
  return !!role && (allowed as readonly string[]).includes(role);
}
