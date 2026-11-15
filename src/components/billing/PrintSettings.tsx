"use client";

import { Check, ImagePlus, RotateCcw, X } from "lucide-react";
import { useRef, useState } from "react";
import {
  ACCENT_SWATCHES,
  BILL_TEMPLATES,
  DEFAULT_PRINT_SETTINGS,
  LOGO_MODES,
  LOGO_SIZES,
  MAX_PRINT_LOGO,
  PAPER_SIZES,
  type BillPrintSettings,
  type BillTemplate,
  type PrintHospital,
} from "@/lib/bill-print";
import { api } from "@/lib/client";
import { formatDateTime } from "@/lib/format";
import { resizeLogo } from "@/lib/resize-logo";
import { useApiQuery } from "@/lib/useApi";
import { Alert, Button, Card, CardHeader, ErrorState, Field, Spinner, cx, inputClass, omitKey, useToast } from "../ui";
import { BillDocument } from "./BillTemplates";
import type { Bill } from "./types";

interface Data {
  settings: BillPrintSettings;
  hospital: PrintHospital;
  updatedByName: string | null;
  updatedAt: string | null;
}

/** Billing → Bill Print Templates: template, colour, logo and letterhead text, with a live preview. */
export function PrintSettings() {
  const q = useApiQuery<Data>("/api/billing/print-settings");
  if (q.loading && !q.data) return <Spinner label="Loading print settings…" />;
  if (q.error || !q.data) return <Card><ErrorState message={q.error ?? "Could not load"} onRetry={q.reload} /></Card>;
  return <PrintSettingsForm key={q.data.updatedAt ?? "new"} data={q.data} reload={q.reload} />;
}

function PrintSettingsForm({ data, reload }: { data: Data; reload: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<BillPrintSettings>(data.settings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof BillPrintSettings>(k: K, value: BillPrintSettings[K]) => {
    setV((s) => ({ ...s, [k]: value }));
    if (errors[k]) setErrors((x) => omitKey(x, k));
  };
  const dirty = JSON.stringify(v) !== JSON.stringify(data.settings);

  async function pick(file?: File) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setErrors((x) => ({ ...x, customLogo: "Choose a PNG, JPEG or WebP image" }));
    try {
      const logo = await resizeLogo(file, 480, MAX_PRINT_LOGO);
      if (logo.length > MAX_PRINT_LOGO) return setErrors((x) => ({ ...x, customLogo: "This image is too large even after resizing" }));
      setV((s) => ({ ...s, customLogo: logo, logo: "custom" }));
      setErrors((x) => omitKey(x, "customLogo"));
    } catch {
      setErrors((x) => ({ ...x, customLogo: "This image could not be read" }));
    }
  }

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      await api("/api/billing/print-settings", { method: "PUT", body: v });
      toast("Bill print template saved");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
      const f = (e as { fields?: Record<string, string> }).fields;
      if (f) setErrors(f);
    } finally {
      setBusy(false);
    }
  }

  const sample = sampleBill(data.hospital);
  const brandingLogo = !!data.hospital.logo;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card>
          <CardHeader title="Template" description="Used for every bill print; can be switched on the print page for one print." />
          <div className="grid gap-2 p-5 pt-0 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            {BILL_TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => set("template", t.key)}
                aria-pressed={v.template === t.key}
                className={cx(
                  "group relative flex items-center gap-3 rounded-xl p-3 text-left ring-1 transition 2xl:flex-col 2xl:items-start",
                  v.template === t.key ? "bg-brand-50 ring-2 ring-brand-500" : "ring-slate-200 hover:ring-slate-300"
                )}
              >
                <TemplateThumb template={t.key} accent={v.accent} />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{t.label}</span>
                  <span className="block text-xs text-slate-500">{t.description}</span>
                </span>
                {v.template === t.key && <Check className="absolute right-2 top-2 size-4 text-brand-600" />}
              </button>
            ))}
          </div>
          <div className="grid gap-4 border-t border-slate-100 p-5 sm:grid-cols-2">
            <Field label="Accent colour" htmlFor="ps-accent" required error={errors.accent}>
              <div className="flex flex-wrap items-center gap-1.5">
                {ACCENT_SWATCHES.map((c) => (
                  <button key={c} type="button" onClick={() => set("accent", c)} aria-label={`Colour ${c}`} className={cx("size-7 rounded-full ring-offset-2 transition", v.accent.toLowerCase() === c ? "ring-2 ring-slate-900" : "hover:scale-110")} style={{ background: c }} />
                ))}
                <input id="ps-accent" type="color" value={v.accent} onChange={(e) => set("accent", e.target.value)} className="size-7 cursor-pointer rounded-full border-0 bg-transparent p-0" title="Custom colour" />
              </div>
            </Field>
            <Field label="Paper size" htmlFor="ps-paper" required hint={v.template === "compact" ? "Thermal prints are always 80 mm wide" : undefined}>
              <Segmented id="ps-paper" value={v.template === "compact" ? "" : v.paper} disabled={v.template === "compact"} options={PAPER_SIZES.map((p) => ({ key: p, label: p }))} onChange={(p) => set("paper", p)} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Logo" description="Print the hospital logo, a separate logo just for bills, or none (for pre-printed letterhead)." />
          <div className="space-y-4 p-5 pt-0">
            <div className="grid gap-2 sm:grid-cols-3">
              {LOGO_MODES.map((m) => (
                <label key={m.key} className={cx("flex cursor-pointer flex-col rounded-lg p-3 ring-1 transition", v.logo === m.key ? "bg-brand-50 ring-2 ring-brand-500" : "ring-slate-200 hover:ring-slate-300")}>
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                    <input type="radio" name="ps-logo" value={m.key} checked={v.logo === m.key} onChange={() => set("logo", m.key)} className="text-brand-600 focus:ring-brand-500" />
                    {m.label}
                  </span>
                  <span className="mt-0.5 text-xs text-slate-500">{m.key === "branding" && !brandingLogo ? "No hospital logo is set yet" : m.description}</span>
                </label>
              ))}
            </div>
            {v.logo === "custom" && (
              <Field label="Custom logo" htmlFor="ps-logo-file" required error={errors.customLogo} hint="PNG with a transparent background looks best; resized to 480 px">
                <div className="flex items-center gap-3">
                  <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:12px_12px] ring-1 ring-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
                    {v.customLogo ? <img src={v.customLogo} alt="Custom logo" className="max-h-full max-w-full object-contain p-1" /> : <ImagePlus className="size-6 text-slate-300" />}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => fileRef.current?.click()}><ImagePlus className="size-4" /> {v.customLogo ? "Change" : "Upload"}</Button>
                    {v.customLogo && <Button variant="ghost" onClick={() => set("customLogo", null)} aria-label="Remove custom logo"><X className="size-4" /></Button>}
                  </div>
                  <input id="ps-logo-file" ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
                </div>
              </Field>
            )}
            {v.logo !== "none" && (
              <Field label="Logo size" htmlFor="ps-logo-size" required>
                <Segmented id="ps-logo-size" value={v.logoSize} options={LOGO_SIZES} onChange={(x) => set("logoSize", x)} />
              </Field>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Letterhead & text" description={`Name, address, phone and GSTIN come from the hospital's branding${data.hospital.name ? ` (${data.hospital.name})` : ""}.`} />
          <div className="space-y-4 p-5 pt-0">
            <Field label="Line under the name" htmlFor="ps-note" error={errors.headerNote} hint="e.g. NABH accredited · 24×7 emergency & trauma care">
              <input id="ps-note" value={v.headerNote} maxLength={120} onChange={(e) => set("headerNote", e.target.value)} className={inputClass} />
            </Field>
            <Field label="Terms & conditions" htmlFor="ps-terms" error={errors.terms} hint="One per line; printed as a numbered list">
              <textarea id="ps-terms" rows={4} value={v.terms} maxLength={800} onChange={(e) => set("terms", e.target.value)} className={inputClass} placeholder={"Bills once paid are not refundable.\nPlease keep this bill for insurance claims."} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Footer" htmlFor="ps-footer" error={errors.footer} hint={data.hospital.footer ? `Blank uses “${data.hospital.footer}”` : "e.g. Thank you. Get well soon."}>
                <input id="ps-footer" value={v.footer} maxLength={200} onChange={(e) => set("footer", e.target.value)} className={inputClass} />
              </Field>
              <Field label="Signature label" htmlFor="ps-sign" error={errors.signatureLabel}>
                <input id="ps-sign" value={v.signatureLabel} maxLength={60} onChange={(e) => set("signatureLabel", e.target.value)} className={inputClass} placeholder="Authorised signatory" />
              </Field>
            </div>
            <div className="space-y-2">
              <Toggle checked={v.showReceipts} onChange={(x) => set("showReceipts", x)} label="Show payments received" hint="Receipt numbers, modes and dates under the charges" />
              <Toggle checked={v.showStamp} onChange={(x) => set("showStamp", x)} label="Show status stamp" hint="PAID, PART PAID, PROVISIONAL or CANCELLED beside the total" />
            </div>
          </div>
        </Card>

        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl bg-white/95 p-3 shadow-lg ring-1 ring-slate-200 backdrop-blur">
          <p className="text-xs text-slate-500">{dirty ? "Unsaved changes" : data.updatedAt ? `Saved ${formatDateTime(data.updatedAt)}${data.updatedByName ? ` by ${data.updatedByName}` : ""}` : "Using the default template"}</p>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" onClick={() => setV({ ...DEFAULT_PRINT_SETTINGS, customLogo: v.customLogo })} title="Back to the default template (keeps an uploaded logo)"><RotateCcw className="size-4" /> Defaults</Button>
            <Button onClick={save} loading={busy} disabled={!dirty} className="whitespace-nowrap">Save template</Button>
          </div>
        </div>
      </div>

      <Card className="xl:sticky xl:top-20 xl:self-start">
        <CardHeader title="Live preview" description="A sample bill in the template above. Open any bill and choose Print to print it." />
        <div className="max-h-[calc(100vh-11rem)] overflow-auto bg-slate-100 p-4">
          {v.logo === "branding" && !brandingLogo && <div className="mb-3"><Alert tone="amber">No hospital logo is set in branding, so the bill prints without one. Choose “Custom logo” to upload one for bills.</Alert></div>}
          <div style={{ zoom: v.template === "compact" ? 1 : 0.7 }}>
            <BillDocument bill={sample} settings={v} />
          </div>
        </div>
      </Card>
    </div>
  );
}

function Segmented<T extends string>({ id, value, options, onChange, disabled }: { id: string; value: T | ""; options: readonly { key: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div id={id} role="radiogroup" className={cx("inline-flex rounded-lg bg-slate-100 p-1", disabled && "opacity-50")}>
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={value === o.key} disabled={disabled} onClick={() => onChange(o.key)} className={cx("rounded-md px-3 py-1 text-sm font-medium transition-colors", value === o.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cx("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-brand-600" : "bg-slate-300")}>
        <span className={cx("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", checked ? "left-[1.125rem]" : "left-0.5")} />
      </button>
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

/** Small schematic of each template for the picker. */
function TemplateThumb({ template, accent }: { template: BillTemplate; accent: string }) {
  const bar = "h-1 rounded-full bg-slate-200";
  if (template === "compact")
    return (
      <span className="flex h-16 w-12 shrink-0 flex-col items-center gap-1 rounded-md bg-white p-1.5 ring-1 ring-slate-200 2xl:w-full">
        <span className="h-1.5 w-6 rounded-full bg-slate-700" />
        <span className="w-full border-t border-dashed border-slate-300" />
        {[0, 1, 2, 3].map((i) => <span key={i} className={cx(bar, "w-full")} />)}
        <span className="h-1.5 w-full rounded-full bg-slate-700" />
      </span>
    );
  if (template === "classic")
    return (
      <span className="flex h-16 w-14 shrink-0 flex-col gap-1 rounded-md bg-white p-1.5 ring-1 ring-slate-200 2xl:w-full">
        <span className="mx-auto h-1.5 w-8 rounded-full" style={{ background: accent }} />
        <span className="border-y-2 border-double" style={{ borderColor: accent }} />
        <span className="grid flex-1 grid-cols-3 border border-slate-300">{[0, 1, 2].map((i) => <span key={i} className="border-r border-slate-300 last:border-0" />)}</span>
      </span>
    );
  return (
    <span className="flex h-16 w-14 shrink-0 flex-col gap-1 overflow-hidden rounded-md bg-white ring-1 ring-slate-200 2xl:w-full">
      <span className="h-1.5" style={{ background: accent }} />
      <span className="flex gap-1 px-1.5"><span className="size-2.5 rounded-sm" style={{ background: accent, opacity: 0.4 }} /><span className={cx(bar, "mt-0.5 flex-1")} /></span>
      <span className="mx-1.5 h-1.5 rounded-sm" style={{ background: accent }} />
      <span className={cx(bar, "mx-1.5")} />
      <span className="ml-auto mr-1.5 h-2 w-6 rounded-sm" style={{ background: accent }} />
    </span>
  );
}

/** A realistic IPD bill for the preview. */
function sampleBill(hospital: PrintHospital): Bill {
  const at = new Date().toISOString();
  const line = (id: string, category: string, name: string, qty: number, rate: number, discount = 0, detail?: string) => {
    const gross = qty * rate;
    return { id, kind: "Service" as const, category, name, detail, qty, rate, gross, discount, taxable: gross - discount, gst: 0, gstRate: 0, amount: gross - discount, status: "Active" as const };
  };
  const lines = [
    line("1", "Room Charges", "General Ward Bed Charges", 3, 1500, 0, "Ward A · Bed 12"),
    line("2", "Room Charges", "Nursing Charges", 3, 400),
    line("3", "Consultation", "Consultant Visit — Dr. A. Sharma", 3, 800, 300),
    line("4", "Laboratory", "Complete Blood Count (CBC)", 1, 350),
    line("5", "Laboratory", "Liver Function Test", 1, 650),
    line("6", "Pharmacy", "Medicines & consumables", 1, 2140.5),
  ];
  const gross = lines.reduce((s, l) => s + l.gross, 0);
  const discount = lines.reduce((s, l) => s + l.discount, 0);
  const net = Math.round(gross - discount);
  const roundOff = Math.round((net - (gross - discount)) * 100) / 100;
  const paid = 8000;
  return {
    id: "sample",
    code: "IPD-2026-00142",
    billDate: at.slice(0, 10) + "T00:00:00.000Z",
    billType: "IPD",
    patient: "p",
    patientName: "Ramesh Kumar",
    patientCode: "UHID-10234",
    patientAge: 46,
    patientGender: "Male",
    patientMobile: "98XXXXXX10",
    admissionCode: "ADM-0098",
    admissionDate: new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10) + "T00:00:00.000Z",
    wardBed: "General Ward · 12",
    doctorName: "Dr. A. Sharma",
    department: "General Medicine",
    ratePlan: "General",
    payerType: "Self",
    lines,
    grossAmount: gross,
    lineDiscount: discount,
    billDiscount: 0,
    discountAmount: discount,
    taxableAmount: gross - discount,
    gstAmount: 0,
    roundOff,
    netAmount: net,
    payerShare: 0,
    patientShare: net,
    movedToPatient: 0,
    patientPaid: paid,
    payerPaid: 0,
    payerWriteOff: 0,
    patientDue: net - paid,
    payerDue: 0,
    refundDue: 0,
    receipts: [
      { id: "r1", code: "RCP-0451", kind: "Advance", amount: 5000, splits: [{ id: "s1", mode: "Cash", amount: 5000, recon: "Not Required" }], at },
      { id: "r2", code: "RCP-0466", kind: "Payment", amount: 3000, splits: [{ id: "s2", mode: "UPI", amount: 3000, reference: "4123XXXX", recon: "Pending" }], at },
    ],
    status: "Final",
    paymentStatus: "Partially Paid",
    createdByName: "Front desk",
    createdAt: at,
    deptDues: [],
    hospital,
    stayDays: 3,
  };
}
