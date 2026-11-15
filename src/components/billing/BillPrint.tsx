"use client";

import { ArrowLeft, ImageOff, Image as ImageIcon, Printer, Settings2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BILL_TEMPLATES, DEFAULT_PRINT_SETTINGS, type BillPrintSettings, type BillTemplate, type PrintHospital } from "@/lib/bill-print";
import { useApiQuery } from "@/lib/useApi";
import { Button, Card, EmptyState, ErrorState, Kbd, Spinner, cx, useHotkeys } from "../ui";
import { BillDocument } from "./BillTemplates";
import type { Bill } from "./types";

/** Print-ready hospital bill in the saved template; the template and logo can be switched for this print only. */
export function BillPrint({ id }: { id: string }) {
  const q = useApiQuery<Bill>(`/api/billing/bills/${id}`);
  const ps = useApiQuery<{ settings: BillPrintSettings; hospital: PrintHospital }>("/api/billing/print-settings");
  const b = q.data;
  const saved = ps.data?.settings;
  const [template, setTemplate] = useState<BillTemplate | null>(null);
  const [hideLogo, setHideLogo] = useState(false);
  useHotkeys({ "ctrl+p": () => window.print() });
  useEffect(() => {
    if (b) document.title = `Bill ${b.code} - ${b.patientName}`;
  }, [b]);

  if (q.error) return <Card className="mx-auto max-w-xl">{q.status === 404 ? <EmptyState title="Bill not found" description={q.error} /> : <ErrorState message={q.error} onRetry={q.reload} />}</Card>;
  // Print settings failing to load should never block printing: fall back to the defaults.
  if (!b || (ps.loading && !ps.data)) return <Spinner label="Loading…" />;

  const base = saved ?? DEFAULT_PRINT_SETTINGS;
  const settings: BillPrintSettings = { ...base, template: template ?? base.template, logo: hideLogo ? "none" : base.logo };
  const hasLogo = base.logo !== "none";

  return (
    <>
      <div className="mx-auto mb-4 flex max-w-4xl flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/billing/bills/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Back to bill</Link>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Template" className="inline-flex rounded-lg bg-slate-100 p-1">
            {BILL_TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={settings.template === t.key}
                title={t.description}
                onClick={() => setTemplate(t.key)}
                className={cx("rounded-md px-3 py-1.5 text-sm font-medium transition-colors", settings.template === t.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}
              >
                {t.label}
              </button>
            ))}
          </div>
          {hasLogo && (
            <Button variant="secondary" onClick={() => setHideLogo((x) => !x)} aria-pressed={!hideLogo} title={hideLogo ? "Show the logo on this print" : "Print without the logo (pre-printed letterhead)"}>
              {hideLogo ? <ImageOff className="size-4" /> : <ImageIcon className="size-4" />} {hideLogo ? "Logo off" : "Logo on"}
            </Button>
          )}
          <Link href="/m/billing?tab=print_settings" title="Templates, logo and letterhead"><Button variant="ghost"><Settings2 className="size-4" /> Customise</Button></Link>
          <Button onClick={() => window.print()}><Printer className="size-4" /> Print / PDF <Kbd>Ctrl+P</Kbd></Button>
        </div>
      </div>
      <BillDocument bill={b} settings={settings} />
    </>
  );
}
