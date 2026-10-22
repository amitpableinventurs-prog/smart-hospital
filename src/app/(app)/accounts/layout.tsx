import type { Metadata } from "next";
import { ModuleGate } from "@/components/ModuleGate";

export const metadata: Metadata = { title: { default: "Accounts", template: "%s · Accounts · MediCare" } };

// Session-checked, per-user data: allowed to block (see (app)/layout.tsx).
export const instant = false;

export default function AccountsLayout({ children }: LayoutProps<"/accounts">) {
  return <ModuleGate module="accounts">{children}</ModuleGate>;
}
