"use client";

import { ArrowLeft, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { saleLine, saleTotals } from "@/lib/billing-math";
import { ApiClientError, api } from "@/lib/client";
import { formatDate, formatMoney } from "@/lib/format";
import { PAYMENT_MODES } from "@/lib/modules";
import { RefSelect, type RefOption } from "../RecordForm";
import { Alert, Button, Card, Kbd, cx, inputClass, useHotkeys, useToast } from "../ui";
import { ItemSearch, type StockBatch, type StockItem } from "./ItemSearch";

interface Line {
  key: string;
  itemId: string;
  itemName: string;
  batchId: string;
  batchNo: string;
  expiryDate: string | null;
  available: number;
  mrp: number;
  gstRate: number;
  qty: string;
  discountPct: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const cell = "w-full rounded border-0 bg-transparent px-1.5 py-1 text-right tabular-nums ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-brand-500";

export function SaleBillForm({ initialPatient }: { initialPatient?: RefOption & { phone?: string } }) {
  const router = useRouter();
  const toast = useToast();
  const [billDate, setBillDate] = useState(today);
  const [patient, setPatient] = useState(initialPatient?.id ?? "");
  const [customerName, setCustomerName] = useState(initialPatient?.label ?? "");
  const [customerPhone, setCustomerPhone] = useState(initialPatient?.phone ?? "");
  const [doctor, setDoctor] = useState("");
  const [paymentMode, setPaymentMode] = useState<string>("Cash");
  const [paid, setPaid] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef(new Map<string, HTMLInputElement>());
  const discRefs = useRef(new Map<string, HTMLInputElement>());

  const computed = useMemo(
    () => lines.map((l) => saleLine({ qty: Math.max(0, Number(l.qty) || 0), mrp: l.mrp, discountPct: Math.min(100, Math.max(0, Number(l.discountPct) || 0)), gstRate: l.gstRate })),
    [lines]
  );
  const totals = saleTotals(computed);
  const paidValue = paid === "" ? (paymentMode === "Credit" ? 0 : totals.netAmount) : Number(paid) || 0;
  const balance = Math.max(0, totals.netAmount - paidValue);

  function addLine(item: StockItem, batch?: StockBatch) {
    if (!batch) return;
    const existing = lines.find((l) => l.batchId === batch.id);
    if (existing) {
      setLines((ls) => ls.map((l) => (l.key === existing.key ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l)));
      setTimeout(() => qtyRefs.current.get(existing.key)?.select(), 0);
      return;
    }
    const key = `${batch.id}-${Date.now()}`;
    setLines((ls) => [
      ...ls,
      { key, itemId: item.id, itemName: item.name, batchId: batch.id, batchNo: batch.batchNo, expiryDate: batch.expiryDate, available: batch.quantity, mrp: batch.mrp, gstRate: batch.gstRate, qty: "1", discountPct: "0" },
    ]);
    setTimeout(() => qtyRefs.current.get(key)?.select(), 0);
  }

  function update(key: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function reset() {
    if (lines.length && !window.confirm("Discard this bill and start a new one?")) return;
    setLines([]);
    setPatient("");
    setCustomerName("");
    setCustomerPhone("");
    setDoctor("");
    setPaymentMode("Cash");
    setPaid("");
    setNotes("");
    setErrors({});
    setFormError(null);
    setBillDate(today());
    searchRef.current?.focus();
  }

  async function save() {
    if (saving) return;
    setFormError(null);
    const errs: Record<string, string> = {};
    if (!customerName.trim() && !patient) errs.customerName = "Enter the customer name or select a patient";
    if (lines.length === 0) errs.items = "Add at least one item (F3 to search)";
    lines.forEach((l, i) => {
      const q = Number(l.qty);
      if (!Number.isInteger(q) || q < 1) errs[`items.${i}`] = "Quantity must be a whole number ≥ 1";
      else if (q > l.available) errs[`items.${i}`] = `Only ${l.available} in stock`;
    });
    if (paidValue < 0 || paidValue > totals.netAmount) errs.paidAmount = `Paid must be between 0 and ${totals.netAmount}`;
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError("Please correct the highlighted fields.");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api<{ id: string; code: string }>("/api/pharmacy/sales", {
        method: "POST",
        body: {
          billDate, patient: patient || undefined, customerName, customerPhone, doctor: doctor || undefined, paymentMode,
          paidAmount: paidValue, notes, items: lines.map((l) => ({ batch: l.batchId, qty: Number(l.qty), discountPct: Number(l.discountPct) || 0 })),
        },
      });
      toast(`Bill ${data.code} saved — stock updated`);
      router.push(`/pharmacy/sales/${data.id}`);
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) setErrors(err.fields);
      setFormError((err as Error).message);
      setSaving(false);
    }
  }

  useHotkeys({
    F2: reset,
    F3: () => searchRef.current?.focus(),
    F4: () => customerRef.current?.focus(),
    F10: save,
    "ctrl+s": save,
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/pharmacy" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Back to pharmacy">
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">New Sale Bill</h1>
            <p className="text-xs text-slate-500">MRP is GST-inclusive · batches are suggested earliest-expiry first</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={reset} disabled={saving}>New <Kbd>F2</Kbd></Button>
          <Button onClick={save} loading={saving}>Save bill <Kbd>F10</Kbd></Button>
        </div>
      </div>

      {formError && <div className="mb-4"><Alert>{formError}{errors.items && !errors.items.startsWith("Add") ? ` ${errors.items}` : ""}</Alert></div>}

      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <label className="text-xs font-medium text-slate-600">
            Bill date
            <input type="date" value={billDate} max={today()} onChange={(e) => setBillDate(e.target.value)} className={cx(inputClass, "mt-1")} />
          </label>
          <div className="text-xs font-medium text-slate-600 lg:col-span-2">
            Patient <span className="font-normal text-slate-400">(optional — links bill to patient record)</span>
            <div className="mt-1">
              <RefSelect
                id="sale-patient"
                field={{ name: "patient", label: "Patient", type: "ref", ref: "patients.patients" }}
                value={patient}
                initial={initialPatient}
                onChange={setPatient}
                onPick={(o) => {
                  if (o) {
                    setCustomerName(o.label);
                    if (o.sub) setCustomerPhone(o.sub);
                  }
                }}
                className={inputClass}
              />
            </div>
          </div>
          <label className="text-xs font-medium text-slate-600">
            Customer name <Kbd className="ml-1">F4</Kbd>
            <input ref={customerRef} value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={120} className={cx(inputClass, "mt-1", errors.customerName && "ring-red-400")} />
            {errors.customerName && <span className="mt-0.5 block font-normal text-red-600">{errors.customerName}</span>}
          </label>
          <label className="text-xs font-medium text-slate-600">
            Phone
            <input type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className={cx(inputClass, "mt-1", errors.customerPhone && "ring-red-400")} />
            {errors.customerPhone && <span className="mt-0.5 block font-normal text-red-600">{errors.customerPhone}</span>}
          </label>
          <div className="text-xs font-medium text-slate-600">
            Prescribed by
            <div className="mt-1">
              <RefSelect id="sale-doctor" field={{ name: "doctor", label: "Doctor", type: "ref", ref: "doctors.doctors" }} value={doctor} onChange={setDoctor} className={inputClass} />
            </div>
          </div>
        </div>
      </Card>

      <Card className="mb-4">
        <div className="border-b border-slate-100 p-3">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <ItemSearch mode="sale" onPick={addLine} inputRef={searchRef} placeholder="F3 · Search medicine by name / code, ↑↓ to pick batch, Enter to add" />
            </div>
          </div>
          {errors.items && <p className="mt-1 text-xs text-red-600">{errors.items}</p>}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-8 px-2 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">Item</th>
                <th className="px-2 py-2 text-left">Batch</th>
                <th className="px-2 py-2 text-left">Expiry</th>
                <th className="px-2 py-2 text-right">Avl</th>
                <th className="w-20 px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">MRP</th>
                <th className="w-20 px-2 py-2 text-right">Disc %</th>
                <th className="px-2 py-2 text-right">GST %</th>
                <th className="px-2 py-2 text-right">Amount</th>
                <th className="w-8 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-10 text-center text-sm text-slate-400">
                    No items yet. Press <Kbd>F3</Kbd> and start typing a medicine name.
                  </td>
                </tr>
              )}
              {lines.map((l, i) => {
                const err = errors[`items.${i}`];
                return (
                  <tr key={l.key} className={cx(err && "bg-red-50")}>
                    <td className="px-2 py-1.5 text-xs text-slate-400">{i + 1}</td>
                    <td className="px-2 py-1.5">
                      <span className="font-medium text-slate-900">{l.itemName}</span>
                      {err && <span className="block text-xs text-red-600">{err}</span>}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-xs text-slate-600">{l.batchNo}</td>
                    <td className="px-2 py-1.5 text-xs text-slate-600">{formatDate(l.expiryDate)}</td>
                    <td className="px-2 py-1.5 text-right text-xs tabular-nums text-slate-500">{l.available}</td>
                    <td className="px-2 py-1">
                      <input
                        ref={(el) => { if (el) qtyRefs.current.set(l.key, el); else qtyRefs.current.delete(l.key); }}
                        inputMode="numeric"
                        value={l.qty}
                        onChange={(e) => update(l.key, { qty: e.target.value.replace(/[^0-9]/g, "") })}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); discRefs.current.get(l.key)?.select(); } }}
                        className={cx(cell, Number(l.qty) > l.available && "ring-red-400")}
                        aria-label={`Quantity for ${l.itemName}`}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{l.mrp.toFixed(2)}</td>
                    <td className="px-2 py-1">
                      <input
                        ref={(el) => { if (el) discRefs.current.set(l.key, el); else discRefs.current.delete(l.key); }}
                        inputMode="decimal"
                        value={l.discountPct}
                        onChange={(e) => update(l.key, { discountPct: e.target.value.replace(/[^0-9.]/g, "") })}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchRef.current?.focus(); } }}
                        className={cell}
                        aria-label={`Discount for ${l.itemName}`}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{l.gstRate}</td>
                    <td className="px-2 py-1.5 text-right font-medium tabular-nums text-slate-900">{computed[i].amount.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${l.itemName}`}>
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium text-slate-600">
              Payment mode
              <select value={paymentMode} onChange={(e) => { setPaymentMode(e.target.value); setPaid(""); }} className={cx(inputClass, "mt-1")}>
                {PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Amount received
              <input inputMode="decimal" value={paid === "" ? String(paidValue) : paid} onChange={(e) => setPaid(e.target.value.replace(/[^0-9.]/g, ""))} className={cx(inputClass, "mt-1 tabular-nums", errors.paidAmount && "ring-red-400")} />
              {errors.paidAmount && <span className="mt-0.5 block font-normal text-red-600">{errors.paidAmount}</span>}
            </label>
            <div className="text-xs font-medium text-slate-600">
              Balance due
              <p className={cx("mt-1 rounded-lg px-3 py-2 text-sm font-semibold tabular-nums", balance > 0 ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-700")}>{formatMoney(balance)}</p>
            </div>
            <label className="text-xs font-medium text-slate-600 sm:col-span-3">
              Notes
              <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className={cx(inputClass, "mt-1")} />
            </label>
          </div>
        </Card>
        <Card className="p-4">
          <dl className="space-y-1.5 text-sm tabular-nums">
            <Row label="Gross (MRP × qty)" value={totals.grossTotal} />
            <Row label="Discount" value={-totals.discountTotal} />
            <Row label="Taxable value" value={totals.taxableTotal} muted />
            <Row label="CGST" value={totals.gstTotal / 2} muted />
            <Row label="SGST" value={totals.gstTotal / 2} muted />
            <Row label="Round off" value={totals.roundOff} muted />
            <div className="flex items-baseline justify-between border-t border-slate-200 pt-2">
              <dt className="font-semibold text-slate-900">Net payable</dt>
              <dd className="text-2xl font-bold text-slate-900">{formatMoney(totals.netAmount)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-slate-800 px-4 py-2 text-xs text-slate-200">
        <span><Kbd>F2</Kbd> New bill</span>
        <span><Kbd>F3</Kbd> Item search</span>
        <span><Kbd>F4</Kbd> Customer</span>
        <span><Kbd>↑↓</Kbd> Pick batch</span>
        <span><Kbd>Enter</Kbd> Add / next field</span>
        <span><Kbd>F10</Kbd> / <Kbd>Ctrl+S</Kbd> Save</span>
      </div>
    </>
  );
}

function Row({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className={muted ? "text-slate-500" : "text-slate-700"}>{label}</dt>
      <dd className={muted ? "text-slate-500" : "text-slate-900"}>{value.toFixed(2)}</dd>
    </div>
  );
}
