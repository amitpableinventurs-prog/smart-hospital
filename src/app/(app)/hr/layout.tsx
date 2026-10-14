import type { Metadata } from "next";
import { ModuleGate } from "@/components/ModuleGate";

export const metadata: Metadata = { title: { default: "Human Resources", template: "%s · Human Resources · MediCare" } };

// Session-checked, per-user data: allowed to block (see (app)/layout.tsx).
export const instant = false;

export default function HumanResourcesLayout({ children }: LayoutProps<"/hr">) {
  return <ModuleGate module="hr">{children}</ModuleGate>;
}
