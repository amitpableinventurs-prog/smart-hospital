"use client";

import { CalendarCheck, CheckCheck, FileSpreadsheet, Lock, Plus, Printer, Save, Search, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, qs } from "@/lib/client";
import { downloadCsv } from "@/lib/csv";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { STAFF_CATEGORIES, STAFF_DEPARTMENTS } from "@/lib/modules";
import { useApiQuery } from "@/lib/useApi";
import { FormModal } from "../FormModal";
import { TableCard } from "../TableCard";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Kbd, Spinner, StatCard, cx, inputClass, statusTone, useDebounced, useHotkeys, useToast } from "../ui";
import { BiometricAttendance } from "./Biometric";

/** Bespoke HR tabs: attendance register, biometric machines, leave balances, payroll and reports. */
export function HrSection({ section }: { section: string }) {
  if (section === "biometric") return <BiometricAttendance />;
  if (section === "leave_balance") return <LeaveBalances />;
  if (section === "payroll") return <PayrollList />;
  if (section === "reports") return <HrReports />;
  return <AttendanceRegister />;
}

const th = "whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;
const MARKS = ["Present", "Absent", "Half Day", "On Duty", "Week Off", "Holiday"] as const;
const WORKING = new Set(["Present", "Half Day", "On Duty"]);

/* ======================= Attendance ======================= */

interface AttRow {
  id: string;
  code: string;
  name: string;
  department: string;
  designation: string;
  category: string;
  shift: string | null;
  leave: string | null;
  fullDayLeave: boolean;
  derived: string | null;
  status: string | null;
  inTime: string | null;
  outTime: string | null;
  lateMinutes: number;
  overtimeHours: number;
  remarks: string | null;
  markedByName: string | null;
  biometric: boolean;
  punches: number;
}
interface Register {
  date: string;
  holiday: string | null;
  locked: string | null;
  rows: AttRow[];
  summary: Record<string, number>;
}
type Edit = { status: string; inTime: string; outTime: string; overtimeHours: string; remarks: string };

function AttendanceRegister() {
  const [date, setDate] = useState(today);
  const [department, setDepartment] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const q = useApiQuery<Register>(`/api/hr/attendance${qs({ date, department, category, search: debounced })}`);

  return (
    <Card>
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <input type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} className={inputClass} aria-label="Date" />
        <select value={department} onChange={(e) => setDepartment(e.target.value)} className={inputClass} aria-label="Department">
          <option value="">All departments</option>
          {STAFF_DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass} aria-label="Category">
          <option value="">All categories</option>
          {STAFF_CATEGORIES.map((d) => <option key={d}>{d}</option>)}
        </select>
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Employee name or ID…" className={cx(inputClass, "pl-9")} aria-label="Search employees" />
        </div>
      </div>
      {q.loading ? (
        <Spinner label="Loading register…" />
      ) : q.error ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : q.data ? (
        <AttendanceGrid key={`${q.data.date}|${department}|${category}|${debounced}`} data={q.data} onSaved={q.reload} />
      ) : null}
    </Card>
  );
}

function AttendanceGrid({ data, onSaved }: { data: Register; onSaved: () => void }) {
  const toast = useToast();
  const initial = useMemo(
    () => Object.fromEntries(data.rows.map((r) => [r.id, { status: r.status ?? "", inTime: r.inTime ?? "", outTime: r.outTime ?? "", overtimeHours: r.overtimeHours ? String(r.overtimeHours) : "", remarks: r.remarks ?? "" }])) as Record<string, Edit>,
    [data]
  );
  const [edits, setEdits] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = data.rows.filter((r) => JSON.stringify(edits[r.id]) !== JSON.stringify(initial[r.id]));
  const locked = !!data.locked;
  const set = (id: string, patch: Partial<Edit>) => setEdits((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  function markAllPresent() {
    setEdits((s) => {
      const next = { ...s };
      for (const r of data.rows) if (!next[r.id].status && !r.derived) next[r.id] = { ...next[r.id], status: "Present" };
      return next;
    });
  }

  async function save() {
    if (!dirty.length || locked) return;
    setSaving(true);
    setError(null);
    try {
      const entries = dirty.map((r) => ({ staff: r.id, ...edits[r.id], overtimeHours: edits[r.id].overtimeHours || 0 }));
      const { data: res } = await api<{ marked: number; cleared: number }>("/api/hr/attendance", { method: "POST", body: { date: data.date, entries } });
      toast(`Attendance saved: ${res.marked} marked${res.cleared ? `, ${res.cleared} cleared` : ""}`);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }
  useHotkeys({ "ctrl+s": save, F10: save });

  const s = data.summary;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-xs">
        <span className="font-medium text-slate-700">{formatDate(data.date)}</span>
        {data.holiday && <Badge tone="violet">Holiday: {data.holiday}</Badge>}
        <Badge tone="green">Present {s.present}</Badge>
        {s.halfDay > 0 && <Badge tone="amber">Half day {s.halfDay}</Badge>}
        <Badge tone="red">Absent {s.absent}</Badge>
        <Badge tone="amber">Leave {s.leave}</Badge>
        <Badge tone="slate">Off {s.off}</Badge>
        {s.unmarked > 0 && <Badge tone="blue">Not marked {s.unmarked}</Badge>}
        {s.late > 0 && <Badge tone="amber">Late {s.late}</Badge>}
        <div className="ml-auto flex gap-2">
          {!locked && <Button variant="secondary" onClick={markAllPresent}><CheckCheck className="size-4" /> Mark unmarked present</Button>}
          {!locked && <Button onClick={save} loading={saving} disabled={!dirty.length}><Save className="size-4" /> Save {dirty.length ? `(${dirty.length})` : ""} <Kbd>Ctrl+S</Kbd></Button>}
        </div>
      </div>
      {locked && <div className="border-b border-slate-100 p-3"><Alert tone="amber"><Lock className="mr-1 inline size-4" />Payroll {data.locked} for this month is finalised, so attendance is locked. Reopen the payroll to correct it.</Alert></div>}
      {error && <div className="border-b border-slate-100 p-3"><Alert>{error}</Alert></div>}
      {data.rows.length === 0 ? (
        <EmptyState title="No employees on the rolls for this date" description="Add employees under HR → Employees, with a joining date on or before this day." />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/60">
              <tr>{["Employee", "Status", "In", "Out", "OT (h)", "Remarks"].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rows.map((r) => {
                const e = edits[r.id];
                const working = WORKING.has(e.status);
                const changed = JSON.stringify(e) !== JSON.stringify(initial[r.id]);
                const disabled = locked || saving;
                return (
                  <tr key={r.id} className={cx(changed && "bg-amber-50/50")}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">{r.name} <span className="font-mono text-xs font-normal text-slate-500">{r.code}</span></div>
                      <div className="text-xs text-slate-500">{[r.designation, r.department, r.shift].filter(Boolean).join(" · ")}</div>
                      {r.leave && <div className="text-xs font-medium text-amber-700">On leave: {r.leave}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <select value={e.status} disabled={disabled || r.fullDayLeave} onChange={(ev) => set(r.id, { status: ev.target.value })} className={cx(inputClass, "w-40")} aria-label={`Status of ${r.name}`}>
                        <option value="">{r.fullDayLeave ? "Leave" : r.derived ? `${r.derived} (auto)` : "— Not marked —"}</option>
                        {MARKS.map((m) => <option key={m}>{m}</option>)}
                      </select>
                      {r.lateMinutes > 0 && <span className="mt-0.5 block text-xs text-amber-700">Late {r.lateMinutes} min</span>}
                      {r.biometric && !changed && <span className="mt-0.5 block text-xs text-brand-700" title={`${r.markedByName ?? "Biometric"}. Editing this row turns it into a manual mark that punches no longer change.`}>Biometric · {r.punches} punch{r.punches === 1 ? "" : "es"}</span>}
                    </td>
                    <td className="px-3 py-2"><input type="time" value={e.inTime} disabled={disabled || !working} onChange={(ev) => set(r.id, { inTime: ev.target.value })} className={cx(inputClass, "w-28")} aria-label="In time" /></td>
                    <td className="px-3 py-2"><input type="time" value={e.outTime} disabled={disabled || !working} onChange={(ev) => set(r.id, { outTime: ev.target.value })} className={cx(inputClass, "w-28")} aria-label="Out time" /></td>
                    <td className="px-3 py-2"><input type="number" min={0} max={16} step={0.5} value={e.overtimeHours} disabled={disabled || !working} onChange={(ev) => set(r.id, { overtimeHours: ev.target.value })} className={cx(inputClass, "w-20")} aria-label="Overtime hours" /></td>
                    <td className="px-3 py-2"><input value={e.remarks} maxLength={200} disabled={disabled} onChange={(ev) => set(r.id, { remarks: ev.target.value })} className={cx(inputClass, "min-w-40")} aria-label="Remarks" title={r.markedByName ? `Marked by ${r.markedByName}` : undefined} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ======================= Leave balances ======================= */

interface Balances {
  year: number;
  types: { leaveType: string; quota: number | null; paid: boolean }[];
  rows: { id: string; code: string; name: string; department: string; designation: string; balances: { leaveType: string; applies: boolean; entitled: number | null; carried: number; taken: number; pending: number; balance: number | null }[] }[];
}

function LeaveBalances() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [department, setDepartment] = useState("");
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const q = useApiQuery<Balances>(`/api/hr/leave-balances${qs({ year, department, search: debounced })}`);
  const d = q.data;

  function exportCsv() {
    if (!d) return;
    downloadCsv(
      `leave-balances_${d.year}.csv`,
      ["Employee ID", "Name", "Department", ...d.types.flatMap((t) => [`${t.leaveType} entitled`, `${t.leaveType} taken`, `${t.leaveType} pending`, `${t.leaveType} balance`])],
      d.rows.map((r) => [r.code, r.name, r.department, ...r.balances.flatMap((b) => (b.applies ? [b.entitled ?? "No limit", b.taken, b.pending, b.balance ?? "No limit"] : ["n/a", "", "", ""]))])
    );
  }

  return (
    <Card>
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={inputClass} aria-label="Year">
          {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={department} onChange={(e) => setDepartment(e.target.value)} className={inputClass} aria-label="Department">
          <option value="">All departments</option>
          {STAFF_DEPARTMENTS.map((x) => <option key={x}>{x}</option>)}
        </select>
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Employee name or ID…" className={cx(inputClass, "pl-9")} aria-label="Search employees" />
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={!d?.rows.length}><FileSpreadsheet className="size-4" /> Export CSV</Button>
      </div>
      {q.loading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : !d || d.types.length === 0 ? (
        <EmptyState title="No leave policy set up" description="Add leave types with their yearly quota under HR → Leave Policy." />
      ) : d.rows.length === 0 ? (
        <EmptyState title="No matching employees" />
      ) : (
        <div className="overflow-x-auto">
          <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">Balance = entitlement (pro-rata for joiners, plus carry-forward) − approved − pending, for {d.year}. Apply under Leave Applications.</p>
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/60">
              <tr>
                <th className={th}>Employee</th>
                {d.types.map((t) => <th key={t.leaveType} className={cx(th, "text-right")}>{t.leaveType}<span className="block text-[10px] font-normal normal-case">{t.quota === null ? "no limit" : `${t.quota}/yr`}{t.paid ? "" : " · unpaid"}</span></th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-2"><span className="font-medium text-slate-900">{r.name}</span> <span className="font-mono text-xs text-slate-500">{r.code}</span><span className="block text-xs text-slate-500">{r.designation} · {r.department}</span></td>
                  {r.balances.map((b) => (
                    <td key={b.leaveType} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {!b.applies ? <span className="text-xs text-slate-400">n/a</span> : (
                        <>
                          <span className={cx("font-semibold", b.balance !== null && b.balance <= 0 ? "text-red-600" : "text-slate-900")}>{b.balance ?? "∞"}</span>
                          <span className="text-xs text-slate-500">{b.entitled !== null ? ` / ${b.entitled}` : ""}</span>
                          <span className="block text-[11px] text-slate-500">taken {b.taken}{b.pending ? ` · pending ${b.pending}` : ""}{b.carried ? ` · c/f ${b.carried}` : ""}</span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ======================= Payroll ======================= */

export interface RunSummary {
  id: string;
  code: string;
  month: string;
  status: string;
  totals: Record<string, number> | null;
  generatedAt: string | null;
  finalisedAt: string | null;
  paidOn: string | null;
}

export const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

function PayrollList() {
  const router = useRouter();
  const toast = useToast();
  const q = useApiQuery<RunSummary[]>("/api/hr/payroll");
  const [preparing, setPreparing] = useState(false);
  const rows = q.data ?? [];
  // Default to last month until the 25th, when the current month is usually processed.
  const lastMonth = (() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - (now.getDate() < 25 ? 1 : 0), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <p className="text-xs text-slate-500">Payroll uses Daily Attendance, approved leave, holidays, the salary structure and active advances. Finalise to lock the month and recover advances.</p>
        <Button onClick={() => setPreparing(true)}><Plus className="size-4" /> Prepare payroll</Button>
      </div>
      {q.loading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : rows.length === 0 ? (
        <EmptyState title="No payroll prepared yet" description="Set each employee's salary structure, then prepare the month's payroll." action={<Button onClick={() => setPreparing(true)}><Plus className="size-4" /> Prepare payroll</Button>} />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/60">
              <tr>{["Month", "Run", "Employees", "Gross", "Deductions", "Net pay", "Employer PF + ESI", "Status", ""].map((h, i) => <th key={i} className={th}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} onClick={() => router.push(`/hr/payroll/${r.id}`)} className="cursor-pointer hover:bg-brand-50/40">
                  <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-900">{monthLabel(r.month)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-brand-700">{r.code}</td>
                  <td className="px-3 py-2.5 tabular-nums">{r.totals?.staff ?? "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums">{formatMoney(r.totals?.gross)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{formatMoney(r.totals?.deductions)}</td>
                  <td className="px-3 py-2.5 font-semibold tabular-nums text-slate-900">{formatMoney(r.totals?.net)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{r.totals ? formatMoney((r.totals.employerPf ?? 0) + (r.totals.employerEsi ?? 0)) : "—"}</td>
                  <td className="px-3 py-2.5"><Badge tone={statusTone(r.status === "Finalised" ? "approved" : r.status)}>{r.status}</Badge>{r.paidOn && <span className="ml-1 text-xs text-slate-500">{formatDate(r.paidOn)}</span>}</td>
                  <td className="px-3 py-2.5 text-right text-xs text-brand-700">Open →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preparing && (
        <FormModal
          title="Prepare payroll"
          description="Builds a draft for every employee on the rolls in the month. You can review and adjust it before finalising."
          fields={[
            { name: "month", label: "Month", type: "month", required: true, defaultValue: lastMonth },
            { name: "unmarkedAsPresent", label: "Treat days without an attendance mark as present", type: "checkbox", defaultValue: true, hint: "Untick if attendance is marked every day: unmarked days then count as loss of pay." },
          ]}
          confirmLabel="Prepare draft"
          onClose={() => setPreparing(false)}
          onSubmit={async (v) => {
            const { data } = await api<{ id: string; code: string }>("/api/hr/payroll", { method: "POST", body: { month: v.month, unmarkedAsPresent: v.unmarkedAsPresent === true } });
            toast(`Payroll ${data.code} prepared`);
            router.push(`/hr/payroll/${data.id}`);
          }}
        />
      )}
    </Card>
  );
}

/* ======================= Reports ======================= */

interface Reports {
  from: string;
  to: string;
  totals: Record<string, number | null>;
  attendance: { label: string; n: number }[];
  headcount: { label: string; n: number; gross: number }[];
  byCategory: { label: string; n: number }[];
  leaveTaken: { label: string; days: number; n: number }[];
  joiners: { id: string; code: string; name: string; department: string; designation: string; date: string }[];
  leavers: { id: string; code: string; name: string; department: string; designation: string; date: string; status: string; reason: string | null }[];
  registrations: { id: string; code: string; name: string; designation: string; registrationNo: string | null; validUntil: string; expired: boolean }[];
  contracts: { id: string; code: string; name: string; designation: string; employmentType: string | null; endDate: string; ended: boolean }[];
  pendingLeaves: { id: string; code: string | null; staff: string; leaveType: string; from: string; to: string; days: number | null }[];
  payroll: RunSummary[];
}

function HrReports() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const q = useApiQuery<Reports>(`/api/hr/reports${qs({ from, to })}`);
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-xs font-medium text-slate-600">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={cx(inputClass, "mt-1")} /></label>
        <label className="text-xs font-medium text-slate-600">To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={cx(inputClass, "mt-1")} /></label>
        <Button variant="secondary" className="ml-auto" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
      </div>
      {q.loading ? (
        <Spinner label="Preparing reports…" />
      ) : q.error ? (
        <Card><ErrorState message={q.error} onRetry={q.reload} /></Card>
      ) : d ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="On the rolls" value={d.totals.onRolls} hint={`${d.totals.joiners} joined · ${d.totals.leavers} left (${d.totals.attritionPct}% attrition)`} icon={<Users className="size-5" />} />
            <StatCard label="Monthly salary bill (gross)" value={formatMoney(d.totals.monthlyGross)} icon={<Wallet className="size-5" />} />
            <StatCard label="Attendance" value={d.totals.attendancePct === null ? "—" : `${d.totals.attendancePct}%`} hint={`${d.totals.lateArrivals} late arrivals · ${d.totals.overtimeHours} h overtime`} icon={<CalendarCheck className="size-5" />} tone={d.totals.attendancePct !== null && Number(d.totals.attendancePct) < 90 ? "amber" : "brand"} />
            <StatCard label="Leave awaiting approval" value={d.totals.pendingLeaves} tone={d.totals.pendingLeaves ? "amber" : "slate"} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <TableCard title="Headcount by department" headers={["Department", "Staff", "Monthly gross"]} rows={d.headcount.map((h) => [h.label, h.n, formatMoney(h.gross)])} empty="No staff on the rolls." />
            <TableCard title="Staff by category" headers={["Category", "Staff"]} rows={d.byCategory.map((h) => [h.label, h.n])} empty="No staff on the rolls." />
            <TableCard title="Attendance marks in period" headers={["Status", "Marks"]} rows={d.attendance.map((a) => [<Badge key={a.label} tone={statusTone(a.label)}>{a.label}</Badge>, a.n])} empty="No attendance marked in this period." />
            <TableCard title="Leave taken (approved)" headers={["Leave type", "Applications", "Days"]} rows={d.leaveTaken.map((l) => [l.label, l.n, l.days])} empty="No leave in this period." />
            <TableCard title="Leave awaiting approval" description="Approve or reject in Leave Applications" headers={["Employee", "Type", "From", "To", "Days"]} rows={d.pendingLeaves.map((l) => [l.staff, l.leaveType, formatDate(l.from), formatDate(l.to), l.days ?? "—"])} empty="No pending applications." />
            <TableCard title="Council registrations expiring" description="Within 60 days, or already expired" headers={["Employee", "Designation", "Reg. no.", "Valid until"]}
              rows={d.registrations.map((r) => [`${r.name} (${r.code})`, r.designation, r.registrationNo ?? "—", <span key={r.id} className={r.expired ? "font-semibold text-red-600" : "text-amber-700"}>{formatDate(r.validUntil)}</span>])} empty="No registrations due for renewal." />
            <TableCard title="Probation / contracts ending" description="Within 30 days" headers={["Employee", "Type", "Ends"]}
              rows={d.contracts.map((c) => [`${c.name} (${c.code})`, c.employmentType ?? "—", <span key={c.id} className={c.ended ? "font-semibold text-red-600" : "text-amber-700"}>{formatDate(c.endDate)}</span>])} empty="Nothing ending soon." />
            <TableCard title="Joiners" headers={["Employee", "Department", "Joined"]} rows={d.joiners.map((j) => [`${j.name} (${j.code})`, j.department, formatDate(j.date)])} empty="No joiners in this period." />
            <TableCard title="Leavers" headers={["Employee", "Status", "Last day", "Reason"]} rows={d.leavers.map((j) => [`${j.name} (${j.code})`, j.status, formatDate(j.date), j.reason ?? "—"])} empty="No leavers in this period." />
            <TableCard title="Payroll history" headers={["Month", "Status", "Staff", "Gross", "Net", "Cost to company"]}
              rows={d.payroll.map((p) => [<Link key={p.id} href={`/hr/payroll/${p.id}`} className="text-brand-700 hover:underline">{monthLabel(p.month)}</Link>, p.status, p.totals?.staff ?? "—", formatMoney(p.totals?.gross), formatMoney(p.totals?.net), formatMoney(p.totals?.ctc)])} empty="No payroll prepared yet." />
          </div>
          <p className="text-xs text-slate-500">Generated {formatDateTime(new Date().toISOString())}.</p>
        </>
      ) : null}
    </div>
  );
}
