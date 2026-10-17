"use client";

import { Package, Plus, Search, Stethoscope, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { hospitalBill, r2 } from "@/lib/billing-math";
import { api, qs } from "@/lib/client";
import { formatMoney } from "@/lib/format";
import { DOCTOR_FEE_TYPES, GST_RATES, SERVICE_CATEGORIES } from "@/lib/modules";
import { RefSelect } from "../RecordForm";
import { Alert, Badge, Button, cx, inputClass, useDebounced } from "../ui";

/** A charge being composed in the browser. The server re-prices everything from the masters. */
export type DraftLine = { key: string; name: string; detail?: string; category: string; qty: string; rate: string; discountPct: string; gstRate: number; rateEditable: boolean } & (
  | { kind: "service"; service: string; baseRate: number }
  | { kind: "package"; package: string }
  | { kind: "doctor"; doctor: string; feeType: string }
  | { kind: "manual" }
);

interface CatalogService { id: string; name: string; code: string; category: string; unit: string; rate: number; gstRate: number; editable: boolean }
interface CatalogPackage { id: string; name: string; code: string; rate: number; gstRate: number; billType: string | null; services: string[] }
interface DoctorFees { doctor: { id: string; name: string; code: string; specialization: string; status: string; fees: Record<string, number | null> } }

const doctorRef = { name: "doctor", label: "Doctor", type: "ref" as const, ref: "doctors.doctors" };
let seq = 0;
const nextKey = () => `l${++seq}`;

/** Same billing head the server assigns to a doctor fee. */
function feeCategory(feeType: string) {
  if (feeType === "Emergency") return "Emergency";
  if (["Surgeon", "Assistant Surgeon", "Anaesthetist"].includes(feeType)) return "Surgery / OT";
  if (feeType === "Procedure") return "Procedure";
  return "Consultation";
}

/** Payload for POST /api/billing/bills `lines` and the "add-lines" action. */
export function linesPayload(lines: DraftLine[]) {
  return lines.map((l) => {
    const qty = Number(l.qty) || 1;
    const discountPct = Number(l.discountPct) || 0;
    switch (l.kind) {
      case "service":
        return { kind: "service", service: l.service, qty, discountPct, rate: l.rateEditable && Number(l.rate) !== l.baseRate ? Number(l.rate) : undefined, detail: l.detail };
      case "package":
        return { kind: "package", package: l.package };
      case "doctor":
        return { kind: "doctor", doctor: l.doctor, feeType: l.feeType, qty, discountPct, rate: l.rateEditable ? Number(l.rate) : undefined, detail: l.detail };
      default:
        return { kind: "manual", name: l.name, category: l.category, rate: Number(l.rate), gstRate: l.gstRate, qty, discountPct, detail: l.detail };
    }
  });
}

/** Live preview of the charges, using the same arithmetic as the server. */
export function previewTotals(lines: DraftLine[], billDiscount = 0) {
  return hospitalBill(lines.map((l) => ({ qty: Number(l.qty) || 0, rate: Number(l.rate) || 0, discountPct: Number(l.discountPct) || 0, gstRate: l.gstRate })), billDiscount);
}

/**
 * Search the service / package catalog, add doctor fees and manual charges, and
 * edit quantities, rates (where the master allows) and line discounts.
 */
export function ChargePicker({ lines, onChange, plan, billType, stayDays, error }: { lines: DraftLine[]; onChange: (lines: DraftLine[]) => void; plan: string; billType: string; stayDays?: number | null; error?: string }) {
  const [q, setQ] = useState("");
  const debounced = useDebounced(q, 250);
  const [results, setResults] = useState<{ services: CatalogService[]; packages: CatalogPackage[] } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"doctor" | "manual" | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    api<{ services: CatalogService[]; packages: CatalogPackage[] }>(`/api/billing/catalog${qs({ q: debounced, plan })}`, { signal: ctrl.signal })
      .then(({ data }) => {
        setResults(data);
        setSearchError(null);
      })
      .catch((e) => (e as Error).name !== "AbortError" && setSearchError((e as Error).message));
    return () => ctrl.abort();
  }, [debounced, plan, open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const add = (l: DraftLine) => {
    onChange([...lines, l]);
    setQ("");
    setOpen(false);
  };
  const addService = (s: CatalogService) => {
    // Per-day charges on an IPD bill default to the length of stay.
    const qty = s.unit === "Per day" && billType === "IPD" && stayDays ? String(stayDays) : "1";
    add({ key: nextKey(), kind: "service", service: s.id, name: s.name, detail: undefined, category: s.category, qty, rate: String(s.rate), baseRate: s.rate, discountPct: "", gstRate: s.gstRate, rateEditable: s.editable });
  };
  const addPackage = (p: CatalogPackage) =>
    add({ key: nextKey(), kind: "package", package: p.id, name: p.name, detail: p.services.length ? `Includes: ${p.services.join(", ")}` : undefined, category: "Package", qty: "1", rate: String(p.rate), discountPct: "", gstRate: p.gstRate, rateEditable: false });
  const update = (key: string, patch: Partial<DraftLine>) => onChange(lines.map((l) => (l.key === key ? ({ ...l, ...patch } as DraftLine) : l)));

  const preview = previewTotals(lines);
  const packages = (results?.packages ?? []).filter((p) => !p.billType || p.billType === billType);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div ref={wrap} className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search services & packages by name or code…" className={cx(inputClass, "pl-9")} aria-label="Search services and packages" />
          {open && (
            <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200">
              {searchError ? <p className="px-3 py-2 text-red-600">{searchError}</p> : !results ? <p className="px-3 py-2 text-slate-500">Searching…</p> : results.services.length + packages.length === 0 ? (
                <p className="px-3 py-2 text-slate-500">No active service or package matches. Add it under Masters → Service Master, or use a manual charge.</p>
              ) : (
                <>
                  {results.services.map((s) => (
                    <button key={s.id} type="button" onClick={() => addService(s)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-brand-50">
                      <span><span className="text-slate-900">{s.name}</span> <span className="font-mono text-xs text-slate-500">{s.code}</span><span className="block text-xs text-slate-500">{s.category} · {s.unit}{s.gstRate ? ` · GST ${s.gstRate}%` : ""}</span></span>
                      <span className="shrink-0 tabular-nums text-slate-700">{formatMoney(s.rate)}</span>
                    </button>
                  ))}
                  {packages.map((p) => (
                    <button key={p.id} type="button" onClick={() => addPackage(p)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-brand-50">
                      <span><Package className="mr-1 inline size-3.5 text-violet-600" /><span className="text-slate-900">{p.name}</span> <span className="font-mono text-xs text-slate-500">{p.code}</span><span className="block truncate text-xs text-slate-500">Package{p.services.length ? ` · ${p.services.join(", ")}` : ""}</span></span>
                      <span className="shrink-0 tabular-nums text-slate-700">{formatMoney(p.rate)}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
        <Button type="button" variant="secondary" onClick={() => setMode(mode === "doctor" ? null : "doctor")}><Stethoscope className="size-4" /> Doctor fee</Button>
        <Button type="button" variant="secondary" onClick={() => setMode(mode === "manual" ? null : "manual")}><Plus className="size-4" /> Manual charge</Button>
      </div>

      {mode === "doctor" && <DoctorFeeRow billType={billType} onAdd={(l) => { add(l); setMode(null); }} onCancel={() => setMode(null)} />}
      {mode === "manual" && <ManualRow onAdd={(l) => { add(l); setMode(null); }} onCancel={() => setMode(null)} />}
      {error && <Alert>{error}</Alert>}

      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">No charges yet. Search the catalog, or add a doctor fee or a manual charge.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-2">Charge</th><th className="w-20 py-2 pr-2">Qty</th><th className="w-28 py-2 pr-2">Rate</th><th className="w-20 py-2 pr-2">Disc %</th><th className="py-2 pr-2 text-right">Amount</th><th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l, i) => (
                <tr key={l.key}>
                  <td className="py-2 pr-2">
                    <span className="text-slate-900">{l.name}</span> <Badge tone={l.kind === "package" ? "violet" : l.kind === "manual" ? "amber" : "slate"}>{l.category}</Badge>
                    {l.detail && <span className="block max-w-md truncate text-xs text-slate-500" title={l.detail}>{l.detail}</span>}
                  </td>
                  <td className="py-2 pr-2"><input type="number" min={0.01} step="any" value={l.qty} disabled={l.kind === "package"} onChange={(e) => update(l.key, { qty: e.target.value })} className={cx(inputClass, "px-2 py-1")} aria-label={`${l.name} quantity`} /></td>
                  <td className="py-2 pr-2"><input type="number" min={0} step="any" value={l.rate} disabled={!l.rateEditable} onChange={(e) => update(l.key, { rate: e.target.value })} className={cx(inputClass, "px-2 py-1")} aria-label={`${l.name} rate`} title={l.rateEditable ? undefined : "Rate is fixed by the masters"} /></td>
                  <td className="py-2 pr-2"><input type="number" min={0} max={100} step="any" value={l.discountPct} disabled={l.kind === "package"} onChange={(e) => update(l.key, { discountPct: e.target.value })} className={cx(inputClass, "px-2 py-1")} aria-label={`${l.name} discount`} /></td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatMoney(preview.lines[i]?.amount ?? 0)}{l.gstRate > 0 && <span className="block text-xs text-slate-500">incl. GST {l.gstRate}%</span>}</td>
                  <td className="py-2 text-right"><button type="button" onClick={() => onChange(lines.filter((x) => x.key !== l.key))} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${l.name}`}><Trash2 className="size-4" /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-medium"><td className="py-2" colSpan={4}>{lines.length} charge(s){preview.totals.discountAmount > 0 ? ` · discount ${formatMoney(preview.totals.discountAmount)}` : ""}{preview.totals.gstAmount > 0 ? ` · GST ${formatMoney(preview.totals.gstAmount)}` : ""}</td><td className="py-2 pr-2 text-right tabular-nums">{formatMoney(r2(preview.totals.taxableAmount + preview.totals.gstAmount))}</td><td /></tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function DoctorFeeRow({ billType, onAdd, onCancel }: { billType: string; onAdd: (l: DraftLine) => void; onCancel: () => void }) {
  const [doctor, setDoctor] = useState("");
  const [feeType, setFeeType] = useState(billType === "IPD" ? "IPD Visit" : billType === "Emergency" ? "Emergency" : "Consultation");
  const [fees, setFees] = useState<DoctorFees["doctor"] | null>(null);
  const [rate, setRate] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!doctor) return;
    const ctrl = new AbortController();
    api<DoctorFees>(`/api/billing/catalog${qs({ doctor })}`, { signal: ctrl.signal })
      .then(({ data }) => setFees(data.doctor))
      .catch((e) => (e as Error).name !== "AbortError" && setErr((e as Error).message));
    return () => ctrl.abort();
  }, [doctor]);

  const fixed = fees && fees.id === doctor ? fees.fees[feeType] : null;
  function addFee() {
    if (!doctor || !fees) return setErr("Select the doctor");
    const r = fixed ?? Number(rate);
    if (!(r > 0)) return setErr(`Enter the ${feeType.toLowerCase()} fee`);
    onAdd({ key: nextKey(), kind: "doctor", doctor, feeType, name: `${feeType} fee — ${fees.name}`, category: feeCategory(feeType), qty: "1", rate: String(r), discountPct: "", gstRate: 0, rateEditable: fixed == null });
  }
  return (
    <div className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-[1fr_12rem_9rem_auto]">
      <RefSelect id="fee-doctor" field={doctorRef} value={doctor} onChange={(v) => { setDoctor(v); setErr(null); }} className={inputClass} />
      <select value={feeType} onChange={(e) => setFeeType(e.target.value)} className={inputClass} aria-label="Fee type">
        {DOCTOR_FEE_TYPES.map((t) => <option key={t}>{t}</option>)}
      </select>
      {fixed != null ? <p className="self-center text-sm tabular-nums text-slate-700">{formatMoney(fixed)} <span className="text-xs text-slate-500">(doctor master)</span></p> : (
        <input type="number" min={0} step="any" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Fee" className={inputClass} aria-label="Fee" />
      )}
      <div className="flex gap-2">
        <Button type="button" onClick={addFee}>Add</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      {err && <p className="text-xs text-red-600 sm:col-span-4">{err}</p>}
    </div>
  );
}

function ManualRow({ onAdd, onCancel }: { onAdd: (l: DraftLine) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Other");
  const [rate, setRate] = useState("");
  const [gstRate, setGstRate] = useState("0");
  const [err, setErr] = useState<string | null>(null);
  function addCharge() {
    if (name.trim().length < 3) return setErr("Describe the charge");
    if (!(Number(rate) > 0)) return setErr("Enter the rate");
    onAdd({ key: nextKey(), kind: "manual", name: name.trim(), category, qty: "1", rate, discountPct: "", gstRate: Number(gstRate), rateEditable: true });
  }
  return (
    <div className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-[1fr_12rem_8rem_6rem_auto]">
      <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Description, e.g. Dressing charges" className={inputClass} aria-label="Charge description" autoFocus />
      <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass} aria-label="Billing head">
        {SERVICE_CATEGORIES.filter((c) => c !== "Package").map((c) => <option key={c}>{c}</option>)}
      </select>
      <input type="number" min={0} step="any" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Rate" className={inputClass} aria-label="Rate" />
      <select value={gstRate} onChange={(e) => setGstRate(e.target.value)} className={inputClass} aria-label="GST %">
        {GST_RATES.map((g) => <option key={g} value={g}>GST {g}%</option>)}
      </select>
      <div className="flex gap-2">
        <Button type="button" onClick={addCharge}>Add</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      {err && <p className="text-xs text-red-600 sm:col-span-5">{err}</p>}
    </div>
  );
}
