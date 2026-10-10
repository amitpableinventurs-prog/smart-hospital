import type { Metadata } from "next";
import { ModuleGate } from "@/components/ModuleGate";

export const metadata: Metadata = { title: "Reports" };

// Session-checked, per-user data: allowed to block (see (app)/layout.tsx).
export const instant = false;

export default function ReportsLayout({ children }: LayoutProps<"/reports">) {
  return <ModuleGate module="reports">{children}</ModuleGate>;
}
