import type { Metadata } from "next";
import { ModuleGate } from "@/components/ModuleGate";

export const metadata: Metadata = { title: { default: "Billing", template: "%s · Billing · MediCare" } };

// Session-checked, per-user data: allowed to block (see (app)/layout.tsx).
export const instant = false;

export default function BillingLayout({ children }: LayoutProps<"/billing">) {
  return <ModuleGate module="billing">{children}</ModuleGate>;
}
