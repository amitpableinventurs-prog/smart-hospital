import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: { default: "Super Admin", template: "%s · Super Admin · MediCare" } };

export default async function SuperAdminLayout({ children }: LayoutProps<"/super-admin">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "super_admin") redirect("/dashboard");
  return children;
}
