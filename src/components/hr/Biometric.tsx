"use client";

import { Ban, Check, Fingerprint, Pencil, Plus, RefreshCw, Search, Upload, UserX, Wifi, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, qs } from "@/lib/client";
import { timeAgo } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { FormModal } from "../FormModal";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Pagination, Spinner, StatCard, cx, inputClass, useDebounced, useToast } from "../ui";

/* Biometric machines (ADMS push), their punches, log-file import and re-apply. */

interface Device {
  id: string;
  serialNo: string;
  name: string | null;
  location: string | null;
  status: "Pending" | "Active" | "Disabled";
  lastSeenAt: string | null;
  lastIp: string | null;
  lastPunchAt: string | null;
  punchCount: number;
  approvedByName: string | null;
}
interface DevicesData {
  devices: Device[];
  stats: { todayPunches: number; unmatched: number; notApplied: number };
  timezone: string | null;
}
interface Punch {
  id: string;
  pin: string;
  at: string;
  workDate: string | null;
  staffName: string | null;
  staffCode: string | null;
  device: string | null;
  verifyMode: string | null;
  state: string | null;
  source: string;
  note: string | null;
}

const th = "whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
const today = () => new Date().toISOString().slice(0, 10);
/** A machine polls every few seconds; quiet for 5 minutes means it is off or unreachable. */
const online = (d: Device) => !!d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < 5 * 60_000;

export function BiometricAttendance() {
  const q = useApiQuery<DevicesData>("/api/hr/biometric/devices");
  const [refresh, setRefresh] = useState(0);
  const reloadAll = () => {
    q.reload();
    setRefresh((n) => n + 1);
  };
  // Machines push punches live; keep the screen current without a manual refresh.
  useEffect(() => {
    const t = setInterval(reloadAll, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const data = q.data ?? q.stale;

  return (
    <div className="space-y-4">
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Punches today" value={data.stats.todayPunches} icon={<Fingerprint className="size-5" />} />
          <StatCard label="Unmatched (30 days)" value={data.stats.unmatched} hint="User ID not set on any employee" tone={data.stats.unmatched ? "amber" : "slate"} icon={<UserX className="size-5" />} />
          <StatCard label="Not applied (30 days)" value={data.stats.notApplied} hint="Manual mark, leave or locked payroll" tone="slate" icon={<Ban className="size-5" />} />
        </div>
      )}
      {q.error && !data ? <ErrorState message={q.error} onRetry={q.reload} /> : !data ? <Spinner label="Loading machines…" /> : <Devices data={data} onChanged={reloadAll} />}
      <PunchLog refresh={refresh} onChanged={reloadAll} />
    </div>
  );
}

/* ======================= Devices ======================= */

function Devices({ data, onChanged }: { data: DevicesData; onChanged: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState<Device | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const port = typeof window !== "undefined" ? window.location.port || (window.location.protocol === "https:" ? "443" : "80") : "";

  async function setStatus(d: Device, status: "Active" | "Disabled") {
    setBusy(d.id);
    setError(null);
    try {
      await api("/api/hr/biometric/devices", { method: "POST", body: { id: d.id, name: d.name || d.serialNo, location: d.location ?? "", status } });
      toast(status === "Active" ? `${d.name || d.serialNo} approved — punches will start arriving` : `${d.name || d.serialNo} disabled`);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Attendance machines"
        description="ZKTeco, eSSL and other machines with ADMS / Cloud Server push."
        actions={<Button variant="secondary" onClick={() => setEditing("new")}><Plus className="size-4" /> Register machine</Button>}
      />
      <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-3 text-sm text-slate-600">
        <p className="font-medium text-slate-800">Connect a machine</p>
        <p className="mt-1">
          On the machine open <b>Menu → Comm → Cloud Server Setting</b> (eSSL: <b>ADMS</b>), turn <i>Domain name</i> and <i>HTTPS</i> off, and enter server address{" "}
          <code className="rounded bg-white px-1.5 py-0.5 font-mono text-slate-900 ring-1 ring-slate-200">{host === "localhost" ? "this computer's LAN IP" : host}</code> and port{" "}
          <code className="rounded bg-white px-1.5 py-0.5 font-mono text-slate-900 ring-1 ring-slate-200">{port}</code>. It then appears below as <i>Pending</i> — approve it to accept its punches.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Set each employee&apos;s <b>Biometric ID</b> (HR → Employees) to their user ID on the machine. The machine&apos;s own clock is used as-is
          {data.timezone ? `; it is synced to UTC${Number(data.timezone) >= 0 ? "+" : ""}${data.timezone}` : ", so keep it set to local time"}.
        </p>
      </div>
      {error && <div className="border-b border-slate-100 p-3"><Alert>{error}</Alert></div>}
      {data.devices.length === 0 ? (
        <EmptyState title="No machines yet" description="Point a machine at this server as shown above, or register its serial number." />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/60">
              <tr>{["Machine", "Status", "Connection", "Last punch", "Punches", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.devices.map((d) => (
                <tr key={d.id} className={cx(d.status === "Pending" && "bg-amber-50/40")}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{d.name || "Unnamed machine"}</div>
                    <div className="font-mono text-xs text-slate-500">{d.serialNo}{d.location ? <span className="font-sans"> · {d.location}</span> : null}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={d.status === "Active" ? "green" : d.status === "Pending" ? "amber" : "slate"}>{d.status === "Pending" ? "Waiting for approval" : d.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {online(d) ? <span className="inline-flex items-center gap-1 text-emerald-700"><Wifi className="size-3.5" /> Online</span> : <span className="inline-flex items-center gap-1 text-slate-500"><WifiOff className="size-3.5" /> {d.lastSeenAt ? `Seen ${timeAgo(d.lastSeenAt)}` : "Never connected"}</span>}
                    {d.lastIp && <div className="font-mono text-slate-400">{d.lastIp}</div>}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">{d.lastPunchAt ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">{d.punchCount.toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      {d.status !== "Active" && <Button onClick={() => (d.name ? setStatus(d, "Active") : setEditing(d))} loading={busy === d.id}><Check className="size-4" /> {d.status === "Pending" ? "Approve" : "Enable"}</Button>}
                      {d.status === "Active" && <Button variant="secondary" onClick={() => setStatus(d, "Disabled")} loading={busy === d.id}><Ban className="size-4" /> Disable</Button>}
                      <Button variant="ghost" onClick={() => setEditing(d)} aria-label={`Edit ${d.name || d.serialNo}`}><Pencil className="size-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <FormModal
          title={editing === "new" ? "Register machine" : editing.status === "Pending" ? `Approve ${editing.serialNo}` : `Edit ${editing.name || editing.serialNo}`}
          description={editing === "new" ? "Optional: machines that connect are listed automatically. Registering first approves the serial number in advance." : undefined}
          confirmLabel={editing !== "new" && editing.status === "Pending" ? "Approve" : "Save"}
          fields={[
            ...(editing === "new" ? [{ name: "serialNo", label: "Serial number", required: true, maxLength: 40, hint: "Menu → System Info → Device Info", placeholder: "e.g. CQUJ223260123" }] : []),
            { name: "name", label: "Name", required: true, maxLength: 60, placeholder: "e.g. Main gate", defaultValue: editing === "new" ? "" : editing.name ?? "" },
            { name: "location", label: "Location", maxLength: 80, placeholder: "e.g. Ground floor, staff entrance", defaultValue: editing === "new" ? "" : editing.location ?? "" },
            ...(editing !== "new" && editing.status !== "Pending" ? [{ name: "status", label: "Status", type: "select" as const, options: ["Active", "Disabled"], required: true, defaultValue: editing.status }] : []),
          ]}
          onSubmit={async (v) => {
            await api("/api/hr/biometric/devices", { method: "POST", body: { ...(editing === "new" ? {} : { id: editing.id }), ...v, status: editing === "new" || editing.status === "Pending" ? "Active" : v.status } });
            toast("Machine saved");
            setEditing(null);
            onChanged();
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

/* ======================= Punch log ======================= */

function PunchLog({ refresh, onChanged }: { refresh: number; onChanged: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(today);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [reapply, setReapply] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(search);
  // `r` only changes the URL so the log re-fetches when the parent refreshes; the API ignores it.
  const q = useApiQuery<Punch[]>(`/api/hr/biometric/punches${qs({ date, filter, search: debounced, page, r: refresh || undefined })}`);
  const rows = q.data ?? q.stale ?? [];

  async function importFile(file: File) {
    setError(null);
    if (file.size > 5_000_000) return setError("The file is larger than 5 MB. Export a shorter date range.");
    setImporting(true);
    try {
      const { data } = await api<{ inserted: number; duplicates: number; unmatched: number; applied: number; skipped: number }>("/api/hr/biometric/punches", { method: "POST", body: { action: "import", text: await file.text(), fileName: file.name } });
      toast(`Imported ${data.inserted} new punch(es)${data.duplicates ? `, ${data.duplicates} already received` : ""}${data.unmatched ? `, ${data.unmatched} unmatched` : ""} — ${data.applied} attendance day(s) updated`);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Card>
      <CardHeader
        title="Punch log"
        description="Every punch received, the employee it matched and whether it updated Daily Attendance."
        actions={
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept=".dat,.txt,.csv,text/plain,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
            <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={importing} title="attlog.dat from the machine's USB download, or a CSV of user ID, date and time"><Upload className="size-4" /> Import log file</Button>
            <Button variant="secondary" onClick={() => setReapply(true)}><RefreshCw className="size-4" /> Re-apply</Button>
          </div>
        }
      />
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-4">
        <input type="date" value={date} max={today()} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setPage(1); } }} className={inputClass} aria-label="Date" />
        <select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} className={inputClass} aria-label="Show">
          <option value="">All punches</option>
          <option value="unmatched">Unmatched user IDs</option>
          <option value="not-applied">Matched but not applied</option>
        </select>
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Employee, employee ID or machine user ID…" className={cx(inputClass, "pl-9")} aria-label="Search punches" />
        </div>
      </div>
      {error && <div className="border-b border-slate-100 p-3"><Alert>{error}</Alert></div>}
      {q.error && !q.stale ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : q.loading && !q.stale ? (
        <Spinner label="Loading punches…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No punches for this day" description={filter ? "Try “All punches”." : "Punches appear here as soon as an approved machine sends them."} />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/60">
              <tr>{["Time", "Employee", "Machine", "Method", "Attendance"].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-800">
                    {p.at.slice(11, 16)}<span className="text-slate-400">{p.at.slice(16)}</span>
                    {p.workDate && p.workDate !== p.at.slice(0, 10) && <div className="text-xs text-violet-700">Counts for {p.workDate} (night shift)</div>}
                  </td>
                  <td className="px-3 py-2">
                    {p.staffName ? (
                      <><span className="font-medium text-slate-900">{p.staffName}</span> <span className="font-mono text-xs text-slate-500">{p.staffCode}</span></>
                    ) : (
                      <span className="text-amber-800">Unknown</span>
                    )}
                    <div className="font-mono text-xs text-slate-500">Machine ID {p.pin}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{p.source === "Import" ? <Badge tone="slate">Imported file</Badge> : p.device ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{[p.verifyMode, p.state].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-3 py-2 text-xs">{p.note ? <span className="text-amber-800">{p.note}</span> : <span className="inline-flex items-center gap-1 text-emerald-700"><Check className="size-3.5" /> Applied</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination pagination={q.pagination} onPage={setPage} />
      {reapply && (
        <FormModal
          title="Re-apply punches"
          description="Matches punches to employees again — use it after adding or correcting Biometric IDs — and refreshes attendance. Days marked by hand, on leave or in a finalised payroll are not changed."
          confirmLabel="Re-apply"
          fields={[
            { name: "from", label: "From", type: "date", required: true, defaultValue: `${today().slice(0, 8)}01` },
            { name: "to", label: "To", type: "date", required: true, defaultValue: today() },
          ]}
          onSubmit={async (v) => {
            const { data } = await api<{ punches: number; rematched: number; applied: number; unmatched: number }>("/api/hr/biometric/punches", { method: "POST", body: { action: "reprocess", ...v } });
            toast(`${data.punches} punch(es) checked, ${data.rematched} re-matched — ${data.applied} attendance day(s) updated${data.unmatched ? `, ${data.unmatched} still unmatched` : ""}`);
            setReapply(false);
            onChanged();
          }}
          onClose={() => setReapply(false)}
        />
      )}
    </Card>
  );
}

