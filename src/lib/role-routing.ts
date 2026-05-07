export type AppRole = "student" | "educator" | "admin" | "sub_admin" | null;
export type ApprovalStatus = "pending" | "approved" | "rejected" | null;

export function getLandingPath(role: AppRole): string {
  switch (role) {
    case "admin":
    case "educator":
      return "/dashboard";
    case "sub_admin":
      return "/sub-admin";
    case "student":
    default:
      return "/subjects";
  }
}

export function getLandingPathForProfile(input: {
  role: AppRole;
  approval_status?: ApprovalStatus;
  requested_role?: string | null;
}): string {
  if (
    input.approval_status === "pending" &&
    input.requested_role === "educator"
  ) {
    return "/pending-approval";
  }
  return getLandingPath(input.role);
}

