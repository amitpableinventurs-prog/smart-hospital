import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getSessionUser } from "@/lib/session";

// Every request re-checks the session against the database (deactivation and
// module changes apply immediately), so these routes intentionally block.
export const instant = false;

export default async function AuthenticatedLayout({ children }: LayoutProps<"/">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <AppShell user={user}>{children}</AppShell>;
}
