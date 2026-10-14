"use client";

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { qs } from "@/lib/client";
import { formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { Barcode } from "../Barcode";
import { Button, Card, EmptyState, ErrorState, Kbd, Spinner, cx, inputClass, useHotkeys } from "../ui";
import type { ItemHit } from "./DocForm";
import type { StockDocument } from "./types";

interface Label { key: string; name: string; code: string; mrp?: number | null; batchNo?: string; expiry?: string | null }

/** Printable 50 × 25 mm item / batch labels with Code 128 barcodes. */
export function BarcodeLabels({ items, doc }: { items?: string; doc?: string }) {
  const itemsQ = useApiQuery<ItemHit[]>(items ? `/api/inventory/items/search${qs({ ids: items })}` : null);
  const docQ = useApiQuery<StockDocument>(doc ? `/api/inventory/docs/${doc}` : null);
  const [copies, setCopies] = useState("1");
  useHotkeys({ "ctrl+p": () => window.print() });
  const q = doc ? docQ : itemsQ;

  if (!items && !doc) return <Card><EmptyState title="Nothing to print" description="Open labels from Stock Overview or a GRN." /></Card>;
  if (q.error) return <Card><ErrorState message={q.error} onRetry={q.reload} /></Card>;
  if (!q.data) return <Spinner label="Preparing labels…" />;

  const labels: Label[] = doc
    ? (docQ.data?.lines ?? []).map((l) => ({ key: l.id, name: l.itemName, code: l.sku ?? l.itemName, mrp: l.mrp, batchNo: l.batchNo !== "NA" ? l.batchNo : undefined, expiry: l.expiryDate }))
    : (itemsQ.data ?? []).map((i) => ({ key: i.id, name: i.name, code: i.barcode || i.sku, mrp: i.mrp }));
  const n = Math.min(100, Math.max(1, Number(copies) || 1));

  return (
    <>
      <style>{"@media print { @page { size: 50mm 25mm; margin: 0 } .inv-label { page-break-after: always; box-shadow: none !important; border: 0 !important } }"}</style>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        {doc ? <Link href={`/inventory/docs/${doc}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Back to {docQ.data?.code}</Link> : <span className="text-sm text-slate-500">Item barcode labels</span>}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">Copies each <input value={copies} onChange={(e) => setCopies(e.target.value.replace(/\D/g, ""))} className={cx(inputClass, "w-16 py-1")} /></label>
          <Button onClick={() => window.print()}><Printer className="size-4" /> Print <Kbd>Ctrl+P</Kbd></Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 print:block">
        {labels.flatMap((l) => Array.from({ length: n }, (_, i) => (
          <div key={`${l.key}-${i}`} className="inv-label flex h-[25mm] w-[50mm] flex-col justify-between overflow-hidden rounded border border-slate-300 bg-white px-[2mm] py-[1.2mm] text-black shadow-sm">
            <div className="truncate text-[7.5pt] font-bold leading-tight">{l.name}</div>
            <Barcode value={l.code} height={30} className="h-[9mm] w-full" />
            <div className="flex justify-between text-[7pt] leading-tight"><span className="font-mono font-bold">{l.code}</span>{l.mrp ? <span>MRP {formatMoney(l.mrp)}</span> : null}</div>
            {(l.batchNo || l.expiry) && (
              <div className="flex justify-between text-[6.5pt] leading-tight">
                <span>{l.batchNo ? `B: ${l.batchNo}` : ""}</span>
                <span>{l.expiry ? `Exp ${new Date(l.expiry).toLocaleDateString("en-IN", { month: "2-digit", year: "2-digit", timeZone: "UTC" })}` : ""}</span>
              </div>
            )}
          </div>
        )))}
      </div>
    </>
  );
}
