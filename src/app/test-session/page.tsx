import { redirect } from "next/navigation";

/** @deprecated Prefer /test-taking */
export default function TestSessionLegacyRedirectPage() {
  redirect("/test-taking");
}
