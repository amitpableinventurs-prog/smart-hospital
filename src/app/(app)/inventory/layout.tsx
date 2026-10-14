import type { Metadata } from "next";
import { ModuleGate } from "@/components/ModuleGate";

export const metadata: Metadata = { title: { default: "Inventory", template: "%s · Inventory · MediCare" } };

// Session-checked, per-user data: allowed to block (see (app)/layout.tsx).
export const instant = false;

export default function InventoryLayout({ children }: LayoutProps<"/inventory">) {
  return <ModuleGate module="inventory">{children}</ModuleGate>;
}
