import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { MODULE_MAP, type ModuleKey } from "@/lib/modules";
import { canAccess, getSessionUser } from "@/lib/session";
import { AccessDenied } from "./AccessDenied";

/** Server-side guard for bespoke module pages (Patients, Pharmacy, Reports). */
export async function ModuleGate({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canAccess(user, module)) return <AccessDenied moduleLabel={MODULE_MAP[module].label} />;
  return children;
}
