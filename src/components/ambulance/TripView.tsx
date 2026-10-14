"use client";

import { ArrowLeft, Ban, CheckCircle2, Flag, IndianRupee, MapPin, Pencil, Printer, Truck, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { tripCharges, type Tariff, type TripCharges } from "@/lib/ambulance-math";
import { ApiClientError, api } from "@/lib/client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { FormModal, numOrUndefined, type ModalField, type ModalValues } from "../FormModal";
import { PayOnlineButton } from "../payments/Razorpay";
import { RefSelect, type RefOption } from "../RecordForm";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Modal, Spinner, cx, inputClass, useToast } from "../ui";
import { Figure, Info, Timeline } from "../DetailBits";
import { priorityTone, tripTone } from "./AmbulanceSection";
import { DispatchModal } from "./Dispatch";

export interface Trip {
  id: string;
  code: string;
  tripType: string;
  priority: string;
  status: string;
  callerName?: string;
  callerPhone: string;
  requestedAt: string;
  patient?: string;
  patientName?: string;
  patientCode?: string;
  patientAge?: number;
  patientGender?: string;
  condition?: string;
  pickupLocation: string;
  pickupLandmark?: string;
  dropLocation?: string;
  toHospital?: boolean;
  vehicleNumber?: string;
  vehicleType?: string;
  driverName?: string;
  driverPhone?: string;
  crew: { name: string; role: string; phone?: string }[];
  dispatchedAt?: string;
  onSceneAt?: string;
  departedAt?: string;
  arrivedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  odometerStart?: number;
  odometerEnd?: number;
  distanceKm?: number;
  waitingMinutes?: number;
  oxygenUsed?: boolean;
  ventilatorUsed?: boolean;
  tariffName?: string;
  charges?: TripCharges;
  discountReason?: string;
  billingMode?: string;
  payments: { mode: string; amount: number; reference?: string; at: string; byName?: string }[];
  paidAmount: number;
  paymentStatus: string;
  bill?: string;
  billCode?: string;
  visit?: string;
  visitCode?: string;
  events: { at: string; status: string; byName?: string; note?: string }[];
  notes?: string;
  createdByName?: string;
  tariff: (Tariff & { id: string }) | null;
  vehicleOdometer: number | null;
  night: boolean;
  hospital: { name: string; address: string; phone: string };
  timings: { responseMin: number | null; reachMin: number | null; sceneMin: number | null; transportMin: number | null; totalMin: number | null };
}

const STEPS = [
  { status: "Requested", at: "requestedAt", label: "Call received" },
  { status: "Dispatched", at: "dispatchedAt", label: "Dispatched" },
  { status: "On Scene", at: "onSceneAt", label: "At pickup" },
  { status: "Transporting", at: "departedAt", label: "Patient on board" },
  { status: "Arrived", at: "arrivedAt", label: "Reached destination" },
  { status: "Completed", at: "completedAt", label: "Completed" },
] as const;
const ACTIVE = ["Dispatched", "On Scene", "Transporting", "Arrived"];
const COLLECT_MODES = ["Cash", "Card", "UPI", "Bank Transfer"];
const mins = (n: number | null) => (n == null ? "—" : n < 60 ? `${n} min` : `${Math.floor(n / 60)} h ${n % 60} min`);

type Dialog = { title: string; description?: string; fields: ModalField[]; confirm: string; danger?: boolean; size?: "md" | "lg"; body: (v: ModalValues) => Record<string, unknown>; msg: string; preview?: (v: ModalValues) => ReactNode };

export function TripView({ id }: { id: string }) {
  const toast = useToast();
  const q = useApiQuery<Trip>(`/api/ambulance/trips/${id}`);
  const [latest, setLatest] = useState<Trip | null>(null);
  const trip = latest?.id === id ? latest : q.data;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const back = <Link href="/m/ambulance?tab=board" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 print:hidden"><ArrowLeft className="size-4" /> Back to dispatch board</Link>;
  if (q.error) return <>{back}<Card>{q.status === 404 ? <EmptyState title="Trip not found" /> : <ErrorState message={q.error} onRetry={q.reload} />}</Card></>;
  if (!trip) return <>{back}<Spinner label="Loading trip…" /></>;

  const run = async (body: Record<string, unknown>, msg: string) => {
    const { data } = await api<Trip>(`/api/ambulance/trips/${id}/action`, { method: "POST", body });
    setLatest(data);
    setDialog(null);
    toast(msg);
    return data;
  };
  const quick = async (action: string, msg: string) => {
    setBusy(action);
    try {
      await run({ action }, msg);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const s = trip.status;
  const open = s !== "Completed" && s !== "Cancelled";
  const balance = Math.max(0, (trip.charges?.total ?? 0) - (trip.paidAmount ?? 0));

  const completeDialog = (): Dialog => {
    const modes = trip.patient ? ["Hospital Bill", "Collect", "No Charge"] : ["Collect", "No Charge"];
    return {
      title: `Complete ${trip.code}`,
      description: trip.tariff ? `Tariff: ${trip.tariff.name}${trip.night ? " · night surcharge applies" : ""}` : `No active tariff for ${trip.vehicleType}. Add one under Ambulance → Tariffs, or choose No Charge.`,
      size: "lg",
      confirm: "Complete trip",
      msg: "Trip completed",
      fields: [
        ...(trip.odometerStart == null ? [{ name: "odometerStart", label: "Odometer at start (km)", type: "number" as const, required: true, min: 0, defaultValue: trip.vehicleOdometer != null ? String(trip.vehicleOdometer) : "" }] : []),
        { name: "odometerEnd", label: `Odometer at end (km)${trip.odometerStart != null ? ` — started ${trip.odometerStart}` : ""}`, type: "number", required: true, min: 0 },
        { name: "waitingMinutes", label: "Waiting (minutes)", type: "number", min: 0, defaultValue: "0" },
        { name: "oxygenUsed", label: "Oxygen used", type: "checkbox" },
        { name: "ventilatorUsed", label: "Ventilator / monitor used", type: "checkbox" },
        { name: "billingMode", label: "Charge to", type: "select", options: modes, required: true, defaultValue: trip.patient ? "Hospital Bill" : "Collect", hint: trip.patient ? "Hospital Bill adds the charges to the patient's running bill" : "Link the registered patient to charge their hospital bill" },
        { name: "discount", label: "Discount", type: "number", min: 0 },
        { name: "discountReason", label: "Discount / free-trip reason", maxLength: 200, wide: true },
        { name: "payMode", label: "Collected now by", type: "select", options: COLLECT_MODES, hint: "Only when collecting on the trip" },
        { name: "payAmount", label: "Amount collected now", type: "number", min: 0 },
        { name: "payReference", label: "Card / UPI / UTR reference", maxLength: 60, wide: true },
      ],
      preview: (v) => {
        const start = trip.odometerStart ?? numOrUndefined(v.odometerStart);
        const end = numOrUndefined(v.odometerEnd);
        const km = start != null && end != null && end >= start ? Math.round((end - start) * 100) / 100 : null;
        if (v.billingMode === "No Charge") return <Alert tone="amber">No charge — enter the reason.</Alert>;
        if (!trip.tariff) return null;
        if (km == null) return <p className="text-sm text-slate-500">Enter the closing odometer to see the charges.</p>;
        const c = tripCharges(trip.tariff, { distanceKm: km, waitingMinutes: numOrUndefined(v.waitingMinutes) ?? 0, night: trip.night, oxygen: v.oxygenUsed === true, ventilator: v.ventilatorUsed === true, discount: numOrUndefined(v.discount) ?? 0 });
        return <ChargeTable charges={c} km={km} compact />;
      },
      body: (v) => ({
        action: "complete",
        odometerStart: numOrUndefined(v.odometerStart),
        odometerEnd: numOrUndefined(v.odometerEnd),
        waitingMinutes: numOrUndefined(v.waitingMinutes) ?? 0,
        oxygenUsed: v.oxygenUsed === true,
        ventilatorUsed: v.ventilatorUsed === true,
        billingMode: v.billingMode,
        discount: numOrUndefined(v.discount) ?? 0,
        discountReason: v.discountReason,
        payment: v.billingMode === "Collect" && numOrUndefined(v.payAmount) ? { mode: v.payMode, amount: numOrUndefined(v.payAmount), reference: v.payReference } : undefined,
      }),
    };
  };

  const actions: ReactNode[] = [];
  if (s === "Requested") actions.push(<Button key="dispatch" onClick={() => setDispatching(true)}><Truck className="size-4" /> Dispatch</Button>);
  if (s === "Dispatched") actions.push(<Button key="scene" loading={busy === "on-scene"} onClick={() => quick("on-scene", "Reached pickup")}><MapPin className="size-4" /> Reached pickup</Button>);
  if (s === "On Scene" && trip.tripType !== "Event Standby") actions.push(<Button key="transport" loading={busy === "transport"} onClick={() => quick("transport", "Patient on board")}><Truck className="size-4" /> Patient on board</Button>);
  if (s === "Transporting") {
    actions.push(<Button key="arrive" onClick={() => setDialog({
      title: "Reached destination", confirm: "Mark arrived", msg: "Arrived",
      fields: trip.toHospital && trip.patient ? [{ name: "registerVisit", label: "Open an Emergency visit for the patient (OPD / IPD)", type: "checkbox", defaultValue: trip.tripType === "Emergency" }] : [],
      body: (v) => ({ action: "arrive", registerVisit: v.registerVisit === true }),
    })}><Flag className="size-4" /> Arrived</Button>);
  }
  if (ACTIVE.includes(s) && s !== "Dispatched") actions.push(<Button key="complete" variant={s === "Arrived" ? "primary" : "secondary"} onClick={() => setDialog(completeDialog())}><CheckCircle2 className="size-4" /> Complete</Button>);
  if (s === "Completed" && trip.billingMode === "Collect" && balance > 0) {
    actions.push(<Button key="pay" onClick={() => setDialog({
      title: "Collect payment", description: `Due ${formatMoney(balance)}`, confirm: "Record payment", msg: "Payment recorded",
      fields: [{ name: "mode", label: "Mode", type: "select", options: COLLECT_MODES, required: true, defaultValue: "Cash" }, { name: "amount", label: "Amount", type: "number", required: true, min: 0, defaultValue: String(balance) }, { name: "reference", label: "Reference", maxLength: 60 }],
      body: (v) => ({ action: "pay", mode: v.mode, amount: numOrUndefined(v.amount), reference: v.reference }),
    })}><IndianRupee className="size-4" /> Collect payment</Button>);
    actions.push(<PayOnlineButton key="pay-online" kind="ambulance_trip" id={trip.id} due={balance} onPaid={() => api<Trip>(`/api/ambulance/trips/${id}`).then(({ data }) => { setLatest(data); toast("Online payment received and recorded"); }, () => q.reload())} />);
  }
  if (open && !trip.patient) actions.push(<Button key="link" variant="secondary" onClick={() => setLinking(true)}><UserPlus className="size-4" /> Link patient</Button>);
  if (open) {
    actions.push(<Button key="edit" variant="secondary" onClick={() => setDialog({
      title: "Update call details", confirm: "Save", msg: "Trip updated",
      fields: [
        { name: "condition", label: "Condition / reason", maxLength: 500, defaultValue: trip.condition ?? "" },
        { name: "dropLocation", label: "Drop location", maxLength: 200, defaultValue: trip.dropLocation ?? "" },
        { name: "toHospital", label: "Patient is being brought to this hospital", type: "checkbox", defaultValue: trip.toHospital !== false },
        { name: "notes", label: "Notes", type: "textarea", maxLength: 500, defaultValue: trip.notes ?? "" },
      ],
      body: (v) => ({ action: "update", condition: v.condition, dropLocation: v.dropLocation, toHospital: v.toHospital === true, notes: v.notes }),
    })}><Pencil className="size-4" /> Edit</Button>);
    actions.push(<Button key="cancel" variant="secondary" className="text-red-600" onClick={() => setDialog({
      title: `Cancel ${trip.code}?`, description: trip.vehicleNumber ? `${trip.vehicleNumber} is released back to the fleet.` : undefined, confirm: "Cancel trip", danger: true, msg: "Trip cancelled",
      fields: [{ name: "reason", label: "Reason", required: true, maxLength: 300, placeholder: "e.g. hoax call, patient went by own transport" }],
      body: (v) => ({ action: "cancel", reason: v.reason }),
    })}><Ban className="size-4" /> Cancel</Button>);
  }
  actions.push(<Link key="slip" href={`/ambulance/trips/${trip.id}/slip`} target="_blank"><Button variant="secondary"><Printer className="size-4" /> Trip sheet</Button></Link>);

  const reached = STEPS.findIndex((x) => x.status === s);
  return (
    <>
      {back}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-900">Trip <span className="font-mono">{trip.code}</span></h1>
            <Badge tone={tripTone(s)}>{s}</Badge>
            <Badge tone={priorityTone(trip.priority)}>{trip.priority}</Badge>
            <Badge tone="slate">{trip.tripType}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">Call from {trip.callerName ? `${trip.callerName}, ` : ""}{trip.callerPhone} at {formatDateTime(trip.requestedAt)} · logged by {trip.createdByName ?? "—"}</p>
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>

      {s === "Cancelled" && <div className="mb-4"><Alert tone="amber">Cancelled {formatDateTime(trip.cancelledAt)}: {trip.cancelReason}</Alert></div>}

      {s !== "Cancelled" && (
        <Card className="mb-5 p-4">
          <ol className="grid gap-3 sm:grid-cols-6">
            {STEPS.map((step, i) => {
              const at = trip[step.at as keyof Trip] as string | undefined;
              const done = i <= reached || !!at;
              return (
                <li key={step.status} className={cx("border-t-4 pt-2 text-xs", done ? "border-brand-600" : "border-slate-200")}>
                  <p className={cx("font-medium", done ? "text-slate-900" : "text-slate-400")}>{step.label}</p>
                  <p className="text-slate-500">{at ? formatDateTime(at) : "—"}</p>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <div className="grid gap-4 sm:grid-cols-3">
            <Figure label="Call → dispatch" value={mins(trip.timings.responseMin)} tone={trip.timings.responseMin != null && trip.timings.responseMin > 10 ? "amber" : undefined} />
            <Figure label="Dispatch → scene" value={mins(trip.timings.reachMin)} />
            <Figure label="Total" value={mins(trip.timings.totalMin)} hint={trip.distanceKm != null ? `${trip.distanceKm} km` : undefined} />
          </div>
          <Card>
            <CardHeader title="Patient & route" />
            <dl className="grid gap-4 p-5 sm:grid-cols-2">
              <Info label="Patient" value={trip.patientName ? `${trip.patientName}${trip.patientCode ? ` (${trip.patientCode})` : " — not registered"}${trip.patientAge != null ? ` · ${trip.patientAge}y` : ""}${trip.patientGender ? ` · ${trip.patientGender}` : ""}` : "Not named"} />
              <Info label="Condition" value={trip.condition} />
              <Info label="Pickup" value={`${trip.pickupLocation}${trip.pickupLandmark ? `\nNear ${trip.pickupLandmark}` : ""}`} />
              <Info label="Drop" value={trip.dropLocation} />
              {trip.visitCode && <Info label="Emergency visit" value={trip.visitCode} />}
              {trip.notes && <Info label="Notes" value={trip.notes} wide />}
            </dl>
            {trip.patient && <p className="px-5 pb-4 text-sm"><Link href={`/patients/${trip.patient}`} className="text-brand-700 hover:underline">Open patient record →</Link></p>}
          </Card>
          <Card>
            <CardHeader title="Vehicle & crew" />
            {trip.vehicleNumber ? (
              <dl className="grid gap-4 p-5 sm:grid-cols-2">
                <Info label="Ambulance" value={`${trip.vehicleNumber} · ${trip.vehicleType}`} />
                <Info label="Driver" value={trip.driverName ? `${trip.driverName}${trip.driverPhone ? ` · ${trip.driverPhone}` : ""}` : undefined} />
                <Info label="Crew" value={trip.crew.length ? trip.crew.map((c) => `${c.name} (${c.role})`).join("\n") : "Driver only"} />
                <Info label="Odometer" value={trip.odometerStart != null ? `${trip.odometerStart}${trip.odometerEnd != null ? ` → ${trip.odometerEnd} km` : " km at start"}` : undefined} />
              </dl>
            ) : <p className="px-5 py-4 text-sm text-slate-500">Not dispatched yet.</p>}
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Charges" description={trip.tariffName ? `Tariff ${trip.tariffName}` : undefined} />
            <div className="space-y-3 p-5 text-sm">
              {trip.charges ? <ChargeTable charges={trip.charges} km={trip.distanceKm ?? 0} /> : <p className="text-slate-500">Calculated from the tariff when the trip is completed.</p>}
              {trip.discountReason && <p className="text-xs text-slate-500">{trip.billingMode === "No Charge" ? "Free trip" : "Discount"}: {trip.discountReason}</p>}
              <p><Badge tone={trip.paymentStatus === "Paid" || trip.paymentStatus === "On Hospital Bill" ? "green" : trip.paymentStatus === "No Charge" ? "slate" : "amber"}>{trip.paymentStatus}</Badge></p>
              {trip.billCode && <p>Added to hospital bill <span className="font-mono text-brand-700">{trip.billCode}</span>; collected through Billing.</p>}
              {trip.payments.length > 0 && (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {trip.payments.map((p, i) => <li key={i} className="flex justify-between px-3 py-1.5"><span>{p.mode}{p.reference ? ` · ${p.reference}` : ""}<span className="block text-xs text-slate-500">{formatDateTime(p.at)} · {p.byName}</span></span><span className="tabular-nums">{formatMoney(p.amount)}</span></li>)}
                </ul>
              )}
              {trip.billingMode === "Collect" && balance > 0 && <p className="font-medium text-red-600">Due {formatMoney(balance)}</p>}
            </div>
          </Card>
          <Timeline events={trip.events.map((e) => ({ at: e.at, action: e.status, byName: e.byName, note: e.note }))} />
        </div>
      </div>

      {dialog && (
        <FormModal title={dialog.title} description={dialog.description} fields={dialog.fields} confirmLabel={dialog.confirm} danger={dialog.danger} size={dialog.size} onClose={() => setDialog(null)} onSubmit={(v) => run(dialog.body(v), dialog.msg)}>
          {dialog.preview}
        </FormModal>
      )}
      {dispatching && <DispatchModal trip={trip} onClose={() => setDispatching(false)} onDispatch={async (payload) => { await run({ action: "dispatch", ...payload }, "Dispatched"); setDispatching(false); }} />}
      {linking && <LinkPatientModal onClose={() => setLinking(false)} onLink={async (patient) => { await run({ action: "update", patient }, "Patient linked"); setLinking(false); }} />}
    </>
  );
}

export function ChargeTable({ charges: c, km, compact }: { charges: TripCharges; km: number; compact?: boolean }) {
  const rows: [string, number][] = [
    ["Base fare", c.base],
    [`Distance (${km} km)`, c.distance],
    ["Waiting", c.waiting],
    ["Night surcharge", c.night],
    ["Oxygen / equipment", c.equipment],
  ];
  return (
    <table className={cx("w-full text-sm", compact && "rounded-lg bg-slate-50")}>
      <tbody>
        {rows.filter(([, v]) => v > 0).map(([k, v]) => <tr key={k}><td className="px-2 py-0.5 text-slate-600">{k}</td><td className="px-2 py-0.5 text-right tabular-nums">{formatMoney(v)}</td></tr>)}
        {c.discount > 0 && <tr><td className="px-2 py-0.5 text-slate-600">Discount</td><td className="px-2 py-0.5 text-right tabular-nums">−{formatMoney(c.discount)}</td></tr>}
        <tr className="border-t border-slate-200 font-semibold"><td className="px-2 py-1">Total</td><td className="px-2 py-1 text-right tabular-nums">{formatMoney(c.total)}</td></tr>
      </tbody>
    </table>
  );
}

const patientRef = { name: "patient", label: "Patient", type: "ref" as const, ref: "patients.patients", required: true };

function LinkPatientModal({ onClose, onLink }: { onClose: () => void; onLink: (patient: string) => Promise<unknown> }) {
  const [patient, setPatient] = useState<RefOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!patient) return;
    setBusy(true);
    setError(null);
    try {
      await onLink(patient.id);
    } catch (e) {
      setError(e instanceof ApiClientError && e.fields ? Object.values(e.fields)[0] : (e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} size="md" title="Link registered patient" description="Register the patient in Patients first if they are new."
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Back</Button><Button onClick={submit} loading={busy} disabled={!patient}>Link patient</Button></>}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Patient" htmlFor="link-patient" required>
          <RefSelect id="link-patient" field={patientRef} value={patient?.id ?? ""} className={inputClass} onChange={() => {}} onPick={setPatient} />
        </Field>
      </div>
    </Modal>
  );
}
