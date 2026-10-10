"use client";

import { ArrowLeft, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { purchaseLine, purchaseTotals } from "@/lib/billing-math";
import { ApiClientError, api } from "@/lib/client";
import { formatMoney } from "@/lib/format";
import { GST_RATES } from "@/lib/modules";
import { RefSelect } from "../RecordForm";
import { Alert, Button, Card, Kbd, cx, inputClass, useHotkeys, useToast } from "../ui";
import { ItemSearch, type StockItem } from "./ItemSearch";

interface Line {
  key: string;
  itemId: string;
  itemName: string;
  batchNo: string;
  expiry: string; // YYYY-MM
  qty: string;
  freeQty: string;
  purchaseRate: string;
  mrp: string;
  discountPct: string;
  gstRate: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const cell = "w-full rounded border-0 bg-transparent px-1.5 py-1 text-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-brand-500";
const n = (v: string) => Math.max(0, Number(v) || 0);

export function PurchaseForm() {
  const router = useRouter();
  const toast = useToast();
  const [supplier, setSupplier] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLTableSectionElement>(null);

  const computed = useMemo(
    () => lines.map((l) => purchaseLine({ qty: n(l.qty), purchaseRate: n(l.purchaseRate), discountPct: Math.min(100, n(l.discountPct)), gstRate: n(l.gstRate) })),
    [lines]
  );
  const totals = purchaseTotals(computed);

  function addLine(item: StockItem) {
    const key = `${item.id}-${Date.now()}`;
    setLines((ls) => [
      ...ls,
      {
        key, itemId: item.id, itemName: item.name, batchNo: "", expiry: "", qty: "", freeQty: "0",
        purchaseRate: item.lastRate != null ? String(item.lastRate) : "", mrp: item.mrp != null ? String(item.mrp) : "",
        discountPct: "0", gstRate: String(item.gstRate ?? 12),
      },
    ]);
    setTimeout(() => gridRef.current?.querySelector<HTMLInputElement>(`[data-row="${key}"]`)?.focus(), 0);
  }

  function update(key: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /** Enter moves to the next cell; from the last cell, back to item search. */
  function onGridKey(e: React.KeyboardEvent) {
    if (e.key !== "Enter" || !(e.target as HTMLElement).dataset.grid) return;
    e.preventDefault();
    const cells = Array.from(gridRef.current?.querySelectorAll<HTMLElement>("[data-grid]") ?? []);
    const next = cells[cells.indexOf(e.target as HTMLElement) + 1];
    if (next) next.focus();
    else searchRef.current?.focus();
  }

  async function save() {
    if (saving) return;
    setFormError(null);
    const errs: Record<string, string> = {};
    if (!supplier) errs.supplier = "Select a supplier";
    if (!invoiceNo.trim()) errs.supplierInvoiceNo = "Enter the supplier's invoice number";
    if (lines.length === 0) errs.items = "Add at least one item (F3 to search)";
    lines.forEach((l, i) => {
      if (!l.batchNo.trim()) errs[`items.${i}`] = "Batch number is required";
      else if (!/^\d{4}-\d{2}$/.test(l.expiry)) errs[`items.${i}`] = "Expiry month is required";
      else if (!(Number.isInteger(Number(l.qty)) && Number(l.qty) >= 1)) errs[`items.${i}`] = "Quantity must be ≥ 1";
      else if (l.purchaseRate === "" || Number.isNaN(Number(l.purchaseRate))) errs[`items.${i}`] = "Purchase rate is required";
      else if (!(Number(l.mrp) > 0)) errs[`items.${i}`] = "MRP is required";
    });
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError("Please correct the highlighted fields.");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api<{ id: string; code: string }>("/api/pharmacy/purchases", {
        method: "POST",
        body: {
          supplier, supplierInvoiceNo: invoiceNo, invoiceDate, notes,
          items: lines.map((l) => ({
            item: l.itemId, batchNo: l.batchNo, expiryDate: l.expiry, qty: Number(l.qty), freeQty: Number(l.freeQty) || 0,
            purchaseRate: Number(l.purchaseRate), mrp: Number(l.mrp), discountPct: Number(l.discountPct) || 0, gstRate: Number(l.gstRate),
          })),
        },
      });
      toast(`Purchase ${data.code} saved — stock added`);
      router.push(`/pharmacy/purchases/${data.id}`);
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) setErrors(err.fields);
      setFormError((err as Error).message);
      setSaving(false);
    }
  }

  function reset() {
    if (lines.length && !window.confirm("Discard this purchase entry?")) return;
    setLines([]);
    setSupplier("");
    setInvoiceNo("");
    setInvoiceDate(today());
    setNotes("");
    setErrors({});
    setFormError(null);
  }

  useHotkeys({ F2: reset, F3: () => searchRef.current?.focus(), F10: save, "ctrl+s": save });

  const minExpiry = today().slice(0, 7);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/pharmacy?tab=purchases" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Back to purchases">
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">New Purchase Entry</h1>
            <p className="text-xs text-slate-500">Stock-in against a supplier invoice · rate excludes GST · same batch no. adds to existing stock</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={reset} disabled={saving}>New <Kbd>F2</Kbd></Button>
          <Button onClick={save} loading={saving}>Save purchase <Kbd>F10</Kbd></Button>
        </div>
      </div>

      {formError && <div className="mb-4"><Alert>{formError}</Alert></div>}

      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="text-xs font-medium text-slate-600 lg:col-span-2">
            Supplier <span className="text-red-600">*</span>
            <div className="mt-1">
              <RefSelect id="pur-supplier" field={{ name: "supplier", label: "Supplier", type: "ref", ref: "inventory.suppliers", required: true }} value={supplier} onChange={setSupplier} className={cx(inputClass, errors.supplier && "ring-red-400")} />
            </div>
            {errors.supplier && <span className="mt-0.5 block font-normal text-red-600">{errors.supplier}</span>}
          </div>
          <label className="text-xs font-medium text-slate-600">
            Supplier invoice no. <span className="text-red-600">*</span>
            <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value.toUpperCase())} maxLength={40} className={cx(inputClass, "mt-1 font-mono", errors.supplierInvoiceNo && "ring-red-400")} />
            {errors.supplierInvoiceNo && <span className="mt-0.5 block font-normal text-red-600">{errors.supplierInvoiceNo}</span>}
          </label>
          <label className="text-xs font-medium text-slate-600">
            Invoice date <span className="text-red-600">*</span>
            <input type="date" value={invoiceDate} max={today()} onChange={(e) => setInvoiceDate(e.target.value)} className={cx(inputClass, "mt-1", errors.invoiceDate && "ring-red-400")} />
            {errors.invoiceDate && <span className="mt-0.5 block font-normal text-red-600">{errors.invoiceDate}</span>}
          </label>
        </div>
      </Card>

      <Card className="mb-4">
        <div className="border-b border-slate-100 p-3">
          <ItemSearch mode="purchase" onPick={(item) => addLine(item)} inputRef={searchRef} placeholder="F3 · Search item master, Enter to add a row" />
          {errors.items && <p className="mt-1 text-xs text-red-600">{errors.items}</p>}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-8 px-2 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">Item</th>
                <th className="w-28 px-2 py-2 text-left">Batch</th>
                <th className="w-32 px-2 py-2 text-left">Expiry</th>
                <th className="w-16 px-2 py-2 text-right">Qty</th>
                <th className="w-16 px-2 py-2 text-right">Free</th>
                <th className="w-20 px-2 py-2 text-right">Rate</th>
                <th className="w-20 px-2 py-2 text-right">MRP</th>
                <th className="w-16 px-2 py-2 text-right">Disc %</th>
                <th className="w-20 px-2 py-2 text-right">GST %</th>
                <th className="px-2 py-2 text-right">Amount</th>
                <th className="w-8 px-2 py-2" />
              </tr>
            </thead>
            <tbody ref={gridRef} onKeyDown={onGridKey} className="divide-y divide-slate-100">
              {lines.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-3 py-10 text-center text-sm text-slate-400">
                    No items yet. Press <Kbd>F3</Kbd> and search the item master.
                  </td>
                </tr>
              )}
              {lines.map((l, i) => {
                const err = errors[`items.${i}`];
                const num = (field: keyof Line, decimals = true) => (
                  <input
                    data-grid
                    inputMode={decimals ? "decimal" : "numeric"}
                    value={l[field]}
                    onChange={(e) => update(l.key, { [field]: e.target.value.replace(decimals ? /[^0-9.]/g : /[^0-9]/g, "") })}
                    className={cx(cell, "text-right tabular-nums")}
                    aria-label={`${field} for ${l.itemName}`}
                  />
                );
                return (
                  <tr key={l.key} className={cx(err && "bg-red-50")}>
                    <td className="px-2 py-1.5 text-xs text-slate-400">{i + 1}</td>
                    <td className="px-2 py-1.5">
                      <span className="font-medium text-slate-900">{l.itemName}</span>
                      {err && <span className="block text-xs text-red-600">{err}</span>}
                    </td>
                    <td className="px-2 py-1">
                      <input data-grid data-row={l.key} value={l.batchNo} onChange={(e) => update(l.key, { batchNo: e.target.value.toUpperCase() })} maxLength={40} className={cx(cell, "font-mono")} aria-label={`Batch for ${l.itemName}`} />
                    </td>
                    <td className="px-2 py-1">
                      <input data-grid type="month" min={minExpiry} value={l.expiry} onChange={(e) => update(l.key, { expiry: e.target.value })} className={cell} aria-label={`Expiry for ${l.itemName}`} />
                    </td>
                    <td className="px-2 py-1">{num("qty", false)}</td>
                    <td className="px-2 py-1">{num("freeQty", false)}</td>
                    <td className="px-2 py-1">{num("purchaseRate")}</td>
                    <td className="px-2 py-1">{num("mrp")}</td>
                    <td className="px-2 py-1">{num("discountPct")}</td>
                    <td className="px-2 py-1">
                      <select data-grid value={l.gstRate} onChange={(e) => update(l.key, { gstRate: e.target.value })} className={cx(cell, "text-right")} aria-label={`GST for ${l.itemName}`}>
                        {GST_RATES.map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </td>
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
          <label className="text-xs font-medium text-slate-600">
            Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className={cx(inputClass, "mt-1")} />
          </label>
        </Card>
        <Card className="p-4">
          <dl className="space-y-1.5 text-sm tabular-nums">
            <div className="flex justify-between"><dt className="text-slate-600">Taxable value</dt><dd>{totals.taxableTotal.toFixed(2)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">CGST + SGST</dt><dd className="text-slate-500">{totals.gstTotal.toFixed(2)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Round off</dt><dd className="text-slate-500">{totals.roundOff.toFixed(2)}</dd></div>
            <div className="flex items-baseline justify-between border-t border-slate-200 pt-2">
              <dt className="font-semibold text-slate-900">Invoice total</dt>
              <dd className="text-2xl font-bold text-slate-900">{formatMoney(totals.netAmount)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-slate-800 px-4 py-2 text-xs text-slate-200">
        <span><Kbd>F2</Kbd> New entry</span>
        <span><Kbd>F3</Kbd> Item search</span>
        <span><Kbd>Enter</Kbd> Next cell</span>
        <span><Kbd>F10</Kbd> / <Kbd>Ctrl+S</Kbd> Save</span>
      </div>
    </>
  );
}
