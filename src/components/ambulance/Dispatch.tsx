"use client";

import { Plus, Trash2, Truck } from "lucide-react";
import { useState } from "react";
import { ApiClientError } from "@/lib/client";
import { useApiQuery } from "@/lib/useApi";
import { Alert, Button, Field, Modal, Spinner, cx, inputClass } from "../ui";

/* ---------- API shapes (see lib/ambulance.ts) ---------- */

export interface TripRow {
  id: string;
  code: string;
  requestedAt: string;
  tripType: string;
  priority: string;
  patientName: string | null;
  patientCode: string | null;
  patient: string | null;
  callerName: string | null;
  callerPhone: string;
  condition: string | null;
  pickupLocation: string;
  dropLocation: string | null;
  vehicleNumber: string | null;
  vehicleType: string | null;
  driverName: string | null;
  crew: string[];
  status: string;
  dispatchedAt: string | null;
  onSceneAt: string | null;
  distanceKm: number | null;
  total: number | null;
  paymentStatus: string;
  billCode: string | null;
}

export interface BoardVehicle {
  id: string;
  vehicleNumber: string;
  type: string;
  status: string;
  equipment: string[];
  defaultDriver: string | null;
  driverName: string | null;
  odometer: number;
  baseLocation: string | null;
  blocked: string[];
  trip: { id: string; code: string; status: string } | null;
}

export interface BoardStaff {
  id: string;
  code: string;
  name: string;
  category: string;
  phone: string;
  onLeave: boolean;
  onTrip: string | null;
}

export interface Board {
  open: TripRow[];
  vehicles: BoardVehicle[];
  staff: BoardStaff[];
  today: { calls: number; completed: number; cancelled: number; avgResponseMin: number | null; avgReachMin: number | null };
}

export interface DispatchValue {
  vehicle: string;
  driver: string;
  crew: { staff: string; role: string }[];
  odometerStart: string;
}

export const CREW_ROLES = ["Paramedic / EMT", "Nurse", "Doctor", "Attendant"];
export const emptyDispatch: DispatchValue = { vehicle: "", driver: "", crew: [], odometerStart: "" };

const roleFor = (category: string) => (category === "Nurse" || category === "Doctor" || category === "Paramedic / EMT" ? category : "Attendant");
const free = (s: BoardStaff) => !s.onLeave && !s.onTrip;

/** Vehicle, driver and crew pickers fed by the live board (only free resources can be chosen). */
export function DispatchFields({ board, value, onChange, errors = {}, tripType }: { board: Board; value: DispatchValue; onChange: (v: DispatchValue) => void; errors?: Record<string, string>; tripType: string }) {
  const deadBody = tripType === "Dead Body Transfer";
  const vehicles = board.vehicles.filter((v) => (v.type === "Mortuary Van") === deadBody);
  const drivers = board.staff.filter((s) => s.category === "Driver");
  const crewPool = board.staff.filter((s) => s.category !== "Driver");
  const set = (patch: Partial<DispatchValue>) => onChange({ ...value, ...patch });

  function pickVehicle(id: string) {
    const v = board.vehicles.find((x) => x.id === id);
    const regular = v?.defaultDriver ? drivers.find((d) => d.id === v.defaultDriver && free(d)) : undefined;
    set({ vehicle: id, odometerStart: v ? String(v.odometer) : "", driver: value.driver || regular?.id || "" });
  }
  const label = (s: BoardStaff) => `${s.name} (${s.code})${s.onLeave ? " — on leave" : s.onTrip ? ` — on ${s.onTrip}` : ""}`;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Ambulance" htmlFor="d-vehicle" required error={errors.vehicle}>
        <select id="d-vehicle" value={value.vehicle} onChange={(e) => pickVehicle(e.target.value)} className={inputClass}>
          <option value="">Select…</option>
          {vehicles.map((v) => {
            const ok = v.status === "Available" && !v.blocked.length;
            return <option key={v.id} value={v.id} disabled={!ok}>{v.vehicleNumber} · {v.type}{!ok ? ` — ${v.blocked.length ? `${v.blocked.join(", ")} expired` : v.trip ? `on ${v.trip.code}` : v.status.toLowerCase()}` : v.baseLocation ? ` · ${v.baseLocation}` : ""}</option>;
          })}
        </select>
      </Field>
      <Field label="Odometer at start (km)" htmlFor="d-odo" error={errors.odometerStart}>
        <input id="d-odo" type="number" min={0} value={value.odometerStart} onChange={(e) => set({ odometerStart: e.target.value })} className={inputClass} />
      </Field>
      <Field label="Driver" htmlFor="d-driver" required error={errors.driver} className="sm:col-span-2" hint={drivers.length ? undefined : "No staff in the Driver category. Add drivers in HR → Employees."}>
        <select id="d-driver" value={value.driver} onChange={(e) => set({ driver: e.target.value })} className={inputClass}>
          <option value="">Select…</option>
          {drivers.map((s) => <option key={s.id} value={s.id} disabled={!free(s)}>{label(s)}</option>)}
        </select>
      </Field>
      <div className="space-y-2 sm:col-span-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Crew <span className="text-xs font-normal text-slate-400">(paramedic, nurse, doctor)</span></span>
          {value.crew.length < 4 && <Button type="button" variant="ghost" onClick={() => set({ crew: [...value.crew, { staff: "", role: "Paramedic / EMT" }] })}><Plus className="size-4" /> Add crew</Button>}
        </div>
        {value.crew.map((c, i) => (
          <div key={i} className="flex gap-2">
            <select value={c.staff} onChange={(e) => {
              const s = crewPool.find((x) => x.id === e.target.value);
              set({ crew: value.crew.map((x, j) => (j === i ? { staff: e.target.value, role: s ? roleFor(s.category) : x.role } : x)) });
            }} className={cx(inputClass, "flex-1")} aria-label="Crew member">
              <option value="">Select…</option>
              {crewPool.map((s) => <option key={s.id} value={s.id} disabled={!free(s) || value.crew.some((x, j) => j !== i && x.staff === s.id)}>{label(s)} · {s.category}</option>)}
            </select>
            <select value={c.role} onChange={(e) => set({ crew: value.crew.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })} className={cx(inputClass, "w-40")} aria-label="Role">
              {CREW_ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
            <button type="button" onClick={() => set({ crew: value.crew.filter((_, j) => j !== i) })} className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove crew member"><Trash2 className="size-4" /></button>
          </div>
        ))}
        {errors.crew && <p className="text-xs text-red-600">{errors.crew}</p>}
      </div>
    </div>
  );
}

export function dispatchPayload(v: DispatchValue) {
  return { vehicle: v.vehicle, driver: v.driver, crew: v.crew.filter((c) => c.staff), odometerStart: v.odometerStart === "" ? undefined : Number(v.odometerStart) };
}

/** Assign an ambulance and crew to a requested call. */
export function DispatchModal({ trip, onClose, onDispatch }: { trip: { code: string; tripType: string; priority: string; pickupLocation: string }; onClose: () => void; onDispatch: (payload: ReturnType<typeof dispatchPayload>) => Promise<unknown> }) {
  const q = useApiQuery<Board>("/api/ambulance/board");
  const [value, setValue] = useState<DispatchValue>(emptyDispatch);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onDispatch(dispatchPayload(value));
    } catch (e) {
      if (e instanceof ApiClientError && e.fields) setErrors(e.fields);
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`Dispatch ${trip.code}`} description={`${trip.priority} · ${trip.tripType} · ${trip.pickupLocation}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Back</Button><Button onClick={submit} loading={busy} disabled={!value.vehicle || !value.driver}><Truck className="size-4" /> Dispatch</Button></>}>
      {q.loading ? <Spinner label="Checking fleet and crew…" /> : q.error ? <Alert>{q.error}</Alert> : q.data ? (
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <DispatchFields board={q.data} value={value} onChange={setValue} errors={errors} tripType={trip.tripType} />
        </div>
      ) : null}
    </Modal>
  );
}
