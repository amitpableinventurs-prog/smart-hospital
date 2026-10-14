import type { Metadata } from "next";
import { BarcodeLabels } from "@/components/inventory/BarcodeLabels";

export const metadata: Metadata = { title: "Barcode labels" };

// Session-checked, per-user data: allowed to block (see (app)/layout.tsx).
export const instant = false;

/** ?items=id,id (item labels) or ?doc=<GRN id> (batch labels). */
export default async function BarcodeLabelsPage({ searchParams }: PageProps<"/inventory/barcodes">) {
  const sp = await searchParams;
  return <BarcodeLabels items={typeof sp.items === "string" ? sp.items : undefined} doc={typeof sp.doc === "string" ? sp.doc : undefined} />;
}
