"use client";

import { FileSpreadsheet, IndianRupee, Plus, Printer, ScrollText, Search, ShoppingCart, Tag } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { ApiClientError, api, qs } from "@/lib/client";
import { downloadCsv } from "@/lib/csv";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { DOC_CONFIG, isDocType, type DocType } from "@/lib/inventory-docs";
import { useApiQuery } from "@/lib/useApi";
import { RefSelect, type RefOption } from "../RecordForm";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Kbd, Modal, Pagination, Spinner, StatCard, cx, inputClass, statusTone, useDebounced, useHotkeys, useToast } from "../ui";

const storeRef = { name: "store", label: "Store", type: "ref" as const, ref: "inventory.stores" };
const itemRef = { name: "item", label: "Item", type: "ref" as const, ref: "inventory.items", required: true };
const th = "whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
const td = "whitespace-nowrap px-4 py-2.5";

/** Bespoke inventory tabs: stock views, document lists, dues and reports. */
export function InventorySection({ section }: { section: string }) {
  if (section === "stock") return <StockOverview />;
  if (section === "reorder") return <ReorderAlerts />;
  if (section === "dues") return <SupplierDues />;
  if (section === "reports") return <InventoryReports />;
  if (isDocType(section)) return <DocList key={section} type={section} />;
  return null;
}

/* ======================= document lists ======================= */

interface DocRow {
  id: string;
  code: string;
  docDate: string;
  status: string;
  storeName: string | null;
  toStoreName: string | null;
  supplierName: string | null;
  patientName: string | null;
  department: string | null;
  purpose: string | null;
  reason: string | null;
  invoiceNo: string | null;
  againstCode: string | null;
  poCode: string | null;
  netAmount: number;
  costValue: number;
  lines: number;
  summary: string;
  received: number | null;
  ordered: number | null;
  createdByName: string | null;
}

function party(type: DocType, r: DocRow) {
  switch (type) {
    case "po":
    case "grn":
    case "purchase_return":
      return [r.supplierName, r.invoiceNo && `Inv ${r.invoiceNo}`, r.againstCode && `vs ${r.againstCode}`].filter(Boolean).join(" · ");
    case "transfer":
      return `${r.storeName} → ${r.toStoreName}`;
    case "issue":
      return `${r.storeName} → ${r.department}`;
    case "patient_issue":
      return `${r.storeName} → ${r.patientName}`;
    case "return":
      return `${r.againstCode} → ${r.storeName}`;
    case "reservation":
      return `${r.storeName} · ${r.purpose}${r.patientName ? ` (${r.patientName})` : ""}`;
    case "requisition":
      return [r.storeName, r.department].filter(Boolean).join(" · ");
    default:
      return [r.storeName, r.reason].filter(Boolean).join(" · ");
  }
}

function DocList({ type }: { type: DocType }) {
  const cfg = DOC_CONFIG[type];
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const q = useApiQuery<DocRow[]>(`/api/inventory/docs${qs({ type, search: debounced, status, from, to, page })}`);
  const rows = q.data ?? [];
  const newHref = `/inventory/docs/new?type=${type}`;
  const creatable = type !== "return" && type !== "purchase_return";
  useHotkeys({ F2: () => router.push(newHref) });
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <Card>
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative sm:col-span-2 lg:col-span-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input value={search} onChange={(e) => reset(setSearch)(e.target.value)} placeholder="Number, party, store, item…" className={cx(inputClass, "pl-9")} aria-label="Search" />
        </div>
        <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={inputClass} aria-label="Status">
          <option value="">All statuses</option>
          {cfg.statuses.map((s) => <option key={s}>{s}</option>)}
        </select>
        <input type="date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} className={inputClass} aria-label="From date" />
        <input type="date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} className={inputClass} aria-label="To date" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
        <p className="text-xs text-slate-500">{cfg.description}{!creatable && " Open the source document and choose Return."}</p>
        <Link href={newHref}><Button><Plus className="size-4" /> New {cfg.singular.toLowerCase()} <Kbd>F2</Kbd></Button></Link>
      </div>
      {q.loading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : rows.length === 0 ? (
        <EmptyState title={`No ${cfg.label.toLowerCase()}`} description={debounced || status || from || to ? "Nothing matches these filters." : cfg.description} />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/60">
              <tr>
                {["No.", "Date", "Details", "Items", cfg.amounts ? "Amount" : "Value", "Status", "By"].map((h) => <th key={h} className={cx(th, (h === "Amount" || h === "Value") && "text-right")}>{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} onClick={() => router.push(`/inventory/docs/${r.id}`)} className="cursor-pointer hover:bg-brand-50/40">
                  <td className={cx(td, "font-mono text-xs text-brand-700")}>{r.code}</td>
                  <td className={cx(td, "text-slate-600")}>{formatDate(r.docDate)}</td>
                  <td className="max-w-[18rem] truncate px-4 py-2.5 text-slate-800" title={party(type, r)}>{party(type, r) || "—"}</td>
                  <td className="max-w-[16rem] px-4 py-2.5 text-slate-600">
                    <span className="block truncate" title={r.summary}>{r.summary}</span>
                    {type === "po" && r.ordered ? <span className="text-xs text-slate-500">{r.received}/{r.ordered} received</span> : null}
                  </td>
                  <td className={cx(td, "text-right tabular-nums")}>{formatMoney(cfg.amounts ? r.netAmount : r.costValue)}</td>
                  <td className={td}><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                  <td className={cx(td, "text-xs text-slate-500")}>{r.createdByName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!q.loading && !q.error && <Pagination pagination={q.pagination} onPage={setPage} />}
    </Card>
  );
}

/* ======================= stock overview ======================= */

interface StockRow {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  qty: number;
  reserved: number;
  available: number;
  totalStock: number;
  value: number;
  mrpValue: number;
  batches: number;
  nearestExpiry: string | null;
  expiredQty: number;
  expiringQty: number;
  min: number | null;
  max: number | null;
  reorderLevel: number | null;
  level: string;
  stores: string[];
}

const FLAGS = [
  { key: "", label: "All items" },
  { key: "low", label: "Reorder / out" },
  { key: "expiring", label: "Expiring ≤ 90 d" },
  { key: "over", label: "Over max" },
  { key: "reserved", label: "Reserved" },
];

function StoreSelect({ value, onChange, allLabel = "All stores" }: { value: RefOption | null; onChange: (o: RefOption | null) => void; allLabel?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-56 flex-1">
        <RefSelect id="inv-store" field={{ ...storeRef, label: allLabel }} value={value?.id ?? ""} initial={value ?? undefined} className={inputClass} onChange={(v) => !v && onChange(null)} onPick={onChange} />
      </div>
    </div>
  );
}

function StockOverview() {
  const [store, setStore] = useState<RefOption | null>(null);
  const [search, setSearch] = useState("");
  const [flag, setFlag] = useState("");
  const debounced = useDebounced(search);
  const q = useApiQuery<{ rows: StockRow[]; totals: { items: number; value: number; mrpValue: number; reorder: number; expiring: number; expired: number } }>(
    `/api/inventory/stock${qs({ store: store?.id, search: debounced, flag })}`
  );
  const d = q.data;

  function exportCsv() {
    if (!d) return;
    downloadCsv(`stock_${store?.label ?? "all-stores"}_${new Date().toISOString().slice(0, 10)}.csv`,
      ["Item", "SKU", "Category", "Qty", "Unit", "Reserved", "Available", "Batches", "Nearest expiry", "Expired qty", "Value (cost)", "Value (MRP)", "Level", "Stores"],
      d.rows.map((r) => [r.name, r.sku, r.category, r.qty, r.unit, r.reserved, r.available, r.batches, formatDate(r.nearestExpiry), r.expiredQty, r.value, r.mrpValue, r.level, r.stores.join(" | ")]));
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(14rem,20rem)_1fr_auto]">
          <StoreSelect value={store} onChange={setStore} />
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Item, SKU or scan barcode" className={cx(inputClass, "pl-9")} aria-label="Search items" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={exportCsv} disabled={!d}><FileSpreadsheet className="size-4" /> CSV</Button>
            <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {FLAGS.map((f) => (
            <button key={f.key} onClick={() => setFlag(f.key)} className={cx("rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset", flag === f.key ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50")}>{f.label}</button>
          ))}
        </div>
      </Card>
      {d && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label={store ? `Items in ${store.label}` : "Items"} value={d.totals.items} />
          <StatCard label="Stock value (cost)" value={formatMoney(d.totals.value)} hint={`MRP value ${formatMoney(d.totals.mrpValue)}`} />
          <StatCard label="Reorder / out of stock" value={d.totals.reorder} tone={d.totals.reorder ? "amber" : "slate"} />
          <StatCard label="Expiring ≤ 90 days" value={d.totals.expiring} hint={d.totals.expired ? `${d.totals.expired} item(s) with expired stock` : undefined} tone={d.totals.expired ? "red" : "slate"} />
        </div>
      )}
      <Card>
        {q.loading ? <Spinner /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !d || d.rows.length === 0 ? (
          <EmptyState title="No stock to show" description="Receive goods with a GRN or record opening stock with a Stock Entry." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/60">
                <tr>{["Item", "Category", "In stock", "Reserved", "Available", "Nearest expiry", "Value", "Level", ""].map((h, i) => <th key={i} className={cx(th, i >= 2 && i <= 4 && "text-right", i === 6 && "text-right")}>{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">{r.name}</div>
                      <div className="text-xs text-slate-500">{r.sku}{!store && r.stores.length ? ` · ${r.stores.join(", ")}` : ""}</div>
                    </td>
                    <td className={cx(td, "text-slate-600")}>{r.category}</td>
                    <td className={cx(td, "text-right font-medium tabular-nums")}>{r.qty} <span className="text-xs font-normal text-slate-500">{r.unit}</span></td>
                    <td className={cx(td, "text-right tabular-nums text-slate-600")}>{r.reserved || ""}</td>
                    <td className={cx(td, "text-right tabular-nums")}>{r.available}</td>
                    <td className={cx(td, r.expiredQty ? "text-red-600" : r.expiringQty ? "text-amber-700" : "text-slate-600")}>
                      {formatDate(r.nearestExpiry)}{r.expiredQty ? <span className="ml-1 text-xs">({r.expiredQty} expired)</span> : null}
                    </td>
                    <td className={cx(td, "text-right tabular-nums")}>{formatMoney(r.value)}</td>
                    <td className={td}><Badge tone={r.level === "OK" ? "green" : r.level === "Over max" ? "blue" : statusTone(r.level === "Reorder" ? "low stock" : r.level)}>{r.level}</Badge></td>
                    <td className={cx(td, "text-right")}>
                      <Link href={`/m/inventory?tab=reports&report=ledger&item=${r.id}&label=${encodeURIComponent(r.name)}`} className="mr-1 inline-flex rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700" title="Stock ledger"><ScrollText className="size-4" /></Link>
                      <Link href={`/inventory/barcodes?items=${r.id}`} target="_blank" className="inline-flex rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700" title="Print barcode labels"><Tag className="size-4" /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ======================= reorder alerts ======================= */

interface ReorderRow { id: string; name: string; sku: string; category: string; unit: string; purchaseUnit: string; conversion: number; qty: number; min: number | null; max: number | null; reorderLevel: number | null; onOrder: number; suggested: number; supplier: string | null; status: string }

function ReorderAlerts() {
  const router = useRouter();
  const q = useApiQuery<ReorderRow[]>("/api/inventory/reorder");
  const rows = q.data ?? [];
  const [picked, setPicked] = useState<Record<string, string>>({});
  const selected = Object.entries(picked).filter(([, v]) => Number(v) > 0);

  return (
    <Card>
      <CardHeader title="Items at or below reorder level" description="Total stock across all stores, with quantities already on open purchase orders."
        actions={<Button disabled={!selected.length} onClick={() => router.push(`/inventory/docs/new?type=requisition&items=${selected.map(([id, v]) => `${id}:${v}`).join(",")}`)}><ShoppingCart className="size-4" /> Raise requisition ({selected.length})</Button>} />
      {q.loading ? <Spinner /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : rows.length === 0 ? (
        <EmptyState title="Nothing to reorder" description="Every item with a reorder level or minimum is above it." />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/60"><tr>{["", "Item", "Stock", "Min / reorder / max", "On order", "Order qty", "Preferred supplier", "Status"].map((h, i) => <th key={i} className={th}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5">
                    <input type="checkbox" checked={r.id in picked} onChange={(e) => setPicked((p) => { const n = { ...p }; if (e.target.checked) n[r.id] = String(r.suggested); else delete n[r.id]; return n; })} aria-label={`Select ${r.name}`} className="size-4 rounded border-slate-300 text-brand-600" />
                  </td>
                  <td className="px-4 py-2.5"><div className="font-medium text-slate-900">{r.name}</div><div className="text-xs text-slate-500">{r.sku} · {r.category}</div></td>
                  <td className={cx(td, "font-medium tabular-nums", r.qty <= 0 ? "text-red-600" : "text-amber-700")}>{r.qty} {r.unit}</td>
                  <td className={cx(td, "tabular-nums text-slate-600")}>{[r.min ?? "—", r.reorderLevel ?? "—", r.max ?? "—"].join(" / ")}</td>
                  <td className={cx(td, "tabular-nums text-slate-600")}>{r.onOrder ? `${r.onOrder} ${r.purchaseUnit}` : "—"}</td>
                  <td className={td}>
                    <div className="flex items-center gap-1.5">
                      <input value={picked[r.id] ?? String(r.suggested)} onChange={(e) => setPicked((p) => ({ ...p, [r.id]: e.target.value.replace(/[^0-9.]/g, "") }))} className={cx(inputClass, "w-20 py-1 text-right")} aria-label="Order quantity" />
                      <span className="text-xs text-slate-500">{r.purchaseUnit}</span>
                    </div>
                  </td>
                  <td className={cx(td, "text-slate-600")}>{r.supplier ?? "—"}</td>
                  <td className={td}><Badge tone={r.qty <= 0 ? "red" : "amber"}>{r.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ======================= supplier bills & dues ======================= */

interface Bill { id: string; source: string; code: string; supplierId: string; supplier: string; invoiceNo: string; invoiceDate: string | null; dueDate: string | null; amount: number; returns: number; paid: number; balance: number; overdueDays: number; status: string }
interface Dues { bills: Bill[]; suppliers: { supplierId: string; supplier: string; billed: number; returns: number; paid: number; onAccount: number; outstanding: number; overdue: number }[]; totals: { outstanding: number; overdue: number; bills: number } }

function SupplierDues() {
  const toast = useToast();
  const [supplier, setSupplier] = useState<RefOption | null>(null);
  const [open, setOpen] = useState(true);
  const q = useApiQuery<Dues>(`/api/inventory/dues${qs({ supplier: supplier?.id, status: open ? "open" : "" })}`);
  const d = q.data;
  const [paying, setPaying] = useState<Bill | null>(null);

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-64">
          <RefSelect id="dues-supplier" field={{ name: "supplier", label: "All suppliers", type: "ref", ref: "inventory.suppliers" }} value={supplier?.id ?? ""} initial={supplier ?? undefined} className={inputClass} onChange={(v) => !v && setSupplier(null)} onPick={setSupplier} />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} className="size-4 rounded border-slate-300 text-brand-600" /> Unpaid bills only</label>
        <Link href="/m/inventory?tab=supplier_payments" className="ml-auto text-sm font-medium text-brand-700 hover:underline">All vendor payments →</Link>
      </Card>
      {q.loading ? <Spinner /> : q.error ? <Card><ErrorState message={q.error} onRetry={q.reload} /></Card> : d && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Outstanding to suppliers" value={formatMoney(d.totals.outstanding)} icon={<IndianRupee className="size-5" />} />
            <StatCard label="Overdue" value={formatMoney(d.totals.overdue)} tone={d.totals.overdue ? "red" : "slate"} />
            <StatCard label="Open bills" value={d.totals.bills} />
          </div>
          <Card>
            <CardHeader title="Supplier balances" description="Billed (GRNs + pharmacy purchases) − purchase returns − payments." />
            {d.suppliers.length === 0 ? <p className="px-5 py-4 text-sm text-slate-500">No supplier bills yet.</p> : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead><tr>{["Supplier", "Billed", "Returns", "Paid", "On account", "Outstanding", "Overdue"].map((h, i) => <th key={h} className={cx(th, i > 0 && "text-right")}>{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {d.suppliers.map((s) => (
                      <tr key={s.supplierId}>
                        <td className={cx(td, "font-medium text-slate-900")}>{s.supplier}</td>
                        {[s.billed, s.returns, s.paid, s.onAccount].map((v, i) => <td key={i} className={cx(td, "text-right text-slate-600")}>{formatMoney(v)}</td>)}
                        <td className={cx(td, "text-right font-semibold")}>{formatMoney(s.outstanding)}</td>
                        <td className={cx(td, "text-right", s.overdue ? "font-semibold text-red-600" : "text-slate-400")}>{formatMoney(s.overdue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Purchase invoices" description="Due dates follow each supplier's credit period." />
            {d.bills.length === 0 ? <p className="px-5 py-4 text-sm text-slate-500">No {open ? "unpaid " : ""}bills.</p> : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead><tr>{["Bill", "Supplier / invoice", "Due", "Amount", "Returns", "Paid", "Balance", "Status", ""].map((h, i) => <th key={i} className={cx(th, i >= 3 && i <= 6 && "text-right")}>{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.bills.map((b) => (
                      <tr key={b.code}>
                        <td className={td}>
                          {b.source === "GRN" ? <Link href={`/inventory/docs/${b.id}`} className="font-mono text-xs text-brand-700 hover:underline">{b.code}</Link> : <Link href={`/pharmacy/purchases/${b.id}`} className="font-mono text-xs text-brand-700 hover:underline">{b.code}</Link>}
                          <div className="text-[11px] text-slate-500">{b.source}</div>
                        </td>
                        <td className="px-4 py-2.5"><div className="text-slate-900">{b.supplier}</div><div className="text-xs text-slate-500">{b.invoiceNo} · {formatDate(b.invoiceDate)}</div></td>
                        <td className={cx(td, b.overdueDays ? "text-red-600" : "text-slate-600")}>{formatDate(b.dueDate)}{b.overdueDays ? <div className="text-[11px]">{b.overdueDays} days overdue</div> : null}</td>
                        {[b.amount, b.returns, b.paid].map((v, i) => <td key={i} className={cx(td, "text-right tabular-nums text-slate-600")}>{formatMoney(v)}</td>)}
                        <td className={cx(td, "text-right font-semibold tabular-nums")}>{formatMoney(b.balance)}</td>
                        <td className={td}><Badge tone={statusTone(b.status === "Overdue" ? "rejected" : b.status)}>{b.status}</Badge></td>
                        <td className={cx(td, "text-right")}>{b.balance > 0 && <Button variant="secondary" onClick={() => setPaying(b)}><IndianRupee className="size-4" /> Pay</Button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      {paying && <PayBillModal bill={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); toast("Payment recorded"); q.reload(); }} />}
    </div>
  );
}

function PayBillModal({ bill, onClose, onDone }: { bill: Bill; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(bill.balance));
  const [mode, setMode] = useState("Bank Transfer");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/m/inventory/supplier_payments", { method: "POST", body: { supplier: bill.supplierId, billRef: bill.code, paymentDate: date, amount: Number(amount), mode, reference } });
      onDone();
    } catch (e) {
      setError(e instanceof ApiClientError && e.fields ? Object.values(e.fields)[0] : (e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} size="md" title={`Pay ${bill.supplier}`} description={`${bill.code} · invoice ${bill.invoiceNo} · balance ${formatMoney(bill.balance)}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={submit} loading={busy}>Record payment</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
        <Field label="Amount" htmlFor="vp-amt" required><input id="vp-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className={inputClass} /></Field>
        <Field label="Date" htmlFor="vp-date" required><input id="vp-date" type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} className={inputClass} /></Field>
        <Field label="Mode" htmlFor="vp-mode" required>
          <select id="vp-mode" value={mode} onChange={(e) => setMode(e.target.value)} className={inputClass}>{["Bank Transfer", "Cheque", "UPI", "Cash", "Card"].map((m) => <option key={m}>{m}</option>)}</select>
        </Field>
        <Field label="Cheque / UTR no." htmlFor="vp-ref"><input id="vp-ref" value={reference} maxLength={40} onChange={(e) => setReference(e.target.value)} className={inputClass} /></Field>
      </div>
    </Modal>
  );
}

/* ======================= reports ======================= */

const REPORTS = [
  { key: "valuation", label: "Stock valuation" },
  { key: "ledger", label: "Stock ledger" },
  { key: "expiry", label: "Expiry" },
  { key: "consumption", label: "Consumption" },
  { key: "purchases", label: "Purchase register" },
  { key: "non-moving", label: "Non-moving stock" },
] as const;
type ReportKey = (typeof REPORTS)[number]["key"];
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;

function InventoryReports() {
  const params = useSearchParams();
  const initial = REPORTS.find((r) => r.key === params.get("report"))?.key ?? "valuation";
  const [report, setReport] = useState<ReportKey>(initial);
  const [store, setStore] = useState<RefOption | null>(null);
  const [item, setItem] = useState<RefOption | null>(params.get("item") ? { id: params.get("item")!, label: params.get("label") ?? "Selected item" } : null);
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [days, setDays] = useState("90");
  const ranged = report === "ledger" || report === "consumption" || report === "purchases";
  const url = report === "ledger" && !item ? null : `/api/inventory/reports/${report}${qs({ store: store?.id, item: item?.id, from: ranged ? from : undefined, to: ranged ? to : undefined, days: report === "expiry" || report === "non-moving" ? days : undefined })}`;
  const q = useApiQuery<Record<string, unknown>>(url);
  const d = q.data;
  const { headers, rows, csvName } = useMemo(() => reportTable(report, d), [report, d]);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 print:hidden" role="tablist">
        {REPORTS.map((r) => (
          <button key={r.key} role="tab" aria-selected={report === r.key} onClick={() => setReport(r.key)} className={cx("whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium", report === r.key ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900")}>{r.label}</button>
        ))}
      </div>
      <Card className="flex flex-wrap items-end gap-3 p-4 print:hidden">
        {report !== "purchases" && <div className="w-60"><span className="mb-1 block text-xs font-medium text-slate-600">Store</span><StoreSelect value={store} onChange={setStore} /></div>}
        {report === "ledger" && (
          <div className="w-72"><span className="mb-1 block text-xs font-medium text-slate-600">Item</span>
            <RefSelect id="rep-item" field={itemRef} value={item?.id ?? ""} initial={item ?? undefined} className={inputClass} onChange={() => {}} onPick={setItem} />
          </div>
        )}
        {ranged && (
          <>
            <label className="text-xs font-medium text-slate-600">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={cx(inputClass, "mt-1")} /></label>
            <label className="text-xs font-medium text-slate-600">To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={cx(inputClass, "mt-1")} /></label>
          </>
        )}
        {(report === "expiry" || report === "non-moving") && (
          <label className="text-xs font-medium text-slate-600">{report === "expiry" ? "Expiring within (days)" : "No issue for (days)"}
            <select value={days} onChange={(e) => setDays(e.target.value)} className={cx(inputClass, "mt-1 w-40")}>{["30", "60", "90", "180", "365"].map((x) => <option key={x}>{x}</option>)}</select>
          </label>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" disabled={!rows.length} onClick={() => downloadCsv(csvName, headers, rows.map((r) => r.map((c) => (typeof c === "string" || typeof c === "number" ? c : ""))))}><FileSpreadsheet className="size-4" /> CSV</Button>
          <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
        </div>
      </Card>
      <h2 className="hidden text-lg font-bold print:block">{REPORTS.find((r) => r.key === report)?.label}{ranged ? ` · ${formatDate(from)} – ${formatDate(to)}` : ""}{store ? ` · ${store.label}` : ""}</h2>
      {report === "ledger" && !item ? <Card><EmptyState title="Choose an item" description="The ledger shows every movement of one item with a running balance." /></Card>
        : q.loading ? <Spinner label="Preparing report…" /> : q.error ? <Card><ErrorState message={q.error} onRetry={q.reload} /></Card> : d ? (
          <>
            <ReportSummary report={report} d={d} />
            <Card>
              {rows.length === 0 ? <EmptyState title="Nothing to report" /> : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-100 text-sm">
                    <thead className="bg-slate-50/60"><tr>{headers.map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums">
                      {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={cx(td, "text-slate-700")}>{c as ReactNode}</td>)}</tr>)}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        ) : null}
    </div>
  );
}

function ReportSummary({ report, d }: { report: ReportKey; d: Record<string, unknown> }) {
  if (report === "valuation") {
    const cats = d.byCategory as { category: string; qty: number; value: number }[];
    return (
      <Card>
        <CardHeader title="By category" />
        <div className="flex flex-wrap gap-x-8 gap-y-2 px-5 py-4 text-sm">{cats.map((c) => <span key={c.category}><span className="text-slate-500">{c.category}:</span> <span className="font-semibold tabular-nums">{formatMoney(c.value)}</span></span>)}</div>
      </Card>
    );
  }
  if (report === "ledger") return <div className="grid gap-4 sm:grid-cols-2"><StatCard label="Opening balance" value={String(d.opening)} /><StatCard label="Closing balance" value={String(d.closing)} /></div>;
  if (report === "purchases") {
    const t = d.totals as { grns: number; taxable: number; gst: number; net: number };
    return <div className="grid gap-4 sm:grid-cols-4"><StatCard label="GRNs" value={t.grns} /><StatCard label="Taxable" value={formatMoney(t.taxable)} /><StatCard label="GST" value={formatMoney(t.gst)} /><StatCard label="Net purchases" value={formatMoney(t.net)} /></div>;
  }
  if (report === "consumption") {
    const deps = d.byDepartment as { department: string; issues: number; qty: number; value: number }[];
    return (
      <Card>
        <CardHeader title="By department" description="Department issues and patient issues at cost" />
        <div className="flex flex-wrap gap-x-8 gap-y-2 px-5 py-4 text-sm">{deps.length ? deps.map((x) => <span key={x.department}><span className="text-slate-500">{x.department} ({x.issues}):</span> <span className="font-semibold tabular-nums">{formatMoney(x.value)}</span></span>) : <span className="text-slate-500">No issues in this period.</span>}</div>
      </Card>
    );
  }
  return null;
}

function reportTable(report: ReportKey, d: Record<string, unknown> | undefined): { headers: string[]; rows: (string | number | ReactNode)[][]; csvName: string } {
  const csvName = `inventory-${report}_${today()}.csv`;
  if (!d) return { headers: [], rows: [], csvName };
  switch (report) {
    case "valuation":
      return { csvName, headers: ["Store", "Type", "Items", "Qty", "Value (cost)", "Value (MRP)"], rows: (d.byStore as Record<string, number | string>[]).map((s) => [s.store, s.type, s.items, s.qty, formatMoney(s.value), formatMoney(s.mrpValue)]) };
    case "ledger":
      return {
        csvName, headers: ["Date", "Store", "Transaction", "Document", "Batch", "In", "Out", "Balance", "Party", "By"],
        rows: (d.rows as Record<string, string | number | null>[]).map((r) => [formatDateTime(String(r.at)), r.store, r.txn, r.docCode, r.batchNo, r.in || "", r.out || "", r.balance, r.party ?? "", r.byName]),
      };
    case "expiry":
      return { csvName, headers: ["Item", "Store", "Batch", "Expiry", "Days left", "Qty", "Value", "Status"], rows: (d.rows as Record<string, string | number>[]).map((r) => [r.item, r.store, r.batchNo, formatDate(String(r.expiryDate)), r.daysLeft, r.qty, formatMoney(Number(r.value)), r.status]) };
    case "consumption":
      return { csvName, headers: ["Item", "Qty issued", "Value (cost)"], rows: (d.byItem as Record<string, string | number>[]).map((r) => [r.item, r.qty, formatMoney(Number(r.value))]) };
    case "purchases":
      return {
        csvName, headers: ["GRN", "Date", "Supplier", "Invoice", "Store", "PO", "Taxable", "GST", "Net", "Status"],
        rows: (d.rows as Record<string, string | number | null>[]).map((r) => [r.code, formatDate(String(r.date)), r.supplier, r.invoiceNo, r.store, r.poCode ?? "", formatMoney(Number(r.taxable)), formatMoney(Number(r.gst)), formatMoney(Number(r.net)), r.status]),
      };
    case "non-moving":
      return { csvName, headers: ["Item", "SKU", "Qty", "Value", "Last issued"], rows: (d.rows as Record<string, string | number | null>[]).map((r) => [r.item, r.sku ?? "", r.qty, formatMoney(Number(r.value)), r.lastIssue ? formatDate(String(r.lastIssue)) : "Never"]) };
  }
}
