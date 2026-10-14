import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocForm } from "@/components/inventory/DocForm";
import { isDocType } from "@/lib/inventory-docs";

export const metadata: Metadata = { title: "New stock document" };

// Session-checked, per-user data: allowed to block (see (app)/layout.tsx).
export const instant = false;

export default async function NewStockDocPage({ searchParams }: PageProps<"/inventory/docs/new">) {
  const sp = await searchParams;
  const type = typeof sp.type === "string" ? sp.type : "";
  if (!isDocType(type)) notFound();
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const params = { po: pick("po"), requisition: pick("requisition"), against: pick("against"), reservation: pick("reservation"), items: pick("items") };
  // Remount when the linked document changes (e.g. after looking up a return's source).
  return <DocForm key={`${type}-${params.against ?? ""}-${params.po ?? ""}`} type={type} params={params} />;
}
