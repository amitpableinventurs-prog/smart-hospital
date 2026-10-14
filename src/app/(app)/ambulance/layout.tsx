import type { Metadata } from "next";
import { ModuleGate } from "@/components/ModuleGate";

export const metadata: Metadata = { title: { default: "Ambulance", template: "%s · Ambulance · MediCare" } };

// Session-checked, per-user data: allowed to block (see (app)/layout.tsx).
export const instant = false;

export default function AmbulanceLayout({ children }: LayoutProps<"/ambulance">) {
  return <ModuleGate module="ambulance">{children}</ModuleGate>;
}
