"use client";

import { Ambulance, ArrowRight, Clock, FileSpreadsheet, Fuel, MapPin, Phone, Plus, Printer, Search, Siren, Timer } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, qs } from "@/lib/client";
import { downloadCsv } from "@/lib/csv";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { TRIP_TYPES } from "@/lib/modules";
import { useApiQuery } from "@/lib/useApi";
import { TableCard } from "../TableCard";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Kbd, Pagination, Spinner, StatCard, cx, inputClass, statusTone, useDebounced, useHotkeys, useToast } from "../ui";
import { DispatchModal, type Board, type TripRow } from "./Dispatch";

/** Bespoke ambulance tabs: live dispatch board, trip register and reports. */
export function AmbulanceSection({ section }: { section: string }) {
  if (section === "trips") return <TripRegister />;
  if (section === "reports") return <AmbulanceReports />;
  return <DispatchBoard />;
}

const th = "whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;
export const TRIP_STATUSES = ["Requested", "Dispatched", "On Scene", "Transporting", "Arrived", "Completed", "Cancelled"];

export function tripTone(status: string) {
  if (status === "Requested") return "red" as const;
  if (status === "On Scene" || status === "Transporting") return "violet" as const;
  if (status === "Arrived") return "blue" as const;
  return statusTone(status);
}
export const priorityTone = (p: string) => (p === "Critical" ? "red" : p === "Urgent" ? "amber" : "slate") as "red" | "amber" | "slate";

/** "12 min" / "2 h 5 min" since `iso`. */
export function elapsed(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "—";
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

const NEXT: Record<string, { action: string; label: string; msg: string }> = {
  Dispatched: { action: "on-scene", label: "Reached pickup", msg: "Marked on scene" },
  "On Scene": { action: "transport", label: "Patient on board", msg: "Patient on board" },
};

/* ======================= Dispatch board ======================= */

function DispatchBoard() {
  const router = useRouter();
  const toast = useToast();
  const q = useApiQuery<Board>("/api/ambulance/board");
  const d = q.data ?? q.stale;
  const [dispatching, setDispatching] = useState<TripRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { reload } = q;
  // A dispatch board must stay current: refresh calls and the clock.
  useEffect(() => {
    const t = setInterval(() => {
      reload();
      setNow(Date.now());
    }, 30_000);
    return () => clearInterval(t);
  }, [reload]);
  useHotkeys({ F2: () => router.push("/ambulance/trips/new") }, !dispatching);

  async function step(t: TripRow) {
    const next = NEXT[t.status];
    if (t.status === "On Scene" && t.tripType === "Event Standby") return router.push(`/ambulance/trips/${t.id}`);
    setBusy(t.id);
    try {
      await api(`/api/ambulance/trips/${t.id}/action`, { method: "POST", body: { action: next.action } });
      toast(`${t.code}: ${next.msg}`);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  if (!d) return q.error ? <Card><ErrorState message={q.error} onRetry={reload} /></Card> : <Spinner label="Loading dispatch board…" />;
  const available = d.vehicles.filter((v) => v.status === "Available" && !v.blocked.length).length;
  const freeDrivers = d.staff.filter((s) => s.category === "Driver" && !s.onLeave && !s.onTrip).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open calls" value={d.open.length} hint={`${d.open.filter((t) => t.status === "Requested").length} waiting for an ambulance`} icon={<Siren className="size-5" />} tone={d.open.some((t) => t.status === "Requested") ? "red" : "brand"} />
        <StatCard label="Ambulances free" value={`${available} / ${d.vehicles.length}`} hint={`${freeDrivers} driver(s) free`} icon={<Ambulance className="size-5" />} tone={available ? "brand" : "amber"} />
        <StatCard label="Today" value={d.today.calls} hint={`${d.today.completed} completed · ${d.today.cancelled} cancelled`} icon={<Clock className="size-5" />} />
        <StatCard label="Response today" value={d.today.avgResponseMin === null ? "—" : `${d.today.avgResponseMin} min`} hint={d.today.avgReachMin === null ? "Call → dispatch" : `Call → dispatch · ${d.today.avgReachMin} min to reach`} icon={<Timer className="size-5" />} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Open calls" description="Highest priority and longest waiting first. Refreshes every 30 seconds." actions={<Link href="/ambulance/trips/new"><Button><Plus className="size-4" /> New call <Kbd>F2</Kbd></Button></Link>} />
          {d.open.length === 0 ? (
            <EmptyState title="No open calls" description="Log an incoming call with F2." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.open.map((t) => (
                <li key={t.id} className={cx("flex flex-wrap items-start gap-3 px-5 py-3", t.status === "Requested" && "bg-red-50/40")}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/ambulance/trips/${t.id}`} className="font-mono text-sm text-brand-700 hover:underline">{t.code}</Link>
                      <Badge tone={priorityTone(t.priority)}>{t.priority}</Badge>
                      <Badge tone={tripTone(t.status)}>{t.status}</Badge>
                      <span className="text-xs text-slate-500">{t.tripType} · {elapsed(t.requestedAt, now)} ago</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-900">{t.patientName ?? "Patient not named"}{t.condition ? <span className="text-slate-500"> — {t.condition}</span> : null}</p>
                    <p className="flex flex-wrap items-center gap-1 text-xs text-slate-600"><MapPin className="size-3.5" /> {t.pickupLocation}{t.dropLocation && <><ArrowRight className="size-3.5" /> {t.dropLocation}</>}</p>
                    <p className="flex items-center gap-1 text-xs text-slate-500"><Phone className="size-3.5" /> {t.callerName ? `${t.callerName} · ` : ""}{t.callerPhone}{t.vehicleNumber && ` · ${t.vehicleNumber} · ${t.driverName ?? ""}${t.crew.length ? ` + ${t.crew.join(", ")}` : ""}`}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {t.status === "Requested" && <Button onClick={() => setDispatching(t)}>Dispatch</Button>}
                    {NEXT[t.status] && <Button variant="secondary" loading={busy === t.id} onClick={() => step(t)}>{t.status === "On Scene" && t.tripType === "Event Standby" ? "Complete…" : NEXT[t.status].label}</Button>}
                    {(t.status === "Transporting" || t.status === "Arrived") && <Link href={`/ambulance/trips/${t.id}`}><Button variant="secondary">{t.status === "Transporting" ? "Arrived…" : "Complete…"}</Button></Link>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Fleet" actions={<Link href="/m/ambulance?tab=vehicles" className="text-xs font-medium text-brand-700 hover:underline">Vehicles</Link>} />
            {d.vehicles.length === 0 ? <p className="px-5 py-4 text-sm text-slate-500">No vehicles. Add them under Fleet → Vehicles.</p> : (
              <ul className="divide-y divide-slate-100">
                {d.vehicles.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                    <div>
                      <p className="font-medium text-slate-900">{v.vehicleNumber}</p>
                      <p className="text-xs text-slate-500">{v.type}{v.driverName ? ` · ${v.driverName}` : ""}</p>
                      {v.blocked.length > 0 && <p className="text-xs font-medium text-red-600">{v.blocked.join(", ")} expired</p>}
                    </div>
                    {v.trip ? <Link href={`/ambulance/trips/${v.trip.id}`}><Badge tone={tripTone(v.trip.status)}>{v.trip.code}</Badge></Link> : <Badge tone={statusTone(v.status)}>{v.status}</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Crew on the rolls" description="Drivers, paramedics, nurses and doctors from HR" />
            {d.staff.length === 0 ? <p className="px-5 py-4 text-sm text-slate-500">No drivers or paramedics in HR yet.</p> : (
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                {d.staff.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 px-5 py-2 text-sm">
                    <span><span className="text-slate-900">{s.name}</span> <span className="text-xs text-slate-500">{s.category}</span></span>
                    {s.onLeave ? <Badge tone="amber">On leave</Badge> : s.onTrip ? <Badge tone="violet">{s.onTrip}</Badge> : <Badge tone="green">Free</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      {dispatching && (
        <DispatchModal
          trip={dispatching}
          onClose={() => setDispatching(null)}
          onDispatch={async (payload) => {
            await api(`/api/ambulance/trips/${dispatching.id}/action`, { method: "POST", body: { action: "dispatch", ...payload } });
            toast(`${dispatching.code} dispatched`);
            setDispatching(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

/* ======================= Trip register ======================= */

function TripRegister() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [tripType, setTripType] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const searchRef = useRef<HTMLInputElement>(null);
  const q = useApiQuery<TripRow[]>(`/api/ambulance/trips${qs({ search: debounced, status, tripType, paymentStatus, from, to, page })}`);
  const rows = q.data ?? [];
  useHotkeys({ F2: () => router.push("/ambulance/trips/new"), F3: () => searchRef.current?.focus() });
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  return (
    <Card>
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-7">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input ref={searchRef} value={search} onChange={(e) => reset(setSearch)(e.target.value)} placeholder="Trip no., patient, caller, vehicle, place…  (F3)" className={cx(inputClass, "pl-9")} aria-label="Search trips" />
        </div>
        <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={inputClass} aria-label="Status">
          <option value="">All statuses</option>
          <option value="Active">On the road</option>
          {TRIP_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={tripType} onChange={(e) => reset(setTripType)(e.target.value)} className={inputClass} aria-label="Trip type">
          <option value="">All trip types</option>
          {TRIP_TYPES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={paymentStatus} onChange={(e) => reset(setPaymentStatus)(e.target.value)} className={inputClass} aria-label="Payment">
          <option value="">Any payment</option>
          {["Unpaid", "Partially Paid", "Paid", "On Hospital Bill", "No Charge", "Not Billed"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <input type="date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} className={inputClass} aria-label="From date" />
        <input type="date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} className={inputClass} aria-label="To date" />
      </div>
      <div className="flex items-center justify-end border-b border-slate-100 px-4 py-2.5">
        <Link href="/ambulance/trips/new"><Button><Plus className="size-4" /> New call <Kbd>F2</Kbd></Button></Link>
      </div>
      {q.loading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : rows.length === 0 ? (
        <EmptyState title={debounced || status || tripType || paymentStatus || from || to ? "No matching trips" : "No trips yet"} description="Calls logged on the Dispatch Board appear here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/60">
              <tr>{["Trip", "Called", "Patient", "From → To", "Vehicle / driver", "Km", "Charges", "Status", ""].map((h, i) => <th key={i} className={th}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((t) => (
                <tr key={t.id} onClick={() => router.push(`/ambulance/trips/${t.id}`)} className="cursor-pointer hover:bg-brand-50/40">
                  <td className="whitespace-nowrap px-4 py-2.5"><span className="font-mono text-xs text-brand-700">{t.code}</span><span className="block text-xs text-slate-500">{t.tripType}</span></td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{formatDateTime(t.requestedAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5"><span className="font-medium text-slate-900">{t.patientName ?? "—"}</span>{t.patientCode && <span className="ml-1 text-xs text-slate-500">{t.patientCode}</span>}<span className="block text-xs text-slate-500">{t.callerPhone}</span></td>
                  <td className="max-w-[16rem] px-4 py-2.5 text-slate-700"><span className="block truncate" title={`${t.pickupLocation} → ${t.dropLocation ?? ""}`}>{t.pickupLocation}{t.dropLocation ? ` → ${t.dropLocation}` : ""}</span></td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{t.vehicleNumber ?? "—"}<span className="block text-xs text-slate-500">{t.driverName}</span></td>
                  <td className="px-4 py-2.5 tabular-nums">{t.distanceKm ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{t.total != null ? formatMoney(t.total) : "—"}<span className="block"><Badge tone={statusTone(t.paymentStatus === "On Hospital Bill" ? "billed" : t.paymentStatus)}>{t.billCode ?? t.paymentStatus}</Badge></span></td>
                  <td className="whitespace-nowrap px-4 py-2.5"><Badge tone={tripTone(t.status)}>{t.status}</Badge>{t.priority !== "Routine" && <span className="ml-1"><Badge tone={priorityTone(t.priority)}>{t.priority}</Badge></span>}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs text-brand-700">Open →</td>
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

/* ======================= Reports ======================= */

interface Reports {
  from: string;
  to: string;
  totals: Record<string, number | null>;
  byType: { label: string; n: number; km: number; revenue: number }[];
  byPriority: { label: string; n: number; avgResponseMin: number | null }[];
  byVehicle: { id: string; vehicleNumber: string; type: string; status: string; trips: number; km: number; revenue: number; litres: number; fuelCost: number; kmPerLitre: number | null; serviceCost: number; odometer: number }[];
  byDriver: { label: string; trips: number; km: number }[];
  daily: { date: string; trips: number; km: number }[];
  compliance: { id: string; vehicleNumber: string; alerts: { label: string; date: string; overdue: boolean }[] }[];
  cancellations: { id: string; code: string; at: string; reason: string }[];
}

function AmbulanceReports() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const q = useApiQuery<Reports>(`/api/ambulance/reports${qs({ from, to })}`);
  const d = q.data;
  const mins = (n: number | null | undefined) => (n == null ? "—" : `${n} min`);
  function exportFleet() {
    if (!d) return;
    downloadCsv(`ambulance-fleet_${d.from}_${d.to}.csv`, ["Vehicle", "Type", "Trips", "Km", "Revenue", "Fuel (L)", "Fuel cost", "Km/L", "Service cost", "Odometer"],
      d.byVehicle.map((v) => [v.vehicleNumber, v.type, v.trips, v.km, v.revenue, v.litres, v.fuelCost, v.kmPerLitre, v.serviceCost, v.odometer]));
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-xs font-medium text-slate-600">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={cx(inputClass, "mt-1")} /></label>
        <label className="text-xs font-medium text-slate-600">To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={cx(inputClass, "mt-1")} /></label>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={exportFleet} disabled={!d}><FileSpreadsheet className="size-4" /> Fleet (CSV)</Button>
          <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
        </div>
      </div>
      {q.loading ? (
        <Spinner label="Preparing reports…" />
      ) : q.error ? (
        <Card><ErrorState message={q.error} onRetry={q.reload} /></Card>
      ) : d ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Calls" value={d.totals.calls} hint={`${d.totals.completed} completed · ${d.totals.cancelled} cancelled`} icon={<Siren className="size-5" />} />
            <StatCard label="Response time" value={mins(d.totals.avgResponseMin)} hint={`Reach scene ${mins(d.totals.avgReachMin)} · full cycle ${mins(d.totals.avgCycleMin)}`} icon={<Timer className="size-5" />} />
            <StatCard label="Revenue" value={formatMoney(d.totals.revenue)} hint={`Collected ${formatMoney(d.totals.collected)} · on hospital bills ${formatMoney(d.totals.onBills)}`} />
            <StatCard label="Uncollected" value={formatMoney(d.totals.uncollected)} tone={d.totals.uncollected ? "amber" : "slate"} />
            <StatCard label="Distance" value={`${d.totals.km} km`} icon={<MapPin className="size-5" />} />
            <StatCard label="Fuel" value={`${d.totals.fuelLitres} L`} hint={`${formatMoney(d.totals.fuelCost)}${d.totals.kmPerLitre ? ` · ${d.totals.kmPerLitre} km/L` : ""}`} icon={<Fuel className="size-5" />} />
            <StatCard label="Service & repairs" value={formatMoney(d.totals.serviceCost)} tone="slate" />
            <StatCard label="Compliance alerts" value={d.compliance.length} hint="Vehicles with documents or service due in 30 days" tone={d.compliance.some((c) => c.alerts.some((a) => a.overdue)) ? "red" : d.compliance.length ? "amber" : "slate"} />
          </div>
          <TableCard title="Fleet utilisation" headers={["Vehicle", "Trips", "Km", "Revenue", "Fuel (L)", "Fuel cost", "Km/L", "Service cost", "Odometer"]}
            rows={d.byVehicle.map((v) => [`${v.vehicleNumber} · ${v.type}`, v.trips, v.km, formatMoney(v.revenue), v.litres, formatMoney(v.fuelCost), v.kmPerLitre ?? "—", formatMoney(v.serviceCost), v.odometer])} empty="No vehicles." />
          <div className="grid gap-4 lg:grid-cols-2">
            <TableCard title="Compliance & service due" description="Within 30 days, or overdue" headers={["Vehicle", "Due"]}
              rows={d.compliance.map((c) => [c.vehicleNumber, <span key={c.id} className="space-x-1">{c.alerts.map((a) => <Badge key={a.label} tone={a.overdue ? "red" : "amber"}>{a.label} {formatDate(a.date)}</Badge>)}</span>])} empty="All documents are current." />
            <TableCard title="Trips by type" headers={["Type", "Trips", "Km", "Revenue"]} rows={d.byType.map((t) => [t.label, t.n, t.km, formatMoney(t.revenue)])} empty="No trips in this period." />
            <TableCard title="Response by priority" headers={["Priority", "Calls", "Avg call → dispatch"]} rows={d.byPriority.map((p) => [<Badge key={p.label} tone={priorityTone(p.label)}>{p.label}</Badge>, p.n, mins(p.avgResponseMin)])} empty="No calls in this period." />
            <TableCard title="Driver duty" headers={["Driver", "Trips", "Km"]} rows={d.byDriver.map((r) => [r.label, r.trips, r.km])} empty="No completed trips." />
            <TableCard title="Daily calls" headers={["Date", "Trips", "Km"]} rows={d.daily.map((r) => [formatDate(r.date), r.trips, r.km])} empty="No calls in this period." />
            <TableCard title="Cancelled calls" headers={["Trip", "Called", "Reason"]} rows={d.cancellations.map((c) => [<Link key={c.id} href={`/ambulance/trips/${c.id}`} className="font-mono text-xs text-brand-700 hover:underline">{c.code}</Link>, formatDateTime(c.at), c.reason])} empty="No cancellations." />
          </div>
        </>
      ) : null}
    </div>
  );
}
