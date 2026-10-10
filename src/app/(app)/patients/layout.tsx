import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccessDenied } from "@/components/AccessDenied";
import { canAccess, getSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "Patients" };

export default async function PatientsLayout({ children }: LayoutProps<"/patients">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canAccess(user, "patients")) return <AccessDenied moduleLabel="Patients" />;
  return children;
}
