"use client";

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { amountInWords } from "@/lib/billing-math";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { Button, Card, EmptyState, ErrorState, Kbd, Spinner, useHotkeys } from "../ui";
import { ChargeTable, type Trip } from "./TripView";

/** Trip sheet for the crew file, doubling as the patient's receipt once completed. */
export function TripSlip({ id }: { id: string }) {
  const q = useApiQuery<Trip>(`/api/ambulance/trips/${id}`);
  const t = q.data;
  useHotkeys({ "ctrl+p": () => window.print() });
  useEffect(() => {
    if (t) document.title = `Trip sheet ${t.code}${t.patientName ? ` - ${t.patientName}` : ""}`;
  }, [t]);

  if (q.error) return <Card className="mx-auto max-w-xl">{q.status === 404 ? <EmptyState title="Not found" description={q.error} /> : <ErrorState message={q.error} onRetry={q.reload} />}</Card>;
  if (!t) return <Spinner label="Loading…" />;
  const rows: [string, string | undefined][] = [
    ["Trip type", `${t.tripType} · ${t.priority}`],
    ["Caller", `${t.callerName ? `${t.callerName}, ` : ""}${t.callerPhone}`],
    ["Patient", t.patientName ? `${t.patientName}${t.patientCode ? ` (${t.patientCode})` : ""}${t.patientAge != null ? `, ${t.patientAge}y` : ""}${t.patientGender ? ` ${t.patientGender}` : ""}` : undefined],
    ["Condition", t.condition],
    ["Pickup", `${t.pickupLocation}${t.pickupLandmark ? ` (near ${t.pickupLandmark})` : ""}`],
    ["Drop", t.dropLocation],
    ["Ambulance", t.vehicleNumber ? `${t.vehicleNumber} · ${t.vehicleType}` : undefined],
    ["Driver", t.driverName ? `${t.driverName}${t.driverPhone ? ` · ${t.driverPhone}` : ""}` : undefined],
    ["Crew", t.crew.length ? t.crew.map((c) => `${c.name} (${c.role})`).join(", ") : undefined],
    ["Odometer", t.odometerStart != null ? `${t.odometerStart} → ${t.odometerEnd ?? "…"} km${t.distanceKm != null ? ` (${t.distanceKm} km)` : ""}` : undefined],
  ];
  const times: [string, string | undefined][] = [
    ["Call received", t.requestedAt],
    ["Dispatched", t.dispatchedAt],
    ["At pickup", t.onSceneAt],
    ["Patient on board", t.departedAt],
    ["Reached", t.arrivedAt],
    ["Completed", t.completedAt],
  ];
  return (
    <>
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between gap-3 print:hidden">
        <Link href={`/ambulance/trips/${t.id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Back to trip</Link>
        <Button onClick={() => window.print()}><Printer className="size-4" /> Print / PDF <Kbd>Ctrl+P</Kbd></Button>
      </div>
      <div className="mx-auto max-w-3xl rounded-lg border border-slate-300 bg-white p-8 text-[13px] text-black shadow-sm print:border-0 print:shadow-none">
        <div className="border-b-2 border-slate-800 pb-3 text-center">
          <p className="text-lg font-bold uppercase tracking-wide">{t.hospital.name}</p>
          {t.hospital.address && <p className="text-xs">{t.hospital.address}</p>}
          {t.hospital.phone && <p className="text-xs">Ambulance / emergency: {t.hospital.phone}</p>}
          <p className="mt-2 text-sm font-semibold">Ambulance trip sheet{t.status === "Completed" && t.billingMode === "Collect" ? " & receipt" : ""}</p>
        </div>
        <div className="mt-3 flex justify-between text-sm">
          <span>Trip no. <strong className="font-mono">{t.code}</strong></span>
          <span>Status: <strong>{t.status}</strong></span>
        </div>
        <dl className="mt-3 grid gap-y-1">
          {rows.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="grid grid-cols-[9rem_1fr] border-b border-dotted border-slate-300 py-0.5"><dt className="text-slate-600">{k}</dt><dd className="font-medium">{v}</dd></div>
          ))}
        </dl>
        <table className="mt-4 w-full border border-slate-300 text-xs">
          <thead><tr className="bg-slate-100">{times.map(([k]) => <th key={k} className="px-1 py-1 font-semibold">{k}</th>)}</tr></thead>
          <tbody><tr>{times.map(([k, v]) => <td key={k} className="px-1 py-1 text-center">{v ? formatDateTime(v) : "—"}</td>)}</tr></tbody>
        </table>
        {t.charges && t.billingMode !== "No Charge" && (
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="mb-1 font-semibold">Charges ({t.tariffName})</p>
              <ChargeTable charges={t.charges} km={t.distanceKm ?? 0} />
            </div>
            <div className="space-y-1">
              <p className="font-semibold">Payment</p>
              {t.billingMode === "Hospital Bill" ? <p>Added to hospital bill <strong className="font-mono">{t.billCode}</strong>.</p> : (
                <>
                  {t.payments.map((p, i) => <p key={i} className="flex justify-between"><span>{p.mode}{p.reference ? ` · ${p.reference}` : ""}</span><span className="tabular-nums">{formatMoney(p.amount)}</span></p>)}
                  <p className="flex justify-between border-t border-slate-300 pt-1 font-semibold"><span>Paid</span><span className="tabular-nums">{formatMoney(t.paidAmount)}</span></p>
                  {t.paidAmount > 0 && <p className="text-xs">{amountInWords(t.paidAmount)}</p>}
                  {(t.charges.total ?? 0) - (t.paidAmount ?? 0) > 0 && <p className="font-semibold">Balance due {formatMoney(t.charges.total - t.paidAmount)}</p>}
                </>
              )}
            </div>
          </div>
        )}
        {t.billingMode === "No Charge" && <p className="mt-4 font-semibold">No charge{t.discountReason ? ` — ${t.discountReason}` : ""}.</p>}
        <div className="mt-12 grid grid-cols-3 gap-6 text-center text-xs">
          <p className="border-t border-slate-400 pt-1">Driver</p>
          <p className="border-t border-slate-400 pt-1">Paramedic / crew</p>
          <p className="border-t border-slate-400 pt-1">Patient / attendant</p>
        </div>
      </div>
    </>
  );
}
