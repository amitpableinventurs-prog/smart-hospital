import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";

// Every request re-checks the session against the database (deactivation and
// module changes apply immediately), so these routes intentionally block.
export const instant = false;

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  redirect(user.role === "super_admin" ? "/super-admin" : "/dashboard");
}
