import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BrandTheme } from "@/components/BrandTheme";
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
  if (licence.locked) {
    return (
      <>
        <BrandTheme color={licence.brand.color} />
        <LicenceLock licence={licence} user={{ name: user.name, email: user.email, role: user.role }} />
      </>
    );
  }
  return (
    <>
      <BrandTheme color={licence.brand.color} />
      <AppShell user={user} deployment={{ mode: licence.mode, hospitalName: licence.hospitalName, brand: licence.brand }}>
        <LicenceBanner licence={licence} canRenew={user.role === "super_admin"} />
        {children}
      </AppShell>
    </>
  );
}
