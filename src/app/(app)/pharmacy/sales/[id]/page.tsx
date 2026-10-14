"use client";

import { ArrowLeft, Ban, IndianRupee, Plus, Printer } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { CancelModal } from "@/components/pharmacy/CancelModal";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Kbd, Modal, Spinner, inputClass, statusTone, useHotkeys, useToast } from "@/components/ui";
import { amountInWords } from "@/lib/billing-math";
import { ApiClientError, api } from "@/lib/client";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { PAYMENT_MODES } from "@/lib/modules";
import { useApiQuery } from "@/lib/useApi";
import { PayOnlineButton } from "@/components/payments/Razorpay";

interface SaleLine {
  itemName: string;
  hsnCode?: string;
  batchNo: string;
  expiryDate: string | null;
  qty: number;
  mrp: number;
  discountPct: number;
  gstRate: number;
  taxable: number;
  gst: number;
  amount: number;
}
interface Sale {
  id: string;
  code: string;
  billDate: string;
  patient?: string;
  customerName: string;
  customerPhone?: string;
  doctorName?: string;
  paymentMode: string;
  items: SaleLine[];
  grossTotal: number;
  discountTotal: number;
  taxableTotal: number;
  gstTotal: number;
  roundOff: number;
  netAmount: number;
  paidAmount: number;
  status: string;
  notes?: string;
  cancelReason?: string;
  cancelledAt?: string;
  createdByName?: string;
  createdAt: string;
  store: { name: string; address: string; phone: string; gstin: string; drugLicense: string };
}

export default function SaleBillPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const q = useApiQuery<Sale>(`/api/pharmacy/sales/${id}`);
  const [updated, setUpdated] = useState<Sale | null>(null);
  const sale = updated?.id === id ? updated : q.data;
  const [dialog, setDialog] = useState<"pay" | "cancel" | null>(null);

  useHotkeys({ F2: () => router.push("/pharmacy/new"), "ctrl+p": () => window.print() }, !dialog);

  const back = (
    <Link href="/pharmacy" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 print:hidden">
      <ArrowLeft className="size-4" /> Back to pharmacy
    </Link>
  );
  if (q.error) return <>{back}<Card>{q.status === 404 ? <EmptyState title="Bill not found" /> : <ErrorState message={q.error} onRetry={q.reload} />}</Card></>;
  if (!sale) return <>{back}<Spinner label="Loading bill…" /></>;

  const balance = Math.max(0, sale.netAmount - sale.paidAmount);
  const gstByRate = Object.values(
    sale.items.reduce<Record<number, { rate: number; taxable: number; gst: number }>>((acc, l) => {
      acc[l.gstRate] ??= { rate: l.gstRate, taxable: 0, gst: 0 };
      acc[l.gstRate].taxable += l.taxable;
      acc[l.gstRate].gst += l.gst;
      return acc;
    }, {})
  );
  const cancelled = sale.status === "Cancelled";

  return (
    <>
      {back}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">Bill {sale.code}</h1>
          <Badge tone={statusTone(sale.status)}>{sale.status}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {!cancelled && balance > 0 && <Button variant="secondary" onClick={() => setDialog("pay")}><IndianRupee className="size-4" /> Receive payment</Button>}
          {!cancelled && <PayOnlineButton kind="pharmacy_sale" id={sale.id} due={balance} onPaid={() => api<Sale>(`/api/pharmacy/sales/${sale.id}`).then(({ data }) => { setUpdated(data); toast("Online payment received and recorded"); }, () => q.reload())} />}
          {!cancelled && <Button variant="secondary" className="text-red-600" onClick={() => setDialog("cancel")}><Ban className="size-4" /> Cancel bill</Button>}
          <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" /> Print <Kbd>Ctrl+P</Kbd></Button>
          <Link href="/pharmacy/new"><Button><Plus className="size-4" /> New bill <Kbd>F2</Kbd></Button></Link>
        </div>
      </div>

      {cancelled && (
        <div className="mb-4 print:hidden">
          <Alert tone="amber">Cancelled {formatDateTime(sale.cancelledAt)} — stock was returned. Reason: {sale.cancelReason}</Alert>
        </div>
      )}

      <Card className="mx-auto max-w-4xl p-8 print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <div className="relative">
          {cancelled && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-bold uppercase tracking-widest text-red-500/15 -rotate-12">Cancelled</div>}
          <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-slate-800 pb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">{sale.store.name}</h2>
              {sale.store.address && <p className="text-sm text-slate-600">{sale.store.address}</p>}
              <p className="text-xs text-slate-600">
                {[sale.store.phone && `Ph: ${sale.store.phone}`, sale.store.gstin && `GSTIN: ${sale.store.gstin}`, sale.store.drugLicense && `D.L. No: ${sale.store.drugLicense}`].filter(Boolean).join("  ·  ")}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold uppercase tracking-wide text-slate-900">Tax Invoice</p>
              <p className="font-mono text-sm text-slate-800">{sale.code}</p>
              <p className="text-sm text-slate-600">Date: {formatDate(sale.billDate)}</p>
            </div>
          </header>

          <section className="grid grid-cols-2 gap-4 border-b border-slate-200 py-3 text-sm">
            <div>
              <p className="text-xs uppercase text-slate-500">Bill to</p>
              <p className="font-semibold text-slate-900">{sale.customerName}</p>
              {sale.customerPhone && <p className="text-slate-600">{sale.customerPhone}</p>}
              {sale.patient && (
                <Link href={`/patients/${sale.patient}`} className="text-xs text-brand-700 hover:underline print:hidden">Open patient record</Link>
              )}
            </div>
            <div className="text-right">
              {sale.doctorName && <><p className="text-xs uppercase text-slate-500">Prescribed by</p><p className="font-medium text-slate-900">Dr. {sale.doctorName.replace(/^Dr\.?\s*/i, "")}</p></>}
              <p className="mt-1 text-xs text-slate-500">Payment: {sale.paymentMode}</p>
            </div>
          </section>

          <table className="mt-3 w-full text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left uppercase text-slate-500">
                <th className="py-1.5 pr-2">#</th>
                <th className="py-1.5 pr-2">Item</th>
                <th className="py-1.5 pr-2">HSN</th>
                <th className="py-1.5 pr-2">Batch</th>
                <th className="py-1.5 pr-2">Exp</th>
                <th className="py-1.5 pr-2 text-right">Qty</th>
                <th className="py-1.5 pr-2 text-right">MRP</th>
                <th className="py-1.5 pr-2 text-right">Disc%</th>
                <th className="py-1.5 pr-2 text-right">GST%</th>
                <th className="py-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {sale.items.map((l, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1.5 pr-2 text-slate-500">{i + 1}</td>
                  <td className="py-1.5 pr-2 font-medium text-slate-900">{l.itemName}</td>
                  <td className="py-1.5 pr-2 text-slate-600">{l.hsnCode ?? ""}</td>
                  <td className="py-1.5 pr-2 font-mono text-slate-600">{l.batchNo}</td>
                  <td className="py-1.5 pr-2 text-slate-600">{l.expiryDate ? new Date(l.expiryDate).toLocaleDateString("en-IN", { month: "2-digit", year: "2-digit", timeZone: "UTC" }) : ""}</td>
                  <td className="py-1.5 pr-2 text-right">{l.qty}</td>
                  <td className="py-1.5 pr-2 text-right">{l.mrp.toFixed(2)}</td>
                  <td className="py-1.5 pr-2 text-right">{l.discountPct ? l.discountPct : ""}</td>
                  <td className="py-1.5 pr-2 text-right">{l.gstRate}</td>
                  <td className="py-1.5 text-right font-medium text-slate-900">{l.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 print:grid-cols-2">
            <div className="text-xs">
              <table className="w-full tabular-nums">
                <thead>
                  <tr className="border-b border-slate-200 text-left uppercase text-slate-500">
                    <th className="py-1">GST %</th><th className="py-1 text-right">Taxable</th><th className="py-1 text-right">CGST</th><th className="py-1 text-right">SGST</th>
                  </tr>
                </thead>
                <tbody>
                  {gstByRate.map((g) => (
                    <tr key={g.rate}>
                      <td className="py-0.5">{g.rate}%</td>
                      <td className="py-0.5 text-right">{g.taxable.toFixed(2)}</td>
                      <td className="py-0.5 text-right">{(g.gst / 2).toFixed(2)}</td>
                      <td className="py-0.5 text-right">{(g.gst / 2).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 font-medium text-slate-800">{amountInWords(sale.netAmount)}</p>
              {sale.notes && <p className="mt-2 text-slate-600">Note: {sale.notes}</p>}
            </div>
            <dl className="space-y-1 text-sm tabular-nums">
              <div className="flex justify-between"><dt className="text-slate-600">Gross</dt><dd>{sale.grossTotal.toFixed(2)}</dd></div>
              {sale.discountTotal > 0 && <div className="flex justify-between"><dt className="text-slate-600">Discount</dt><dd>-{sale.discountTotal.toFixed(2)}</dd></div>}
              <div className="flex justify-between text-slate-500"><dt>Taxable</dt><dd>{sale.taxableTotal.toFixed(2)}</dd></div>
              <div className="flex justify-between text-slate-500"><dt>GST (incl.)</dt><dd>{sale.gstTotal.toFixed(2)}</dd></div>
              <div className="flex justify-between text-slate-500"><dt>Round off</dt><dd>{sale.roundOff.toFixed(2)}</dd></div>
              <div className="flex justify-between border-t-2 border-slate-800 pt-1 text-base font-bold text-slate-900"><dt>Net amount</dt><dd>{formatMoney(sale.netAmount)}</dd></div>
              <div className="flex justify-between text-slate-600"><dt>Received</dt><dd>{formatMoney(sale.paidAmount)}</dd></div>
              {balance > 0 && <div className="flex justify-between font-semibold text-amber-700"><dt>Balance due</dt><dd>{formatMoney(balance)}</dd></div>}
            </dl>
          </div>

          <footer className="mt-8 flex items-end justify-between border-t border-slate-200 pt-3 text-xs text-slate-500">
            <p>Goods once sold will be taken back only as per pharmacy policy. Billed by {sale.createdByName ?? "—"} · {formatDateTime(sale.createdAt)}</p>
            <p className="text-right">Authorised signatory</p>
          </footer>
        </div>
      </Card>

      {dialog === "pay" && <PaymentModal sale={sale} balance={balance} onClose={() => setDialog(null)} onDone={(s) => { setUpdated({ ...s, store: sale.store }); setDialog(null); toast("Payment recorded"); }} />}
      {dialog === "cancel" && <CancelModal url={`/api/pharmacy/sales/${sale.id}/cancel`} label={`bill ${sale.code}`} note="All items will be returned to stock." onClose={() => setDialog(null)} onDone={(s) => { setUpdated({ ...(s as Sale), store: sale.store }); setDialog(null); toast("Bill cancelled — stock returned"); }} />}
    </>
  );
}

function PaymentModal({ sale, balance, onClose, onDone }: { sale: Sale; balance: number; onClose: () => void; onDone: (s: Sale) => void }) {
  const [amount, setAmount] = useState(String(balance));
  const [mode, setMode] = useState(sale.paymentMode === "Credit" ? "Cash" : sale.paymentMode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api<Sale>(`/api/pharmacy/sales/${sale.id}`, { method: "PATCH", body: { amount: Number(amount), paymentMode: mode } });
      onDone(data);
    } catch (e) {
      setError(e instanceof ApiClientError && e.fields ? Object.values(e.fields)[0] : (e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} size="md" title="Receive payment" description={`Balance due ${formatMoney(balance)} on ${sale.code}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={submit} loading={busy}>Record payment</Button></>}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Amount" htmlFor="pay-amt" required>
          <input id="pay-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className={inputClass} />
        </Field>
        <Field label="Mode" htmlFor="pay-mode" required>
          <select id="pay-mode" value={mode} onChange={(e) => setMode(e.target.value)} className={inputClass}>
            {PAYMENT_MODES.filter((m) => m !== "Credit").map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
