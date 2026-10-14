import type { Metadata } from "next";
import { ModuleGate } from "@/components/ModuleGate";

export const metadata: Metadata = { title: { default: "Laboratory", template: "%s · Laboratory · MediCare" } };

// Session-checked, per-user data: allowed to block (see (app)/layout.tsx).
export const instant = false;

export default function LaboratoryLayout({ children }: LayoutProps<"/laboratory">) {
  return <ModuleGate module="laboratory">{children}</ModuleGate>;
}
