import type { Metadata } from "next";
import { ModuleGate } from "@/components/ModuleGate";

export const metadata: Metadata = { title: { default: "Pharmacy", template: "%s · Pharmacy · MediCare" } };

// Session-checked, per-user data: allowed to block (see (app)/layout.tsx).
export const instant = false;

export default function PharmacyLayout({ children }: LayoutProps<"/pharmacy">) {
  return <ModuleGate module="pharmacy">{children}</ModuleGate>;
}
