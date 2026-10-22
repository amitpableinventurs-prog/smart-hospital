"use client";

import { Download, FileJson, FileSpreadsheet, Plus, Printer, RefreshCw, Search, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { GST_STATE_OPTIONS, MONEY_MODES, VOUCHER_TYPES, drCr, fyStart } from "@/lib/accounts-shared";
import { api, qs } from "@/lib/client";
import { downloadCsv } from "@/lib/csv";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { RefSelect, type RefOption } from "../RecordForm";
import { TableCard } from "../TableCard";
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Kbd, Pagination, Spinner, StatCard, cx, inputClass, useDebounced, useHotkeys, useToast } from "../ui";
import { VOUCHER_KEYS, VOUCHER_TONE, type Voucher } from "./types";

/** Bespoke Accounts tabs: day book, books, final accounts, GST returns and settings. */
export function AccountsSection({ section }: { section: string }) {
  switch (section) {
    case "ledger":
      return <LedgerStatement />;
    case "cashbank":
      return <CashBank />;
    case "outstanding":
      return <Outstanding />;
    case "trial":
      return <TrialBalance />;
    case "pl":
      return <ProfitLoss />;
    case "bs":
      return <BalanceSheet />;
    case "gstr1":
      return <Gstr1 />;
    case "gstr3b":
      return <Gstr3b />;
    case "itc":
      return <ItcRegister />;
    case "settings":
      return <Settings />;
    default:
      return <DayBook />;
  }
}

const th = "whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
const thr = cx(th, "text-right");
const td = "whitespace-nowrap px-4 py-2.5";
const tdr = cx(td, "text-right tabular-nums");
const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => today().slice(0, 7);
const money = (n: number) => (n ? formatMoney(n) : "");
const ledgerHref = (id: string, from?: string, to?: string) => `/m/accounts${qs({ tab: "ledger", ledger: id, from, to })}`;

function Loading<T>({ q, children, label }: { q: { data?: T; error: string | null; loading: boolean; reload: () => void }; children: (d: T) => React.ReactNode; label?: string }) {
  if (q.loading) return <Spinner label={label} />;
  if (q.error) return <Card><ErrorState message={q.error} onRetry={q.reload} /></Card>;
  return q.data !== undefined ? <>{children(q.data)}</> : null;
}

function Toolbar({ children, actions }: { children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      {children}
      <div className="ml-auto flex flex-wrap gap-2">
        {actions}
        <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
      </div>
    </div>
  );
}

function DateInput({ label, value, onChange, min, max }: { label: string; value: string; onChange: (v: string) => void; min?: string; max?: string }) {
  return <label className="text-xs font-medium text-slate-600">{label}<input type="date" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} className={cx(inputClass, "mt-1")} /></label>;
}

function useRange() {
  const sp = useSearchParams();
  const [from, setFrom] = useState(sp.get("from") ?? fyStart());
  const [to, setTo] = useState(sp.get("to") ?? today());
  const inputs = (
    <>
      <DateInput label="From" value={from} max={to} onChange={setFrom} />
      <DateInput label="To" value={to} min={from} onChange={setTo} />
    </>
  );
  return { from, to, inputs };
}

function MonthInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <label className="text-xs font-medium text-slate-600">Return period<input type="month" value={value} max={thisMonth()} onChange={(e) => e.target.value && onChange(e.target.value)} className={cx(inputClass, "mt-1")} /></label>;
}

/* ======================= Day Book ======================= */

interface DayBookData {
  rows: Voucher[];
  byType: { type: string; count: number; amount: number }[];
}

function DayBook() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [origin, setOrigin] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const q = useApiQuery<DayBookData>(`/api/accounts/vouchers${qs({ search: debounced, type, origin, status, from, to, page })}`);
  const keys: Record<string, () => void> = {};
  for (const [t, k] of Object.entries(VOUCHER_KEYS)) keys[k] = () => router.push(`/accounts/vouchers/new?type=${encodeURIComponent(t)}`);
  useHotkeys(keys);
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  const rows = q.data?.rows ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        {VOUCHER_TYPES.map((t) => (
          <Link key={t} href={`/accounts/vouchers/new?type=${encodeURIComponent(t)}`}>
            <Button variant="secondary"><Plus className="size-4" /> {t} {VOUCHER_KEYS[t] && <Kbd>{VOUCHER_KEYS[t]}</Kbd>}</Button>
          </Link>
        ))}
      </div>
      <Card>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-6 print:hidden">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={search} onChange={(e) => reset(setSearch)(e.target.value)} placeholder="Voucher no., ledger, narration, bill no…" className={cx(inputClass, "pl-9")} aria-label="Search vouchers" />
          </div>
          <select value={type} onChange={(e) => reset(setType)(e.target.value)} className={inputClass} aria-label="Voucher type">
            <option value="">All types</option>
            {VOUCHER_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select value={origin} onChange={(e) => reset(setOrigin)(e.target.value)} className={inputClass} aria-label="Origin">
            <option value="">Automatic & manual</option>
            <option value="auto">Automatic (from modules)</option>
            <option value="manual">Entered in Accounts</option>
          </select>
          <input type="date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} className={inputClass} aria-label="From date" />
          <input type="date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} className={inputClass} aria-label="To date" />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-xs text-slate-600">
          {(q.data?.byType ?? []).map((t) => <Badge key={t.type} tone={VOUCHER_TONE[t.type] ?? "slate"}>{t.type}: {t.count} · {formatMoney(t.amount)}</Badge>)}
          <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={cx(inputClass, "ml-auto w-auto py-1 text-xs")} aria-label="Status">
            <option value="">Active</option>
            <option value="Cancelled">Cancelled</option>
            <option value="all">All</option>
          </select>
        </div>
        {q.loading ? (
          <Spinner label="Posting and loading vouchers…" />
        ) : q.error ? (
          <ErrorState message={q.error} onRetry={q.reload} />
        ) : rows.length === 0 ? (
          <EmptyState title="No vouchers in this period" description="Bills, pharmacy sales, purchases and payments post here automatically. Enter other income and expenses with the buttons above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/60"><tr><th className={th}>Date</th><th className={th}>Voucher</th><th className={th}>Particulars</th><th className={th}>Narration</th><th className={thr}>Amount</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((v) => {
                  const dr = v.entries.filter((e) => e.dr > 0);
                  const cr = v.entries.filter((e) => e.cr > 0);
                  return (
                    <tr key={v.id} onClick={() => router.push(`/accounts/vouchers/${v.id}`)} className={cx("cursor-pointer hover:bg-brand-50/40", v.status === "Cancelled" && "opacity-50 line-through")}>
                      <td className={cx(td, "text-slate-600")}>{formatDate(v.date)}</td>
                      <td className={td}>
                        <span className="font-mono text-xs text-brand-700">{v.code}</span>
                        <span className="mt-0.5 flex gap-1"><Badge tone={VOUCHER_TONE[v.type] ?? "slate"}>{v.type}</Badge>{v.auto && <Badge tone="slate">Auto</Badge>}</span>
                      </td>
                      <td className={cx(td, "max-w-xs whitespace-normal")}>
                        <span className="block font-medium text-slate-900">{dr.map((e) => e.ledger).join(", ")} <span className="text-xs font-normal text-slate-500">Dr</span></span>
                        <span className="block pl-4 text-slate-600">To {cr.map((e) => e.ledger).join(", ")}</span>
                      </td>
                      <td className={cx(td, "max-w-sm truncate text-slate-600")} title={v.narration}>{v.narration}</td>
                      <td className={tdr}>{formatMoney(v.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!q.loading && !q.error && <Pagination pagination={q.pagination} onPage={setPage} />}
      </Card>
    </div>
  );
}

/* ======================= Ledger statement ======================= */

interface Statement {
  ledger: { id: string; name: string; group: string; gstin: string | null; phone: string | null; nature: string };
  from: string;
  to: string;
  opening: number;
  rows: { id: string; date: string; code: string; type: string; auto: boolean; particulars: string; narration: string; dr: number; cr: number; balance: number }[];
  dr: number;
  cr: number;
  closing: number;
}

const ledgerField = { name: "ledger", label: "Ledger", type: "ref" as const, ref: "accounts.ledgers", required: true };

function LedgerStatement() {
  const sp = useSearchParams();
  const router = useRouter();
  const [ledger, setLedger] = useState(sp.get("ledger") ?? "");
  const [picked, setPicked] = useState<RefOption | undefined>();
  const { from, to, inputs } = useRange();
  const q = useApiQuery<Statement>(ledger ? `/api/accounts/reports/ledger${qs({ ledger, from, to })}` : null);
  const initial = picked ?? (q.data && q.data.ledger.id === ledger ? { id: ledger, label: q.data.ledger.name } : undefined);
  function exportCsv(d: Statement) {
    downloadCsv(`ledger_${d.ledger.name}_${d.from}_${d.to}.csv`, ["Date", "Voucher", "Type", "Particulars", "Narration", "Debit", "Credit", "Balance"], [
      [d.from, "", "", "Opening balance", "", "", "", drCr(d.opening)],
      ...d.rows.map((r) => [r.date.slice(0, 10), r.code, r.type, r.particulars, r.narration, r.dr || "", r.cr || "", drCr(r.balance)]),
      [d.to, "", "", "Closing balance", "", d.dr, d.cr, drCr(d.closing)],
    ]);
  }
  return (
    <div className="space-y-4">
      <Toolbar actions={q.data && <Button variant="secondary" onClick={() => exportCsv(q.data!)}><FileSpreadsheet className="size-4" /> CSV</Button>}>
        <div className="w-full sm:w-80">
          <span className="text-xs font-medium text-slate-600">Ledger</span>
          <div className="mt-1"><RefSelect id="stmt-ledger" field={ledgerField} value={ledger} initial={initial} onChange={setLedger} onPick={(o) => setPicked(o ?? undefined)} className={inputClass} /></div>
        </div>
        {inputs}
      </Toolbar>
      {!ledger ? (
        <Card><EmptyState title="Choose a ledger" description="Pick any ledger — cash, bank, a supplier, an income or expense head — to see its statement with running balance." /></Card>
      ) : (
        <Loading q={q} label="Preparing statement…">
          {(d) => (
            <Card>
              <CardHeader title={d.ledger.name} description={`${d.ledger.group}${d.ledger.gstin ? ` · GSTIN ${d.ledger.gstin}` : ""} · ${formatDate(d.from)} to ${formatDate(d.to)}`} />
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50/60"><tr><th className={th}>Date</th><th className={th}>Particulars</th><th className={th}>Voucher</th><th className={thr}>Debit</th><th className={thr}>Credit</th><th className={thr}>Balance</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr className="bg-slate-50/40 font-medium"><td className={td}>{formatDate(d.from)}</td><td className={td} colSpan={4}>Opening balance</td><td className={tdr}>{drCr(d.opening)}</td></tr>
                    {d.rows.map((r) => (
                      <tr key={r.id} onClick={() => router.push(`/accounts/vouchers/${r.id}`)} className="cursor-pointer hover:bg-brand-50/40">
                        <td className={cx(td, "text-slate-600")}>{formatDate(r.date)}</td>
                        <td className={cx(td, "max-w-md whitespace-normal")}><span className="font-medium text-slate-900">{r.dr ? "To " : "By "}{r.particulars}</span>{r.narration && <span className="block text-xs text-slate-500">{r.narration}</span>}</td>
                        <td className={td}><span className="font-mono text-xs text-brand-700">{r.code}</span><span className="block text-xs text-slate-500">{r.type}</span></td>
                        <td className={tdr}>{money(r.dr)}</td>
                        <td className={tdr}>{money(r.cr)}</td>
                        <td className={tdr}>{drCr(r.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 font-semibold"><td className={td} colSpan={3}>Totals · closing balance</td><td className={tdr}>{formatMoney(d.dr)}</td><td className={tdr}>{formatMoney(d.cr)}</td><td className={tdr}>{drCr(d.closing)}</td></tr>
                  </tfoot>
                </table>
              </div>
              {d.rows.length === 0 && <p className="p-4 text-center text-sm text-slate-500">No entries in this period.</p>}
            </Card>
          )}
        </Loading>
      )}
    </div>
  );
}

/* ======================= Cash & Bank ======================= */

interface CashBankData {
  from: string;
  to: string;
  rows: { id: string; name: string; group: string; opening: number; receipts: number; payments: number; closing: number }[];
  totals: { opening: number; receipts: number; payments: number; closing: number };
}

function CashBank() {
  const { from, to, inputs } = useRange();
  const q = useApiQuery<CashBankData>(`/api/accounts/reports/cashbank${qs({ from, to })}`);
  return (
    <div className="space-y-4">
      <Toolbar>{inputs}</Toolbar>
      <Loading q={q} label="Totalling cash and bank…">
        {(d) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Opening" value={drCr(d.totals.opening)} tone="slate" />
              <StatCard label="Received" value={formatMoney(d.totals.receipts)} />
              <StatCard label="Paid out" value={formatMoney(d.totals.payments)} tone="amber" />
              <StatCard label="Closing" value={drCr(d.totals.closing)} hint="Cash in hand + bank balances" />
            </div>
            <TableCard
              title="Cash & bank ledgers"
              description="Open a ledger for its cash book / bank book with running balance. Set which ledger each payment mode posts to in Accounts Settings."
              headers={["Ledger", "Group", "Opening", "Receipts", "Payments", "Closing"]}
              rows={d.rows.map((r) => [<Link key={r.id} href={ledgerHref(r.id, d.from, d.to)} className="font-medium text-brand-700 hover:underline">{r.name}</Link>, r.group, drCr(r.opening), formatMoney(r.receipts), formatMoney(r.payments), drCr(r.closing)])}
              empty="No cash or bank ledgers."
            />
          </>
        )}
      </Loading>
    </div>
  );
}

/* ======================= Receivables & payables ======================= */

interface OutstandingData {
  asOf: string;
  receivables: { id: string; name: string; group: string; gstin: string | null; phone: string | null; balance: number }[];
  payables: { id: string; name: string; group: string; gstin: string | null; phone: string | null; balance: number }[];
  totals: { receivables: number; payables: number };
}

function Outstanding() {
  const [to, setTo] = useState(today);
  const q = useApiQuery<OutstandingData>(`/api/accounts/reports/outstanding${qs({ to })}`);
  const table = (rows: OutstandingData["receivables"], d: OutstandingData) =>
    rows.map((r) => [<Link key={r.id} href={ledgerHref(r.id, undefined, d.asOf)} className="font-medium text-brand-700 hover:underline">{r.name}</Link>, r.group, r.gstin ?? "—", r.phone ?? "—", formatMoney(r.balance)]);
  return (
    <div className="space-y-4">
      <Toolbar actions={q.data && (
        <Button variant="secondary" onClick={() => {
          const d = q.data!;
          downloadCsv(`outstanding_${d.asOf}.csv`, ["Type", "Party", "Group", "GSTIN", "Phone", "Balance"], [...d.receivables.map((r) => ["Receivable", r.name, r.group, r.gstin, r.phone, r.balance]), ...d.payables.map((r) => ["Payable", r.name, r.group, r.gstin, r.phone, r.balance])]);
        }}><FileSpreadsheet className="size-4" /> CSV</Button>
      )}>
        <DateInput label="As on" value={to} onChange={setTo} max={today()} />
      </Toolbar>
      <Loading q={q} label="Working out balances…">
        {(d) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard label="To receive (Sundry Debtors)" value={formatMoney(d.totals.receivables)} hint="Patients, corporates, insurers and other customers" />
              <StatCard label="To pay (Sundry Creditors)" value={formatMoney(d.totals.payables)} hint="Suppliers and other creditors" tone="amber" />
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <TableCard title="Receivables" description="Patient-wise dues are in Billing → Outstanding Dues." headers={["Party", "Group", "GSTIN", "Phone", "Balance"]} rows={table(d.receivables, d)} empty="Nothing to receive." />
              <TableCard title="Payables" description="Bill-wise supplier dues are in Inventory → Supplier Bills & Dues." headers={["Party", "Group", "GSTIN", "Phone", "Balance"]} rows={table(d.payables, d)} empty="Nothing to pay." />
            </div>
          </>
        )}
      </Loading>
    </div>
  );
}

/* ======================= Trial balance ======================= */

interface TrialData {
  from: string;
  to: string;
  sections: { key: string; name: string; rows: { id: string; name: string; group: string; opening: number; dr: number; cr: number; closing: number }[]; opening: number; dr: number; cr: number; closing: number }[];
  totals: { opening: number; dr: number; cr: number; closingDr: number; closingCr: number };
  difference: number;
}

function TrialBalance() {
  const { from, to, inputs } = useRange();
  const q = useApiQuery<TrialData>(`/api/accounts/reports/trial${qs({ from, to })}`);
  function exportCsv(d: TrialData) {
    downloadCsv(`trial-balance_${d.from}_${d.to}.csv`, ["Group", "Ledger", "Opening", "Debit", "Credit", "Closing Dr", "Closing Cr"],
      d.sections.flatMap((s) => (s.rows.length ? s.rows : [{ name: s.name, group: s.name, opening: s.opening, dr: s.dr, cr: s.cr, closing: s.closing }]).map((r) => [s.name, r.name, r.opening, r.dr, r.cr, r.closing > 0 ? r.closing : "", r.closing < 0 ? -r.closing : ""])));
  }
  return (
    <div className="space-y-4">
      <Toolbar actions={q.data && <Button variant="secondary" onClick={() => exportCsv(q.data!)}><FileSpreadsheet className="size-4" /> CSV</Button>}>{inputs}</Toolbar>
      <Loading q={q} label="Preparing trial balance…">
        {(d) => (
          <Card>
            <CardHeader title="Trial Balance" description={`${formatDate(d.from)} to ${formatDate(d.to)} · income and expenses for the period only; closing stock is shown in the P&L and balance sheet`} />
            {d.difference !== 0 && <div className="px-5 pt-4"><Alert tone="amber">Debit and credit closing balances differ by {formatMoney(Math.abs(d.difference))}. Check the opening balances of your ledgers (they must total the same on both sides).</Alert></div>}
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50/60"><tr><th className={th}>Particulars</th><th className={thr}>Opening</th><th className={thr}>Debit</th><th className={thr}>Credit</th><th className={thr}>Closing Dr</th><th className={thr}>Closing Cr</th></tr></thead>
                {d.sections.map((s) => (
                  <tbody key={s.key} className="border-b border-slate-100">
                    <tr className="bg-slate-50/40 font-semibold text-slate-900"><td className={td}>{s.name}</td><td className={tdr}>{drCr(s.opening)}</td><td className={tdr}>{money(s.dr)}</td><td className={tdr}>{money(s.cr)}</td><td className={tdr}>{s.closing > 0 ? formatMoney(s.closing) : ""}</td><td className={tdr}>{s.closing < 0 ? formatMoney(-s.closing) : ""}</td></tr>
                    {s.rows.map((r) => (
                      <tr key={r.id} className="hover:bg-brand-50/40">
                        <td className={cx(td, "pl-8")}><Link href={ledgerHref(r.id, d.from, d.to)} className="text-slate-800 hover:text-brand-700 hover:underline">{r.name}</Link>{r.group !== s.name && <span className="ml-2 text-xs text-slate-400">{r.group}</span>}</td>
                        <td className={cx(tdr, "text-slate-500")}>{r.opening ? drCr(r.opening) : ""}</td>
                        <td className={tdr}>{money(r.dr)}</td>
                        <td className={tdr}>{money(r.cr)}</td>
                        <td className={tdr}>{r.closing > 0 ? formatMoney(r.closing) : ""}</td>
                        <td className={tdr}>{r.closing < 0 ? formatMoney(-r.closing) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
                <tfoot>
                  <tr className="border-t-2 border-slate-300 font-semibold"><td className={td}>Grand total</td><td className={tdr}>{drCr(d.totals.opening)}</td><td className={tdr}>{formatMoney(d.totals.dr)}</td><td className={tdr}>{formatMoney(d.totals.cr)}</td><td className={tdr}>{formatMoney(d.totals.closingDr)}</td><td className={tdr}>{formatMoney(d.totals.closingCr)}</td></tr>
                </tfoot>
              </table>
            </div>
          </Card>
        )}
      </Loading>
    </div>
  );
}

/* ======================= Profit & Loss ======================= */

interface NominalBlock {
  rows: { id: string; name: string; group: string; amount: number }[];
  total: number;
}
interface PlData {
  from: string;
  to: string;
  openingStock: number;
  stockIntroduced: number;
  closingStock: number;
  sales: NominalBlock;
  directIncome: NominalBlock;
  purchases: NominalBlock;
  directExpenses: NominalBlock;
  indirectIncome: NominalBlock;
  indirectExpenses: NominalBlock;
  grossProfit: number;
  netProfit: number;
}

type TRow = { label: string; amount: number; href?: string; strong?: boolean; indent?: boolean };

/** Tally-style two-sided statement. */
function TStatement({ left, right, leftTitle, rightTitle }: { left: TRow[]; right: TRow[]; leftTitle: string; rightTitle: string }) {
  const side = (rows: TRow[], title: string) => (
    <div className="flex flex-col">
      <div className="border-b border-slate-200 bg-slate-50/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="flex-1 divide-y divide-slate-50">
        {rows.map((r, i) => (
          <div key={i} className={cx("flex justify-between gap-4 px-4 py-1.5 text-sm", r.strong ? "font-semibold text-slate-900" : "text-slate-700", r.indent && "pl-8 text-slate-600")}>
            {r.href ? <Link href={r.href} className="hover:text-brand-700 hover:underline">{r.label}</Link> : <span>{r.label}</span>}
            <span className="tabular-nums">{formatMoney(r.amount)}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between border-t-2 border-slate-300 px-4 py-2 text-sm font-semibold"><span>Total</span><span className="tabular-nums">{formatMoney(rows.filter((r) => !r.indent).reduce((s, r) => s + r.amount, 0))}</span></div>
    </div>
  );
  return <div className="grid divide-y divide-slate-200 md:grid-cols-2 md:divide-x md:divide-y-0">{side(left, leftTitle)}{side(right, rightTitle)}</div>;
}

function block(title: string, b: NominalBlock, from: string, to: string): TRow[] {
  if (!b.rows.length) return [];
  return [{ label: title, amount: b.total, strong: true }, ...b.rows.map((r) => ({ label: r.name, amount: r.amount, href: ledgerHref(r.id, from, to), indent: true }))];
}

function ProfitLoss() {
  const { from, to, inputs } = useRange();
  const q = useApiQuery<PlData>(`/api/accounts/reports/pl${qs({ from, to })}`);
  return (
    <div className="space-y-4">
      <Toolbar>{inputs}</Toolbar>
      <Loading q={q} label="Preparing profit & loss…">
        {(d) => {
          const gp = d.grossProfit;
          const np = d.netProfit;
          const trading = {
            left: [
              { label: "Opening stock", amount: d.openingStock, strong: true },
              ...(d.stockIntroduced ? [{ label: "Stock entries (opening / donated)", amount: d.stockIntroduced, strong: true }] : []),
              ...block("Purchase Accounts", d.purchases, d.from, d.to),
              ...block("Direct Expenses", d.directExpenses, d.from, d.to),
              ...(gp >= 0 ? [{ label: "Gross profit c/o", amount: gp, strong: true }] : []),
            ],
            right: [
              ...block("Sales Accounts", d.sales, d.from, d.to),
              ...block("Direct Incomes", d.directIncome, d.from, d.to),
              { label: "Closing stock", amount: d.closingStock, strong: true },
              ...(gp < 0 ? [{ label: "Gross loss c/o", amount: -gp, strong: true }] : []),
            ],
          };
          const pl = {
            left: [...(gp < 0 ? [{ label: "Gross loss b/f", amount: -gp, strong: true }] : []), ...block("Indirect Expenses", d.indirectExpenses, d.from, d.to), ...(np >= 0 ? [{ label: "Net profit", amount: np, strong: true }] : [])],
            right: [...(gp >= 0 ? [{ label: "Gross profit b/f", amount: gp, strong: true }] : []), ...block("Indirect Incomes", d.indirectIncome, d.from, d.to), ...(np < 0 ? [{ label: "Net loss", amount: -np, strong: true }] : [])],
          };
          return (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard label="Income" value={formatMoney(d.sales.total + d.directIncome.total + d.indirectIncome.total)} />
                <StatCard label="Gross profit" value={formatMoney(gp)} tone={gp < 0 ? "red" : "brand"} />
                <StatCard label={np < 0 ? "Net loss" : "Net profit"} value={formatMoney(Math.abs(np))} tone={np < 0 ? "red" : "brand"} hint={`${formatDate(d.from)} to ${formatDate(d.to)}`} />
              </div>
              <Card><CardHeader title="Trading account" description="Stock is valued at cost from Inventory (all stores)." /><TStatement leftTitle="Particulars (Dr)" rightTitle="Particulars (Cr)" left={trading.left} right={trading.right} /></Card>
              <Card><CardHeader title="Profit & loss account" /><TStatement leftTitle="Particulars (Dr)" rightTitle="Particulars (Cr)" left={pl.left} right={pl.right} /></Card>
            </>
          );
        }}
      </Loading>
    </div>
  );
}

/* ======================= Balance sheet ======================= */

interface BsSide {
  key: string;
  name: string;
  groups: { name: string; rows: { name: string; amount: number }[]; total: number }[];
  total: number;
}
interface BsData {
  asOf: string;
  booksFrom: string;
  liabilities: BsSide[];
  assets: BsSide[];
  profit: number;
  closingStock: number;
  difference: number;
}

function BalanceSheet() {
  const [to, setTo] = useState(today);
  const q = useApiQuery<BsData>(`/api/accounts/reports/bs${qs({ to })}`);
  const rows = (sides: BsSide[]): TRow[] =>
    sides.flatMap((s) => [
      { label: s.name, amount: s.total, strong: true },
      ...s.groups.flatMap((g) => (g.name === s.name ? g.rows.map((r) => ({ label: r.name, amount: r.amount, indent: true })) : [{ label: g.name, amount: g.total, indent: true }])),
    ]);
  return (
    <div className="space-y-4">
      <Toolbar><DateInput label="As on" value={to} onChange={setTo} max={today()} /></Toolbar>
      <Loading q={q} label="Preparing balance sheet…">
        {(d) => {
          const left = [...rows(d.liabilities), { label: d.profit >= 0 ? "Profit & Loss A/c (profit)" : "Profit & Loss A/c (loss)", amount: d.profit, strong: true }];
          const right = rows(d.assets);
          if (d.difference > 0) left.push({ label: "Difference in opening balances", amount: d.difference, strong: true });
          if (d.difference < 0) right.push({ label: "Difference in opening balances", amount: -d.difference, strong: true });
          return (
            <>
              {d.difference !== 0 && (
                <Alert tone="amber">
                  Opening balances differ by {formatMoney(Math.abs(d.difference))} (stock on hand when the books start counts as an opening asset). Enter the opening balances of capital, bank, loans, debtors and creditors as on {formatDate(d.booksFrom)} in Masters → Ledgers so both sides tally.
                </Alert>
              )}
              <Card>
                <CardHeader title={`Balance Sheet as on ${formatDate(d.asOf)}`} description={`Books from ${formatDate(d.booksFrom)} · profit is accumulated since then, with stock at cost`} />
                <TStatement leftTitle="Liabilities" rightTitle="Assets" left={left} right={right} />
              </Card>
            </>
          );
        }}
      </Loading>
    </div>
  );
}

/* ======================= GSTR-1 ======================= */

type Tax = { taxable: number; iamt: number; camt: number; samt: number };
interface HsnRow extends Tax { hsn: string; desc: string; uqc: string; qty: number; rate: number }
interface Gstr1Data {
  period: string;
  fp: string | null;
  gstin: string;
  state: string;
  warnings: string[];
  summary: { b2b: Tax & { invoices: number }; b2cs: Tax; nil: number; exempt: number; invoices: number; value: number };
  b2b: { ctin: string; party: string; invoices: (Tax & { id: string; code: string; date: string; value: number; pos: string })[] }[];
  b2cs: (Tax & { type: string; pos: string; rate: number })[];
  nil: { type: string; label: string; nil: number; exempt: number }[];
  hsnB2b: HsnRow[];
  hsnB2c: HsnRow[];
  docs: { series: string; from: string; to: string; total: number; cancelled: number; net: number }[];
}

const taxCells = (t: Tax) => [formatMoney(t.taxable), money(t.iamt), money(t.camt), money(t.samt)];
const TAX_HEADS = ["Taxable value", "IGST", "CGST", "SGST"];

function useMonth() {
  const sp = useSearchParams();
  const [month, setMonth] = useState(sp.get("month") ?? thisMonth());
  return { month, input: <MonthInput value={month} onChange={setMonth} /> };
}

async function downloadJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(j?.error?.message ?? `Download failed (${res.status})`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "GSTR1.json";
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
  URL.revokeObjectURL(href);
}

function Gstr1() {
  const toast = useToast();
  const { month, input } = useMonth();
  const q = useApiQuery<Gstr1Data>(`/api/accounts/reports/gstr1${qs({ month })}`);
  const [busy, setBusy] = useState(false);
  async function json() {
    setBusy(true);
    try {
      await downloadJson(`/api/accounts/reports/gstr1-json${qs({ month })}`);
      toast("GSTR-1 JSON downloaded — import it in the GST offline tool or upload on the portal");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  function exportHsn(d: Gstr1Data) {
    downloadCsv(`hsn-summary_${month}.csv`, ["Table", "HSN/SAC", "Description", "UQC", "Qty", "Rate %", "Taxable", "IGST", "CGST", "SGST"],
      [...d.hsnB2b.map((h) => ["B2B", h.hsn, h.desc, h.uqc, h.qty, h.rate, h.taxable, h.iamt, h.camt, h.samt]), ...d.hsnB2c.map((h) => ["B2C", h.hsn, h.desc, h.uqc, h.qty, h.rate, h.taxable, h.iamt, h.camt, h.samt])]);
  }
  const hsnRows = (rows: HsnRow[]) => rows.map((h) => [h.hsn, h.desc, h.uqc, h.qty || "—", `${h.rate}%`, ...taxCells(h)]);
  return (
    <div className="space-y-4">
      <Toolbar actions={q.data && (
        <>
          <Button variant="secondary" onClick={() => exportHsn(q.data!)}><FileSpreadsheet className="size-4" /> HSN (CSV)</Button>
          <Button onClick={json} loading={busy}><FileJson className="size-4" /> Download JSON</Button>
        </>
      )}>{input}</Toolbar>
      <Loading q={q} label="Preparing GSTR-1…">
        {(d) => (
          <>
            {d.warnings.length > 0 && <Alert tone="amber"><ul className="list-disc space-y-1 pl-4">{d.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert>}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Invoices" value={d.summary.invoices} hint={`${d.period} · value ${formatMoney(d.summary.value)}`} tone="slate" />
              <StatCard label="B2B (4A)" value={formatMoney(d.summary.b2b.taxable)} hint={`${d.summary.b2b.invoices} invoice(s) · tax ${formatMoney(d.summary.b2b.iamt + d.summary.b2b.camt + d.summary.b2b.samt)}`} />
              <StatCard label="B2C small (7)" value={formatMoney(d.summary.b2cs.taxable)} hint={`Tax ${formatMoney(d.summary.b2cs.iamt + d.summary.b2cs.camt + d.summary.b2cs.samt)}`} />
              <StatCard label="Nil / exempt (8)" value={formatMoney(d.summary.nil + d.summary.exempt)} hint={`Nil-rated ${formatMoney(d.summary.nil)} · exempt ${formatMoney(d.summary.exempt)}`} tone="slate" />
            </div>
            <p className="text-xs text-slate-500">GSTIN {d.gstin || "—"} · {d.state || "state not set"} · Check the JSON in the GST offline tool before filing.</p>
            <TableCard title="4A — B2B invoices" description="Bills whose corporate payer has a GSTIN" headers={["Invoice", "Date", "Party", "GSTIN", "POS", "Value", ...TAX_HEADS]}
              rows={d.b2b.flatMap((p) => p.invoices.map((i) => [<Link key={i.id} href={`/billing/bills/${i.id}`} className="font-mono text-xs text-brand-700 hover:underline">{i.code}</Link>, formatDate(i.date), p.party, p.ctin, i.pos, formatMoney(i.value), ...taxCells(i)]))} empty="No B2B invoices." />
            <div className="grid gap-4 xl:grid-cols-2">
              <TableCard title="7 — B2C (others)" description="Rate-wise, by place of supply" headers={["Type", "POS", "Rate", ...TAX_HEADS]} rows={d.b2cs.map((r) => [r.type === "INTRA" ? "Intra-state" : "Inter-state", r.pos, `${r.rate}%`, ...taxCells(r)])} empty="No taxable B2C supplies." />
              <TableCard title="8 — Nil-rated & exempt" headers={["Supply", "Nil-rated", "Exempt"]} rows={d.nil.map((r) => [r.label, formatMoney(r.nil), formatMoney(r.exempt)])} empty="—" />
            </div>
            <TableCard title="12 — HSN summary · B2B" headers={["HSN / SAC", "Description", "UQC", "Qty", "Rate", ...TAX_HEADS]} rows={hsnRows(d.hsnB2b)} empty="No B2B supplies." />
            <TableCard title="12 — HSN summary · B2C" headers={["HSN / SAC", "Description", "UQC", "Qty", "Rate", ...TAX_HEADS]} rows={hsnRows(d.hsnB2c)} empty="No B2C supplies." />
            <TableCard title="13 — Documents issued" headers={["Series", "From", "To", "Total", "Cancelled", "Net issued"]} rows={d.docs.map((x) => [x.series, x.from, x.to, x.total, x.cancelled, x.net])} empty="No documents in this period." />
          </>
        )}
      </Loading>
    </div>
  );
}

/* ======================= GSTR-3B ======================= */

interface Gstr3bData {
  period: string;
  t31a: Tax;
  t31c: number;
  t32: { pos: string; state: string; taxable: number; iamt: number }[];
  t4a5: { iamt: number; camt: number; samt: number };
  t4d2: { iamt: number; camt: number; samt: number };
  t5: number;
  manual: Tax;
  payable: { iamt: number; camt: number; samt: number };
  cashPayable: { iamt: number; camt: number; samt: number };
}

function Gstr3b() {
  const { month, input } = useMonth();
  const q = useApiQuery<Gstr3bData>(`/api/accounts/reports/gstr3b${qs({ month })}`);
  const heads = (t: { iamt: number; camt: number; samt: number }) => [formatMoney(t.iamt), formatMoney(t.camt), formatMoney(t.samt)];
  return (
    <div className="space-y-4">
      <Toolbar>{input}</Toolbar>
      <Loading q={q} label="Preparing GSTR-3B…">
        {(d) => (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Output tax" value={formatMoney(d.t31a.iamt + d.t31a.camt + d.t31a.samt)} hint={d.period} />
              <StatCard label="Input tax credit" value={formatMoney(d.t4a5.iamt + d.t4a5.camt + d.t4a5.samt)} />
              <StatCard label="Tax payable (cash)" value={formatMoney(d.cashPayable.iamt + d.cashPayable.camt + d.cashPayable.samt)} tone="amber" hint="Before cross-utilisation of IGST credit" />
            </div>
            <TableCard title="3.1 — Outward supplies" headers={["Nature of supplies", ...TAX_HEADS]} rows={[
              ["(a) Taxable outward supplies (other than zero-rated, nil-rated and exempted)", ...taxCells(d.t31a)],
              ["(c) Other outward supplies (nil-rated, exempted)", formatMoney(d.t31c), "", "", ""],
            ]} empty="—" />
            {d.manual.taxable + d.manual.iamt + d.manual.camt + d.manual.samt !== 0 && <p className="text-xs text-slate-500">3.1(a) includes {formatMoney(d.manual.taxable)} taxable value from sales vouchers entered in Accounts.</p>}
            <TableCard title="3.2 — Inter-state supplies to unregistered persons" headers={["Place of supply", "Taxable value", "IGST"]} rows={d.t32.map((r) => [`${r.pos} - ${r.state}`, formatMoney(r.taxable), formatMoney(r.iamt)])} empty="None." />
            <TableCard title="4 — Eligible ITC" headers={["Details", "IGST", "CGST", "SGST"]} rows={[
              ["(A)(5) All other ITC (purchases from registered suppliers, net of returns)", ...heads(d.t4a5)],
              ["(D)(2) Not claimable — supplier has no GSTIN on record", ...heads(d.t4d2)],
            ]} empty="—" />
            <TableCard title="Tax payable" headers={["", "IGST", "CGST", "SGST"]} rows={[
              ["Output tax less ITC", ...heads(d.payable)],
              ["Payable in cash", ...heads(d.cashPayable)],
            ]} empty="—" />
            <p className="text-xs text-slate-500">Inward exempt / nil / non-GST supplies (table 5): {formatMoney(d.t5)}. Figures come from bills, pharmacy, purchases and GST ledgers in manual vouchers — verify them against GSTR-2B before filing.</p>
          </>
        )}
      </Loading>
    </div>
  );
}

/* ======================= Purchase register (ITC) ======================= */

interface ItcData {
  period: string;
  rows: (Tax & { kind: string; id: string; code: string; date: string; party: string; gstin: string | null; invoiceNo: string; total: number; eligible: boolean; href: string | null })[];
  eligible: Tax & { total: number };
  ineligible: Tax & { total: number };
}

function ItcRegister() {
  const { month, input } = useMonth();
  const q = useApiQuery<ItcData>(`/api/accounts/reports/itc${qs({ month })}`);
  return (
    <div className="space-y-4">
      <Toolbar actions={q.data && (
        <Button variant="secondary" onClick={() => downloadCsv(`purchase-register_${month}.csv`, ["Date", "Document", "Type", "Supplier", "GSTIN", "Invoice no.", "Taxable", "IGST", "CGST", "SGST", "Total", "ITC"],
          q.data!.rows.map((r) => [r.date.slice(0, 10), r.code, r.kind, r.party, r.gstin, r.invoiceNo, r.taxable, r.iamt, r.camt, r.samt, r.total, r.eligible ? "Eligible" : "No GSTIN"]))}><FileSpreadsheet className="size-4" /> CSV</Button>
      )}>{input}</Toolbar>
      <Loading q={q} label="Preparing purchase register…">
        {(d) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard label="Eligible ITC" value={formatMoney(d.eligible.iamt + d.eligible.camt + d.eligible.samt)} hint={`On purchases of ${formatMoney(d.eligible.taxable)} · ${d.period}`} />
              <StatCard label="Not claimable" value={formatMoney(d.ineligible.iamt + d.ineligible.camt + d.ineligible.samt)} hint="Suppliers without a GSTIN — add it in Inventory → Suppliers" tone="amber" />
            </div>
            <TableCard title="Purchase register" description="Pharmacy purchases, GRNs, purchase returns (negative) and purchase vouchers with input GST"
              headers={["Date", "Document", "Supplier", "GSTIN", "Invoice", ...TAX_HEADS, "Total"]}
              rows={d.rows.map((r) => [formatDate(r.date), r.href ? <Link key={r.id} href={r.href} className="font-mono text-xs text-brand-700 hover:underline">{r.code}</Link> : r.code, <span key="p">{r.party}<span className="block text-xs text-slate-500">{r.kind}</span></span>, r.gstin ?? <Badge key="g" tone="amber">No GSTIN</Badge>, r.invoiceNo, ...taxCells(r), formatMoney(r.total)])}
              empty="No purchases in this period." />
          </>
        )}
      </Loading>
    </div>
  );
}

/* ======================= Settings ======================= */

interface SettingsData {
  modeLedgers: Record<string, string>;
  cashBank: { id: string; name: string; group: string }[];
  booksFrom: string | null;
  stateCode: string;
  gstin: string;
  hospitalState: string;
  lastRunAt: string | null;
  lastRunSummary: { full: boolean; documents: number; vouchers: number; removed: number; errors: string[] } | null;
  vouchers: { auto: boolean; kind: string | null; count: number }[];
}

const KIND_LABELS: Record<string, string> = {
  bill: "Hospital bills & receipts", pharmacy_sale: "Pharmacy sales", pharmacy_purchase: "Pharmacy purchases", stock_doc: "GRNs & purchase returns", supplier_payment: "Vendor payments",
  doctor_payout: "Doctor payouts", staff_advance: "Staff advances", lab_order: "Lab orders", ambulance_trip: "Ambulance trips", payroll: "Payroll",
};

function Settings() {
  const q = useApiQuery<SettingsData>("/api/accounts/settings");
  return <Loading q={q} label="Loading settings…">{(d) => <SettingsForm key={d.lastRunAt ?? "x"} data={d} reload={q.reload} />}</Loading>;
}

function SettingsForm({ data, reload }: { data: SettingsData; reload: () => void }) {
  const toast = useToast();
  const [modes, setModes] = useState(data.modeLedgers);
  const [booksFrom, setBooksFrom] = useState(data.booksFrom ?? "");
  const [stateCode, setStateCode] = useState(data.stateCode);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [posting, setPosting] = useState(false);

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      await api("/api/accounts/settings", { method: "PUT", body: { modeLedgers: modes, booksFrom: booksFrom || null, stateCode } });
      toast("Accounts settings saved");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
      const f = (e as { fields?: Record<string, string> }).fields;
      if (f) setErrors(f);
    } finally {
      setBusy(false);
    }
  }
  async function repost() {
    setPosting(true);
    try {
      const { data: s } = await api<{ vouchers: number; documents: number; errors: string[] }>("/api/accounts/post", { method: "POST", body: { full: true } });
      toast(`Re-posted ${s.vouchers} voucher(s) from ${s.documents} document(s)${s.errors.length ? ` — ${s.errors.length} error(s)` : ""}`, s.errors.length ? "error" : undefined);
      setConfirm(false);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setPosting(false);
    }
  }
  const auto = data.vouchers.filter((v) => v.auto);
  const manual = data.vouchers.filter((v) => !v.auto).reduce((s, v) => s + v.count, 0);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Posting settings" description="Changing these rebuilds every automatic voucher." />
        <div className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {MONEY_MODES.map((m) => (
              <Field key={m} label={`${m} goes to`} htmlFor={`mode-${m}`} error={errors[`mode.${m}`]}>
                <select id={`mode-${m}`} value={modes[m] ?? ""} onChange={(e) => setModes({ ...modes, [m]: e.target.value })} className={inputClass}>
                  {data.cashBank.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.group})</option>)}
                </select>
              </Field>
            ))}
          </div>
          <p className="text-xs text-slate-500">Add bank accounts in Masters → Ledgers under the group &quot;Bank Accounts&quot;, then choose them here (e.g. card and UPI settle to the current account).</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Books start from" htmlFor="books-from" error={errors.booksFrom} hint="Documents before this date are not posted; enter balances on this date as ledger opening balances. Leave blank to post everything.">
              <input id="books-from" type="date" value={booksFrom} onChange={(e) => setBooksFrom(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Hospital state (GST)" htmlFor="state" error={errors.stateCode} hint={data.gstin ? `Taken from GSTIN ${data.gstin}` : "Set when the GSTIN is not configured"}>
              <select id="state" value={data.gstin ? data.hospitalState : stateCode} disabled={!!data.gstin} onChange={(e) => setStateCode(e.target.value.slice(0, 2))} className={inputClass}>
                <option value="">—</option>
                {GST_STATE_OPTIONS.map((s) => <option key={s} value={s.slice(0, 2)}>{s}</option>)}
              </select>
            </Field>
          </div>
          <div className="flex justify-end"><Button onClick={save} loading={busy}>Save settings</Button></div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Automatic postings" description="Vouchers are rebuilt from the modules whenever a document changes; Accounts pages bring them up to date as they open." actions={<Button variant="secondary" onClick={() => setConfirm(true)}><RefreshCw className="size-4" /> Re-post all</Button>} />
        <div className="space-y-3 p-5 text-sm">
          <p className="text-slate-600">Last run: {data.lastRunAt ? formatDateTime(data.lastRunAt) : "never"}{data.lastRunSummary ? ` · ${data.lastRunSummary.documents} document(s) checked, ${data.lastRunSummary.vouchers} voucher(s) written` : ""}</p>
          {data.lastRunSummary?.errors.length ? (
            <Alert tone="amber"><span className="flex items-center gap-1 font-medium"><TriangleAlert className="size-4" /> Some documents could not be posted</span><ul className="mt-1 list-disc pl-4">{data.lastRunSummary.errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert>
          ) : null}
          <table className="min-w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {auto.map((v) => <tr key={v.kind}><td className="py-1.5 text-slate-700">{KIND_LABELS[v.kind ?? ""] ?? v.kind}</td><td className="py-1.5 text-right tabular-nums">{v.count}</td></tr>)}
              <tr><td className="py-1.5 text-slate-700">Entered in Accounts</td><td className="py-1.5 text-right tabular-nums">{manual}</td></tr>
            </tbody>
          </table>
          <p className="text-xs text-slate-500">Rent, electricity, salaries paid outside payroll, loans, capital and other entries are made as vouchers in the Day Book.</p>
          <Link href="/m/accounts?tab=ledgers" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"><Download className="size-4 rotate-180" /> Manage ledgers & opening balances</Link>
        </div>
      </Card>
      <ConfirmDialog open={confirm} title="Re-post all automatic vouchers?" message="Every automatic voucher is deleted and rebuilt from the bills, sales, purchases and payments. Vouchers entered in Accounts are not touched." confirmLabel="Re-post" loading={posting} onConfirm={repost} onClose={() => setConfirm(false)} />
    </div>
  );
}
