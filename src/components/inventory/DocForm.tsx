"use client";

import { ArrowLeft, LoaderCircle, PackageSearch, ScanBarcode, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { purchaseLine, purchaseTotals } from "@/lib/billing-math";
import { ApiClientError, api, qs } from "@/lib/client";
import { formatDate, formatMoney } from "@/lib/format";
import { DOC_CONFIG, ISSUE_DEPARTMENTS, PRIORITIES, type DocType } from "@/lib/inventory-docs";
import { GST_RATES } from "@/lib/modules";
import { RefSelect, type RefOption } from "../RecordForm";
import { Alert, Button, Card, CardHeader, Field, Kbd, cx, inputClass, useDebounced, useHotkeys } from "../ui";
import type { StockDocument } from "./types";

export interface ItemHit {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  unit: string;
  purchaseUnit: string;
  conversion: number;
  gstRate: number;
  mrp: number | null;
  lastRate: number | null;
  batchTracked: boolean;
  stock: number;
  reserved: number;
  available: number;
  batches: { id: string; batchNo: string; expiryDate: string | null; expired: boolean; quantity: number; mrp: number; rate: number }[];
}

interface FormLine {
  key: string;
  item: ItemHit;
  qty: string;
  freeQty: string;
  rate: string;
  mrp: string;
  discountPct: string;
  gstRate: string;
  batchNo: string;
  expiryDate: string;
  batch: string;
  remarks: string;
  /** Returns: source line and how much can still be returned. */
  line?: string;
  max?: number;
  label?: string;
}

const ref = (name: string, label: string, target: string, required = false) => ({ name, label, type: "ref" as const, ref: target, required });
const cellCls = "w-full rounded border-0 bg-white px-1.5 py-1 text-sm tabular-nums ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-brand-500";
const today = () => new Date().toISOString().slice(0, 10);
let seq = 0;
const newKey = () => `l${Date.now()}-${seq++}`;

function blankLine(item: ItemHit, type: DocType, extra: Partial<FormLine> = {}): FormLine {
  const purchase = type === "po" || type === "grn" || type === "requisition";
  const rate = item.lastRate != null ? String(+(item.lastRate * (purchase ? item.conversion : 1)).toFixed(2)) : "";
  return {
    key: newKey(), item, qty: "", freeQty: "", rate, mrp: item.mrp != null ? String(item.mrp) : "", discountPct: "", gstRate: String(item.gstRate ?? 12),
    batchNo: "", expiryDate: "", batch: "", remarks: "", ...extra,
  };
}

export function DocForm({ type, params }: { type: DocType; params: Record<string, string | undefined> }) {
  const cfg = DOC_CONFIG[type];
  const router = useRouter();
  const kind = cfg.lineKind;
  const [store, setStore] = useState<RefOption | null>(null);
  const [toStore, setToStore] = useState<RefOption | null>(null);
  const [supplier, setSupplier] = useState<RefOption | null>(null);
  const [patient, setPatient] = useState<RefOption | null>(null);
  const [category, setCategory] = useState<RefOption | null>(null);
  const [department, setDepartment] = useState("");
  const [purpose, setPurpose] = useState("");
  const [reason, setReason] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [requiredBy, setRequiredBy] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [terms, setTerms] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [docDate, setDocDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [chargeToPatient, setChargeToPatient] = useState(true);
  const [link, setLink] = useState<{ po?: StockDocument; requisition?: StockDocument; against?: StockDocument; reservation?: StockDocument }>({});
  const [lines, setLines] = useState<FormLine[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState(0);

  // Prefill from the default store and any linked document (PO → GRN, requisition → PO, return, reservation, reorder list).
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data: ctx } = await api<{ mainStore: RefOption; pharmacyStore: RefOption }>("/api/inventory/context");
        if (!live) return;
        if (cfg.store) setStore(ctx.mainStore);
        const load = async (id?: string) => (id ? (await api<StockDocument>(`/api/inventory/docs/${id}`)).data : undefined);
        const items = async (ids: string[], storeId?: string) => (ids.length ? (await api<ItemHit[]>(`/api/inventory/items/search${qs({ ids: ids.join(","), store: storeId })}`)).data : []);
        const po = type === "grn" ? await load(params.po) : undefined;
        const requisition = type === "po" ? await load(params.requisition) : undefined;
        const reservation = type === "issue" || type === "patient_issue" ? await load(params.reservation) : undefined;
        const against = cfg.against ? await load(params.against) : undefined;
        if (!live) return;
        setLink({ po, requisition, reservation, against });
        const src = po ?? requisition ?? reservation;
        if (src) {
          if (src.store) setStore({ id: src.store, label: src.storeName ?? "" });
          if (src.supplier) setSupplier({ id: src.supplier, label: src.supplierName ?? "" });
          if (src.patient) setPatient({ id: src.patient, label: src.patientName ?? "" });
          if (reservation?.purpose && type === "issue") setDepartment("");
          const hits = await items(src.lines.map((l) => l.item), reservation?.store);
          const hitOf = (id: string) => hits.find((h) => h.id === id);
          setLines(
            src.lines
              .map((l) => {
                const h = hitOf(l.item);
                if (!h) return null;
                const pending = po ? +(l.qty - (l.receivedQty ?? 0)).toFixed(2) : l.qty;
                if (pending <= 0) return null;
                return blankLine(h, type, { qty: String(pending), rate: l.rate ? String(l.rate) : blankLine(h, type).rate, discountPct: l.discountPct ? String(l.discountPct) : "", gstRate: String(l.gstRate ?? h.gstRate) });
              })
              .filter((x): x is FormLine => !!x)
          );
        } else if (against) {
          setStore(against.store ? { id: against.store, label: against.storeName ?? "" } : null);
          setLines(
            against.lines
              .filter((l) => l.qty - (l.returnedQty ?? 0) > 0)
              .map((l) => ({
                key: newKey(), item: { id: l.item, name: l.itemName, sku: l.sku ?? "", unit: l.unit ?? "", purchaseUnit: l.purchaseUnit ?? "" } as ItemHit,
                qty: "", freeQty: "", rate: String(l.rate), mrp: String(l.mrp ?? ""), discountPct: "", gstRate: "", batchNo: l.batchNo ?? "", expiryDate: "", batch: "", remarks: "",
                line: l.id, max: +(l.qty - (l.returnedQty ?? 0)).toFixed(2), label: l.batchNo,
              }))
          );
        } else if (params.items) {
          const wanted = params.items.split(",").map((p) => p.split(":"));
          const hits = await items(wanted.map(([id]) => id));
          setLines(wanted.map(([id, q]) => hits.find((h) => h.id === id) && blankLine(hits.find((h) => h.id === id)!, type, { qty: q ?? "" })).filter((x): x is FormLine => !!x));
        }
        setKeys((k) => k + 1);
      } catch (e) {
        if (live) setFormError((e as Error).message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefill once
  }, []);

  function changeStore(o: RefOption | null) {
    if (kind === "pick" || kind === "adjust") {
      if (lines.length && !window.confirm("Changing the store clears the item lines (stock differs per store). Continue?")) {
        setKeys((k) => k + 1);
        return;
      }
      setLines([]);
    }
    setStore(o);
  }
  const update = (key: string, patch: Partial<FormLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function addItem(item: ItemHit) {
    if ((kind === "request" || kind === "order" || kind === "pick") && lines.some((l) => l.item.id === item.id) && kind !== "pick") {
      setFormError(`${item.name} is already on this document`);
      return;
    }
    setFormError(null);
    setLines((ls) => [...ls, blankLine(item, type)]);
  }

  async function loadExpired() {
    if (!store) return;
    const { data } = await api<{ rows: { id: string; itemId: string; batchNo: string; qty: number; daysLeft: number }[] }>(`/api/inventory/reports/expiry${qs({ store: store.id, days: 0 })}`);
    const expired = data.rows.filter((r) => r.daysLeft < 0);
    if (!expired.length) return setFormError(`No expired stock in ${store.label}`);
    const hits = await api<ItemHit[]>(`/api/inventory/items/search${qs({ ids: [...new Set(expired.map((e) => e.itemId))].join(","), store: store.id })}`);
    setLines((ls) => [
      ...ls,
      ...expired.filter((e) => !ls.some((l) => l.batch === e.id)).map((e) => blankLine(hits.data.find((h) => h.id === e.itemId)!, type, { batch: e.id, qty: String(e.qty) })),
    ]);
    setReason("Expired");
  }

  const money = kind === "order" || (kind === "receipt" && type === "grn");
  const computed = lines.map((l) => purchaseLine({ qty: Number(l.qty) || 0, purchaseRate: Number(l.rate) || 0, discountPct: Number(l.discountPct) || 0, gstRate: Number(l.gstRate) || 0 }));
  const totals = purchaseTotals(computed);

  async function save() {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    setErrors({});
    const body: Record<string, unknown> = {
      type, docDate, notes, store: store?.id, toStore: toStore?.id, supplier: supplier?.id, patient: patient?.id, department, purpose, reason, reasonNote, priority,
      requiredBy: requiredBy || undefined, expectedDate: expectedDate || undefined, terms, invoiceNo, invoiceDate, chargeToPatient, category: category?.id,
      po: link.po?.id, requisition: link.requisition?.id, against: link.against?.id, reservation: link.reservation?.id,
      lines: lines
        .filter((l) => kind !== "return" || Number(l.qty) > 0)
        .map((l) => ({
          item: l.item.id, qty: Number(l.qty), freeQty: Number(l.freeQty) || 0, rate: l.rate === "" ? undefined : Number(l.rate), mrp: l.mrp === "" ? undefined : Number(l.mrp),
          discountPct: Number(l.discountPct) || 0, gstRate: l.gstRate === "" ? undefined : Number(l.gstRate), batchNo: l.batchNo, expiryDate: l.expiryDate || undefined,
          batch: l.batch || undefined, remarks: l.remarks, line: l.line,
        })),
    };
    if (kind === "count") delete body.lines;
    try {
      const { data } = await api<{ id: string }>("/api/inventory/docs", { method: "POST", body });
      router.push(`/inventory/docs/${data.id}`);
    } catch (e) {
      if (e instanceof ApiClientError && e.fields) setErrors(e.fields);
      setFormError(e instanceof ApiClientError && e.fields ? Object.values(e.fields)[0] : (e as Error).message);
      setSaving(false);
    }
  }
  useHotkeys({ "ctrl+s": () => save(), F10: () => save() });

  const back = `/m/inventory?tab=${type}`;
  return (
    <>
      <Link href={back} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Back to {cfg.label.toLowerCase()}</Link>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">New {cfg.singular.toLowerCase()}</h1>
          <p className="mt-1 text-sm text-slate-500">{cfg.description}</p>
        </div>
        <Button onClick={save} loading={saving} disabled={loading}>{kind === "count" ? "Create count sheet" : ["requisition", "po"].includes(type) ? "Submit for approval" : type === "reservation" ? "Reserve" : "Post"} <Kbd>Ctrl+S</Kbd></Button>
      </div>
      {formError && <div className="mb-4"><Alert>{formError}</Alert></div>}

      <Card className="mb-5">
        <CardHeader title="Details" />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3" key={keys}>
          {link.po && <Info label="Against PO" value={`${link.po.code} · ${link.po.supplierName}`} />}
          {link.requisition && <Info label="From requisition" value={`${link.requisition.code} · ${link.requisition.storeName}`} />}
          {link.reservation && <Info label="Against reservation" value={`${link.reservation.code} · ${link.reservation.purpose}`} />}
          {cfg.against && (link.against ? <Info label="Returning against" value={`${link.against.code} · ${link.against.supplierName ?? link.against.patientName ?? link.against.department ?? link.against.toStoreName ?? ""}`} /> : <AgainstPicker type={type} />)}
          {cfg.supplier && (
            <Field label="Supplier" htmlFor="d-sup" required error={errors.supplier}>
              <RefSelect id="d-sup" field={ref("supplier", "Supplier", "inventory.suppliers", true)} value={supplier?.id ?? ""} initial={supplier ?? undefined} disabled={!!link.po} className={inputClass} onChange={() => {}} onPick={setSupplier} />
            </Field>
          )}
          {cfg.store && !cfg.against && (
            <Field label={cfg.store.label} htmlFor="d-store" required error={errors.store}>
              <RefSelect id="d-store" field={ref("store", cfg.store.label, "inventory.stores", true)} value={store?.id ?? ""} initial={store ?? undefined} disabled={!!link.reservation} className={inputClass} onChange={() => {}} onPick={changeStore} />
            </Field>
          )}
          {cfg.toStore && (
            <Field label="To store" htmlFor="d-to" required error={errors.toStore}>
              <RefSelect id="d-to" field={ref("toStore", "Destination store", "inventory.stores", true)} value={toStore?.id ?? ""} initial={toStore ?? undefined} className={inputClass} onChange={() => {}} onPick={setToStore} />
            </Field>
          )}
          {cfg.department && (
            <Field label="Department" htmlFor="d-dept" required={type === "issue"} error={errors.department}>
              <select id="d-dept" value={department} onChange={(e) => setDepartment(e.target.value)} className={inputClass}>
                <option value="">{type === "issue" ? "Select…" : "— None —"}</option>
                {ISSUE_DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
              </select>
            </Field>
          )}
          {cfg.patient && (
            <Field label="Patient" htmlFor="d-pat" required={type === "patient_issue"} error={errors.patient}>
              <RefSelect id="d-pat" field={ref("patient", "Patient", "patients.patients", type === "patient_issue")} value={patient?.id ?? ""} initial={patient ?? undefined} className={inputClass} onChange={(v) => !v && setPatient(null)} onPick={setPatient} />
            </Field>
          )}
          {cfg.purpose && (
            <Field label="Reserved for" htmlFor="d-purpose" required error={errors.purpose}>
              <input id="d-purpose" value={purpose} maxLength={200} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. OT case — knee replacement, 14 Oct" className={inputClass} />
            </Field>
          )}
          {cfg.reasons && (
            <Field label="Reason" htmlFor="d-reason" required error={errors.reason}>
              <select id="d-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass}>
                <option value="">Select…</option>
                {cfg.reasons.map((r) => <option key={r}>{r}</option>)}
              </select>
            </Field>
          )}
          {reason === "Other" && <Field label="Describe the reason" htmlFor="d-rnote"><input id="d-rnote" value={reasonNote} maxLength={200} onChange={(e) => setReasonNote(e.target.value)} className={inputClass} /></Field>}
          {cfg.invoice && (
            <>
              <Field label="Supplier invoice no." htmlFor="d-inv" required error={errors.invoiceNo}><input id="d-inv" value={invoiceNo} maxLength={40} onChange={(e) => setInvoiceNo(e.target.value)} className={inputClass} /></Field>
              <Field label="Invoice date" htmlFor="d-invd" required error={errors.invoiceDate}><input id="d-invd" type="date" value={invoiceDate} max={today()} onChange={(e) => setInvoiceDate(e.target.value)} className={inputClass} /></Field>
            </>
          )}
          {cfg.priority && (
            <Field label="Priority" htmlFor="d-prio"><select id="d-prio" value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></Field>
          )}
          {cfg.requiredBy && <Field label="Required by" htmlFor="d-req"><input id="d-req" type="date" value={requiredBy} min={today()} onChange={(e) => setRequiredBy(e.target.value)} className={inputClass} /></Field>}
          {cfg.expectedDate && <Field label="Expected delivery" htmlFor="d-exp"><input id="d-exp" type="date" value={expectedDate} min={today()} onChange={(e) => setExpectedDate(e.target.value)} className={inputClass} /></Field>}
          {kind === "count" && (
            <Field label="Category (optional)" htmlFor="d-cat" hint="Leave blank to count the whole store">
              <RefSelect id="d-cat" field={ref("category", "Category", "inventory.categories")} value={category?.id ?? ""} initial={category ?? undefined} className={inputClass} onChange={(v) => !v && setCategory(null)} onPick={setCategory} />
            </Field>
          )}
          {type !== "po" && type !== "requisition" && type !== "reservation" && kind !== "count" && (
            <Field label="Date" htmlFor="d-date"><input id="d-date" type="date" value={docDate} max={today()} onChange={(e) => setDocDate(e.target.value)} className={inputClass} /></Field>
          )}
          {type === "po" && <Field label="Terms" htmlFor="d-terms" className="sm:col-span-2"><input id="d-terms" value={terms} maxLength={500} onChange={(e) => setTerms(e.target.value)} placeholder="Delivery, payment and warranty terms" className={inputClass} /></Field>}
          {type === "patient_issue" && (
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
              <input type="checkbox" checked={chargeToPatient} onChange={(e) => setChargeToPatient(e.target.checked)} className="size-4 rounded border-slate-300 text-brand-600" /> Add to the patient&apos;s bill (at MRP)
            </label>
          )}
          <Field label="Notes" htmlFor="d-notes" className="sm:col-span-2 lg:col-span-3"><input id="d-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} className={inputClass} /></Field>
        </div>
      </Card>

      {kind === "count" ? (
        <Card className="p-5 text-sm text-slate-600">Creating the count sheet snapshots every batch in the store with its system quantity. You then enter counted quantities and post the differences.</Card>
      ) : (
        <Card>
          <CardHeader
            title={kind === "return" ? "Quantities to return" : "Items"}
            description={cfg.purchaseUnits ? "Quantities are in purchase units (e.g. boxes); stock is kept in issue units." : kind === "pick" ? "Batches are picked first-expiry-first-out unless you choose one." : undefined}
            actions={type === "write_off" ? <Button variant="secondary" disabled={!store} onClick={loadExpired}>Load expired batches</Button> : undefined}
          />
          {kind !== "return" && (
            <div className="border-b border-slate-100 p-4">
              <ItemPicker store={kind === "pick" || kind === "adjust" ? store?.id : undefined} onPick={addItem} disabled={(kind === "pick" || kind === "adjust") && !store} />
              {errors.lines && <p className="mt-2 text-xs text-red-600">{errors.lines}</p>}
            </div>
          )}
          {loading ? (
            <p className="flex items-center gap-2 px-5 py-6 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" /> Loading…</p>
          ) : lines.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">{kind === "return" ? "Choose the document to return against." : "Search or scan an item to add it."}</p>
          ) : (
            <LinesTable type={type} lines={lines} computed={computed} errors={errors} update={update} remove={(key) => setLines((ls) => ls.filter((l) => l.key !== key))} />
          )}
          {money && lines.length > 0 && (
            <dl className="flex flex-wrap justify-end gap-x-8 gap-y-1 border-t border-slate-100 px-5 py-3 text-sm tabular-nums">
              <div className="flex gap-2"><dt className="text-slate-500">Taxable</dt><dd>{formatMoney(totals.taxableTotal)}</dd></div>
              <div className="flex gap-2"><dt className="text-slate-500">GST</dt><dd>{formatMoney(totals.gstTotal)}</dd></div>
              <div className="flex gap-2"><dt className="text-slate-500">Round off</dt><dd>{totals.roundOff.toFixed(2)}</dd></div>
              <div className="flex gap-2 font-bold text-slate-900"><dt>Net</dt><dd>{formatMoney(totals.netAmount)}</dd></div>
            </dl>
          )}
        </Card>
      )}
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}

/** Find the source document of a return by its number. */
function AgainstPicker({ type }: { type: DocType }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function find() {
    setBusy(true);
    setError(null);
    try {
      for (const t of DOC_CONFIG[type].against!) {
        const { data } = await api<{ id: string; code: string }[]>(`/api/inventory/docs${qs({ type: t, search: code.trim() })}`);
        const hit = data.find((d) => d.code.toUpperCase() === code.trim().toUpperCase());
        if (hit) return router.replace(`/inventory/docs/new?type=${type}&against=${hit.id}`);
      }
      setError("No posted document with that number");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Field label={`Return against (${DOC_CONFIG[type].against!.map((t) => DOC_CONFIG[t].prefix).join(" / ")} no.)`} htmlFor="d-against" required error={error ?? undefined}>
      <div className="flex gap-2">
        <input id="d-against" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && find()} placeholder={`e.g. ${DOC_CONFIG[DOC_CONFIG[type].against![0]].prefix}-2026-000001`} className={cx(inputClass, "font-mono")} />
        <Button variant="secondary" loading={busy} onClick={find}>Load</Button>
      </div>
    </Field>
  );
}

/** Search by name / SKU, or scan a barcode and press Enter. */
export function ItemPicker({ store, onPick, disabled }: { store?: string; onPick: (i: ItemHit) => void; disabled?: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q, 250);
  const [hits, setHits] = useState<{ key: string; items: ItemHit[] } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const key = `${debounced}|${store ?? ""}`;
  useEffect(() => {
    if (!open || disabled) return;
    const ctrl = new AbortController();
    api<ItemHit[]>(`/api/inventory/items/search${qs({ q: debounced, store })}`, { signal: ctrl.signal }).then(({ data }) => setHits({ key, items: data })).catch(() => {});
    return () => ctrl.abort();
  }, [open, debounced, store, key, disabled]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const pick = (i: ItemHit) => {
    onPick(i);
    setQ("");
    setOpen(false);
  };
  async function onEnter() {
    const code = q.trim();
    if (!code) return;
    const { data } = await api<ItemHit[]>(`/api/inventory/items/search${qs({ q: code, store })}`);
    const exact = data.find((i) => i.barcode === code || i.sku === code.toUpperCase());
    if (exact) pick(exact);
    else if (data.length === 1) pick(data[0]);
  }
  const loading = open && hits?.key !== key;
  return (
    <div ref={wrap} className="relative">
      <ScanBarcode className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" aria-hidden />
      <input value={q} disabled={disabled} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnter(); } }}
        placeholder={disabled ? "Choose the store first" : "Search item name / SKU, or scan barcode + Enter"} className={cx(inputClass, "pl-9")} aria-label="Add item" />
      {loading && <LoaderCircle className="absolute right-3 top-2.5 size-4 animate-spin text-slate-400" />}
      {open && !disabled && hits && (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200">
          {hits.items.length === 0 && <p className="flex items-center gap-2 px-3 py-2 text-slate-500"><PackageSearch className="size-4" /> No items. Add them in Masters → Item Master.</p>}
          {hits.items.map((i) => (
            <button key={i.id} type="button" onClick={() => pick(i)} className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-brand-50">
              <span>
                <span className="font-medium text-slate-900">{i.name}</span> <span className="font-mono text-xs text-slate-500">{i.sku}</span>
                <span className="block text-xs text-slate-500">{[i.unit, i.conversion > 1 ? `${i.conversion} ${i.unit} / ${i.purchaseUnit}` : null, i.batchTracked ? null : "no batch tracking"].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="shrink-0 text-right text-xs tabular-nums text-slate-600">
                {store ? <>{i.available} {i.unit} free{i.reserved ? <span className="block text-amber-700">{i.reserved} reserved</span> : null}</> : <>{i.stock || 0} in stock</>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LinesTable({ type, lines, computed, errors, update, remove }: {
  type: DocType; lines: FormLine[]; computed: ReturnType<typeof purchaseLine>[]; errors: Record<string, string>;
  update: (key: string, p: Partial<FormLine>) => void; remove: (key: string) => void;
}) {
  const kind = DOC_CONFIG[type].lineKind;
  const grn = type === "grn";
  const cols =
    kind === "request" ? ["Item", "Quantity", "Remarks", ""]
    : kind === "order" ? ["Item", "Qty", "Rate", "Disc %", "GST %", "Amount", ""]
    : kind === "receipt" ? ["Item", "Batch", "Expiry", "Qty", ...(grn ? ["Free"] : []), "Rate", "MRP / issue unit", ...(grn ? ["Disc %", "GST %", "Amount"] : []), ""]
    : kind === "pick" ? ["Item", "Batch", "Qty", "Available", ""]
    : kind === "adjust" ? ["Item", "Batch", type === "adjustment" ? "Qty (+ / −)" : "Qty", "Remarks", ""]
    : ["Item", "Batch", "Issued / left", "Return qty"];
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100 text-sm">
        <thead className="bg-slate-50/60"><tr>{cols.map((c, i) => <th key={i} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{c}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((l, i) => {
            const err = errors[`lines.${i}`];
            const unit = DOC_CONFIG[type].purchaseUnits ? l.item.purchaseUnit || l.item.unit : l.item.unit;
            const input = (field: keyof FormLine, w = "w-20", extra: Record<string, unknown> = {}) => (
              <input value={String(l[field] ?? "")} onChange={(e) => update(l.key, { [field]: field === "batchNo" || field === "remarks" || field === "expiryDate" ? e.target.value : e.target.value.replace(/[^0-9.-]/g, "") })} className={cx(cellCls, w)} aria-label={`${l.item.name} ${String(field)}`} {...extra} />
            );
            const itemCell = (
              <td className="px-3 py-2">
                <div className="font-medium text-slate-900">{l.item.name}</div>
                <div className="text-xs text-slate-500">{l.item.sku}{unit ? ` · ${unit}` : ""}{kind === "receipt" && grn && l.item.conversion > 1 ? ` (= ${l.item.conversion} ${l.item.unit})` : ""}</div>
                {err && <div className="text-xs text-red-600">{err}</div>}
              </td>
            );
            const del = <td className="px-2 py-2 text-right"><button onClick={() => remove(l.key)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove line"><Trash2 className="size-4" /></button></td>;
            const batchSelect = (allowAuto: boolean, includeExpired: boolean) => (
              <td className="px-3 py-2">
                <select value={l.batch} onChange={(e) => update(l.key, { batch: e.target.value })} className={cx(cellCls, "w-48")} aria-label="Batch">
                  {allowAuto ? <option value="">Auto (first expiry first)</option> : <option value="">Select batch…</option>}
                  {l.item.batches?.filter((b) => includeExpired || !b.expired).map((b) => (
                    <option key={b.id} value={b.id}>{b.batchNo} · exp {b.expiryDate ? formatDate(b.expiryDate).replace(/^\d+ /, "") : "—"} · {b.quantity}{b.expired ? " · EXPIRED" : ""}</option>
                  ))}
                </select>
              </td>
            );
            if (kind === "request") return <tr key={l.key}>{itemCell}<td className="px-3 py-2">{input("qty")}</td><td className="px-3 py-2">{input("remarks", "w-56")}</td>{del}</tr>;
            if (kind === "order") return (
              <tr key={l.key}>{itemCell}<td className="px-3 py-2">{input("qty")}</td><td className="px-3 py-2">{input("rate", "w-24")}</td><td className="px-3 py-2">{input("discountPct", "w-16")}</td>
                <td className="px-3 py-2"><select value={l.gstRate} onChange={(e) => update(l.key, { gstRate: e.target.value })} className={cx(cellCls, "w-16")}>{GST_RATES.map((g) => <option key={g}>{g}</option>)}</select></td>
                <td className="px-3 py-2 text-right tabular-nums">{computed[i].amount.toFixed(2)}</td>{del}</tr>
            );
            if (kind === "receipt") return (
              <tr key={l.key}>
                {itemCell}
                <td className="px-3 py-2">{l.item.batchTracked === false ? <span className="text-xs text-slate-400">n/a</span> : input("batchNo", "w-28", { placeholder: "Batch" })}</td>
                <td className="px-3 py-2">{l.item.batchTracked === false ? <span className="text-xs text-slate-400">n/a</span> : <input type="month" value={l.expiryDate} onChange={(e) => update(l.key, { expiryDate: e.target.value })} className={cx(cellCls, "w-36")} aria-label="Expiry" />}</td>
                <td className="px-3 py-2">{input("qty")}</td>
                {grn && <td className="px-3 py-2">{input("freeQty", "w-16")}</td>}
                <td className="px-3 py-2">{input("rate", "w-24")}</td>
                <td className="px-3 py-2">{input("mrp", "w-24")}</td>
                {grn && <td className="px-3 py-2">{input("discountPct", "w-16")}</td>}
                {grn && <td className="px-3 py-2"><select value={l.gstRate} onChange={(e) => update(l.key, { gstRate: e.target.value })} className={cx(cellCls, "w-16")}>{GST_RATES.map((g) => <option key={g}>{g}</option>)}</select></td>}
                {grn && <td className="px-3 py-2 text-right tabular-nums">{computed[i].amount.toFixed(2)}</td>}
                {del}
              </tr>
            );
            if (kind === "pick") return (
              <tr key={l.key}>{itemCell}{batchSelect(true, false)}<td className="px-3 py-2">{input("qty")}</td>
                <td className="px-3 py-2 text-xs tabular-nums text-slate-600">{l.item.available} {l.item.unit}{l.item.reserved ? <span className="block text-amber-700">{l.item.reserved} reserved</span> : null}</td>{del}</tr>
            );
            if (kind === "adjust") return <tr key={l.key}>{itemCell}{batchSelect(false, true)}<td className="px-3 py-2">{input("qty")}</td><td className="px-3 py-2">{input("remarks", "w-48")}</td>{del}</tr>;
            return (
              <tr key={l.key}>{itemCell}<td className="px-3 py-2 font-mono text-xs text-slate-600">{l.label}</td><td className="px-3 py-2 tabular-nums text-slate-600">left {l.max}</td>
                <td className="px-3 py-2">{input("qty", "w-20", { placeholder: "0" })}</td></tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
