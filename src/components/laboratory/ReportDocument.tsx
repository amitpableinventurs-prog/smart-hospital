"use client";

import { formatDateTime } from "@/lib/format";
import { cx } from "../ui";
import { Barcode, FLAG_LABEL, byCategory, rangeLabel, type LabItem, type LabOrder } from "./shared";

/** Printable lab report: approved results only, grouped by category. */
export function ReportDocument({ order }: { order: LabOrder }) {
  const live = order.items.filter((i) => i.status !== "Cancelled");
  const approved = live.filter((i) => i.status === "Approved");
  const pending = order.shared ? 0 : live.length - approved.length;
  const groups = byCategory(approved);
  const samples = new Map(order.samples.map((s) => [s.accessionNo, s]));
  const firstSample = approved.map((i) => samples.get(i.sampleNo ?? "")).find(Boolean);
  const signatories = [...new Map(approved.filter((i) => i.pathologistName).map((i) => [i.pathologistName, i])).values()];
  const technicians = [...new Set(approved.map((i) => i.verifiedByName).filter(Boolean))];
  const lastApproval = approved.map((i) => i.approvedAt ?? "").sort().pop();

  return (
    <article className="mx-auto max-w-4xl bg-white p-8 text-slate-900 shadow-sm ring-1 ring-slate-200 print:max-w-none print:p-0 print:shadow-none print:ring-0">
      <header className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-3">
        <div>
          <h1 className="text-xl font-bold">{order.lab.name}</h1>
          <p className="text-sm font-medium text-slate-700">{order.lab.department}</p>
          {order.lab.address && <p className="text-xs text-slate-600">{order.lab.address}</p>}
          <p className="text-xs text-slate-600">{[order.lab.phone && `Ph: ${order.lab.phone}`, order.lab.accreditation].filter(Boolean).join("  ·  ")}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold uppercase tracking-wide">Laboratory Report</p>
          <Barcode value={order.code} height={26} className="ml-auto mt-1 h-7 w-40" />
          <p className="font-mono text-xs">{order.code}</p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-x-6 gap-y-1 border-b border-slate-300 py-2 text-[13px]">
        <Meta label="Patient" value={order.patientName} strong />
        <Meta label="Lab no." value={order.code} />
        <Meta label="Age / sex" value={[order.patientAge != null ? `${order.patientAge} years` : null, order.patientGender].filter(Boolean).join(" / ") || "—"} />
        <Meta label="Registered" value={formatDateTime(order.orderDate)} />
        <Meta label="Patient ID" value={order.patientCode ?? "—"} />
        <Meta label="Collected" value={firstSample?.collectedAt ? formatDateTime(firstSample.collectedAt) : "—"} />
        <Meta label="Referred by" value={order.doctorName ? `Dr. ${order.doctorName.replace(/^Dr\.?\s*/i, "")}` : "Self"} />
        <Meta label="Received" value={firstSample?.receivedAt ? formatDateTime(firstSample.receivedAt) : "—"} />
        <Meta label="Type" value={[order.source, order.wardBed].filter(Boolean).join(" · ")} />
        <Meta label="Reported" value={lastApproval ? formatDateTime(lastApproval) : "—"} />
      </section>

      {pending > 0 && <p className="mt-2 rounded bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 print:border print:border-amber-300">Partial report — {pending} test{pending === 1 ? "" : "s"} still in progress.</p>}

      {groups.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">No approved results yet.</p>
      ) : (
        groups.map((g) => (
          <section key={g.name} className="mt-4 break-inside-avoid-page">
            <h2 className="border-b border-slate-800 pb-0.5 text-center text-sm font-bold uppercase tracking-widest">{g.name}</h2>
            {g.items.map((item) => <ItemBlock key={item.id} item={item} />)}
          </section>
        ))
      )}

      <p className="mt-3 text-[11px] text-slate-500">Flags: {Object.entries(FLAG_LABEL).map(([k, v]) => `${k} = ${v}`).join(" · ")}. Results relate only to the sample tested.</p>

      <footer className="mt-10 flex flex-wrap items-end justify-between gap-6 text-xs">
        <div>
          <p className="text-slate-500">Verified by</p>
          <p className="font-medium">{technicians.join(", ") || "—"}</p>
          <p className="text-slate-500">Lab technologist</p>
        </div>
        {signatories.map((s) => (
          <div key={s.pathologistName} className="text-right">
            <div className="mb-1 h-8" />
            <p className="font-semibold">Dr. {s.pathologistName!.replace(/^Dr\.?\s*/i, "")}</p>
            {s.pathologistQualification && <p>{s.pathologistQualification}</p>}
            {s.pathologistRegNo && <p className="text-slate-500">Reg. no. {s.pathologistRegNo}</p>}
            <p className="text-slate-500">Pathologist</p>
          </div>
        ))}
      </footer>
      <p className="mt-6 text-center text-[11px] uppercase tracking-widest text-slate-400">— End of report —</p>
    </article>
  );
}

function ItemBlock({ item }: { item: LabItem }) {
  return (
    <div className="mt-2 break-inside-avoid">
      <p className="text-[13px] font-semibold">
        {item.testName}
        {item.method && <span className="font-normal text-slate-500"> · {item.method}</span>}
        {item.outsourceLabName && item.sentOutAt && <span className="font-normal text-slate-500"> · performed at {item.outsourceLabName}</span>}
      </p>
      {item.reportType === "Descriptive" ? (
        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">{item.reportText}</p>
      ) : (
        <table className="mt-1 w-full text-[13px]">
          <thead>
            <tr className="border-b border-slate-300 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="w-[38%] py-1 pr-2 font-semibold">Investigation</th>
              <th className="w-[20%] py-1 pr-2 font-semibold">Result</th>
              <th className="w-[14%] py-1 pr-2 font-semibold">Unit</th>
              <th className="py-1 font-semibold">Biological ref. interval</th>
            </tr>
          </thead>
          <tbody>
            {item.results.map((r, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-1 pr-2">{r.name}</td>
                <td className={cx("py-1 pr-2 tabular-nums", r.flag && "font-bold")}>
                  {r.value}
                  {r.flag && <span className={cx("ml-1.5 text-[11px]", r.flag === "LL" || r.flag === "HH" ? "text-red-700" : "text-slate-700")}>{r.flag}</span>}
                </td>
                <td className="py-1 pr-2 text-slate-600">{r.unit ?? ""}</td>
                <td className="py-1 text-slate-600">{rangeLabel(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {item.remarks && <p className="mt-1 text-xs italic text-slate-700">Remarks: {item.remarks}</p>}
    </div>
  );
}

function Meta({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-slate-500">{label}</span>
      <span className={cx("truncate", strong && "font-semibold")}>: {value}</span>
    </div>
  );
}
