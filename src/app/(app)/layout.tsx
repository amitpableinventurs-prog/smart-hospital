import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { LicenceBanner, LicenceLock } from "@/components/LicenceLock";
import { licenceView } from "@/lib/licence";
import { getSessionUser } from "@/lib/session";

// Every request re-checks the session against the database (deactivation and
// module changes apply immediately), so these routes intentionally block.
export const instant = false;

export default async function AuthenticatedLayout({ children }: LayoutProps<"/">) {
  const licence = await licenceView();
  if (licence.locked?.reason === "not_activated") redirect("/setup");
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Suspended, expired or offline too long: nothing but the lock screen until the licence is good again.
  if (licence.locked) return <LicenceLock licence={licence} user={{ name: user.name, email: user.email, role: user.role }} />;
  return (
    <AppShell user={user} deployment={{ mode: licence.mode, hospitalName: licence.hospitalName }}>
      <LicenceBanner licence={licence} />
      {children}
    </AppShell>
  );
}
