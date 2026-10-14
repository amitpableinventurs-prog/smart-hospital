import type { Metadata } from "next";
import { ModuleGate } from "@/components/ModuleGate";

export const metadata: Metadata = { title: { default: "Insurance", template: "%s · Insurance · MediCare" } };

// Session-checked, per-user data: allowed to block (see (app)/layout.tsx).
export const instant = false;

export default function InsuranceLayout({ children }: LayoutProps<"/insurance">) {
  return <ModuleGate module="insurance">{children}</ModuleGate>;
}
