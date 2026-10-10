import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AccessDenied } from "@/components/AccessDenied";
import { getModule, moduleHref } from "@/lib/modules";
import { canAccess, getSessionUser } from "@/lib/session";
import { ModulePanel } from "./ModulePanel";

export async function generateMetadata({ params }: PageProps<"/m/[module]">): Promise<Metadata> {
  return { title: getModule((await params).module)?.label ?? "Module" };
}

export default async function ModulePage({ params, searchParams }: PageProps<"/m/[module]">) {
  const { module: key } = await params;
  const mod = getModule(key);
  if (!mod) notFound();
  if (mod.custom) redirect(moduleHref(mod.key));

  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canAccess(user, mod.key)) return <AccessDenied moduleLabel={mod.label} />;

  const { tab } = await searchParams;
  return <ModulePanel moduleKey={mod.key} initialTab={typeof tab === "string" ? tab : undefined} />;
}
