"use client";

import { ArrowLeft, Lock, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { RecordModal } from "@/components/ResourceManager";
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Spinner, statusTone, useToast } from "@/components/ui";
import { api } from "@/lib/client";
import { useApiQuery } from "@/lib/useApi";
import { ageFrom, formatDate, formatDateTime, formatMoney, formatValue } from "@/lib/format";
import { MODULE_MAP, getResource, moduleHref, type ModuleKey } from "@/lib/modules";

const resource = MODULE_MAP.patients.resources[0];

type Patient = Record<string, unknown> & {
  id: string;
  code: string;
  fullName: string;
  gender: string;
  dateOfBirth: string;
  mobile: string;
  email: string | null;
  address: string;
  bloodGroup: string | null;
  patientType: string;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  createdAt: string;
  updatedAt: string;
};

interface Related {
  sections: { module: ModuleKey; moduleLabel: string; resource: string; label: string; total: number; items: (Record<string, unknown> & { id: string; code?: string })[] }[];
  restricted: string[];
  pharmacy: { total: number; items: { id: string; code: string; billDate: string; netAmount: number; paidAmount: number; status: string; paymentMode: string; summary: string }[] } | null;
  lab?: { total: number; items: { id: string; code: string; orderDate: string; status: string; paymentStatus: string; netAmount: number; tests: string; reported: number; count: number; critical: boolean; abnormal: boolean }[] } | null;
  insurance?: {
    preauths: { total: number; items: { id: string; code: string; createdAt: string; insurerName: string | null; tpaName: string | null; diagnosis: string; requestedAmount: number; approvedAmount: number; authNo: string | null; status: string }[] };
    claims: { total: number; items: { id: string; code: string; createdAt: string | null; providerName: string | null; billCode: string | null; claimAmount: number; settledAmount: number; outstanding: number; status: string }[] };
  } | null;
  ambulance?: { total: number; items: { id: string; code: string; requestedAt: string; tripType: string; pickupLocation: string; dropLocation: string | null; vehicleNumber: string | null; status: string; total: number | null; paymentStatus: string }[] } | null;
}

export default function PatientDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const patientQuery = useApiQuery<Patient>(`/api/patients/${id}`);
  const relatedQuery = useApiQuery<Related>(`/api/patients/${id}/related`);
  // After an edit, show the saved record without re-fetching (which would log another view).
  const [edited, setEdited] = useState<Patient | null>(null);
  const patient = edited?.id === id ? edited : (patientQuery.data ?? null);
  const error = patientQuery.error ? { status: patientQuery.status ?? 0, message: patientQuery.error } : null;
  const related = relatedQuery.data ?? null;
  const relatedError = relatedQuery.error;
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = () => {
    setEdited(null);
    patientQuery.reload();
    relatedQuery.reload();
  };

  async function doDelete() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api(`/api/patients/${id}`, { method: "DELETE" });
      toast("Patient record deleted");
      router.replace("/patients");
    } catch (e) {
      setDeleteError((e as Error).message);
      setDeleteBusy(false);
    }
  }

  const back = (
    <Link href="/patients" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
      <ArrowLeft className="size-4" /> Back to patients
    </Link>
  );

  if (error) {
    return (
      <>
        {back}
        <Card>
          {error.status === 404 ? <EmptyState title="Patient not found" description="This record may have been removed." /> : <ErrorState message={error.message} onRetry={load} />}
        </Card>
      </>
    );
  }
  if (!patient) return <>{back}<Spinner label="Loading patient…" /></>;

  const age = ageFrom(patient.dateOfBirth);

  return (
    <>
      {back}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-full bg-brand-100 text-lg font-semibold text-brand-800">
            {patient.fullName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{patient.fullName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <span className="font-mono text-xs">{patient.code}</span>
              <span aria-hidden>·</span>
              <Badge tone={statusTone(patient.patientType)}>{patient.patientType}</Badge>
              <span aria-hidden>·</span>
              <span>{age !== null ? `${age} yrs` : "—"}, {patient.gender}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            <Pencil className="size-4" /> Edit
          </Button>
          <Button variant="secondary" className="text-red-600" onClick={() => { setDeleteError(null); setConfirmDelete(true); }}>
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Basic information" />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
            <Info label="Date of birth" value={formatDate(patient.dateOfBirth)} />
            <Info label="Gender" value={patient.gender} />
            <Info label="Mobile number" value={patient.mobile} />
            <Info label="Email address" value={patient.email ?? "—"} />
            <Info label="Blood group" value={patient.bloodGroup ?? "—"} />
            <Info label="Patient type" value={patient.patientType} />
            <Info label="Residential address" value={patient.address} wide />
          </dl>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Registration" />
            <dl className="space-y-4 p-5">
              <Info label="Patient ID" value={patient.code} mono />
              <Info label="Registered on" value={formatDateTime(patient.createdAt)} />
              <Info label="Last updated" value={formatDateTime(patient.updatedAt)} />
            </dl>
          </Card>
          <Card>
            <CardHeader title="Emergency contact" />
            <dl className="space-y-4 p-5">
              <Info label="Name" value={patient.emergencyContactName ?? "—"} />
              <Info label="Phone" value={patient.emergencyContactPhone ?? "—"} />
            </dl>
          </Card>
        </div>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-900">Visits, consultations & records</h2>
      {relatedError ? (
        <Card><ErrorState message={relatedError} onRetry={relatedQuery.reload} /></Card>
      ) : !related ? (
        <Spinner label="Loading linked records…" />
      ) : (
        <div className="space-y-4">
          {related.sections.map((s) => <RelatedSection key={`${s.module}.${s.resource}`} section={s} />)}
          {related.lab && <LabOrdersSection data={related.lab} patientId={patient.id} />}
          {related.pharmacy && <PharmacySection data={related.pharmacy} patientId={patient.id} />}
          {related.insurance && (
            <>
              <LinkedTable
                title="Insurance pre-authorisations"
                description={`Insurance · ${related.insurance.preauths.total} pre-auth${related.insurance.preauths.total === 1 ? "" : "s"}`}
                action={{ href: `/insurance/preauth/new?patient=${patient.id}`, label: "Request pre-auth" }}
                empty="No pre-authorisations for this patient."
                headers={["Pre-auth", "Date", "Insurer / TPA", "Diagnosis", "Requested", "Approved", "Status"]}
                rows={related.insurance.preauths.items.map((p) => ({
                  id: p.id, href: `/insurance/preauth/${p.id}`, code: p.code, status: p.status,
                  cells: [formatDate(p.createdAt), p.tpaName ? `${p.insurerName} / ${p.tpaName}` : (p.insurerName ?? "—"), p.diagnosis, formatMoney(p.requestedAmount), p.approvedAmount ? `${formatMoney(p.approvedAmount)}${p.authNo ? ` · ${p.authNo}` : ""}` : "—"],
                }))}
              />
              <LinkedTable
                title="Insurance claims"
                description={`Insurance · ${related.insurance.claims.total} claim${related.insurance.claims.total === 1 ? "" : "s"}`}
                action={{ href: `/insurance/claims/new?patient=${patient.id}`, label: "New claim" }}
                empty="No claims for this patient."
                headers={["Claim", "Date", "Insurer", "Bill", "Claimed", "Settled", "Outstanding", "Status"]}
                rows={related.insurance.claims.items.map((c) => ({
                  id: c.id, href: `/insurance/claims/${c.id}`, code: c.code, status: c.status,
                  cells: [formatDate(c.createdAt), c.providerName ?? "—", c.billCode ?? "—", formatMoney(c.claimAmount), formatMoney(c.settledAmount), formatMoney(c.outstanding)],
                }))}
              />
            </>
          )}
          {related.ambulance && (
            <LinkedTable
              title="Ambulance trips"
              description={`Ambulance · ${related.ambulance.total} trip${related.ambulance.total === 1 ? "" : "s"}`}
              action={{ href: `/ambulance/trips/new?patient=${patient.id}`, label: "Log ambulance call" }}
              empty="No ambulance trips for this patient."
              headers={["Trip", "Called", "Type", "From → To", "Vehicle", "Charges", "Status"]}
              rows={related.ambulance.items.map((t) => ({
                id: t.id, href: `/ambulance/trips/${t.id}`, code: t.code, status: t.status,
                cells: [formatDateTime(t.requestedAt), t.tripType, `${t.pickupLocation}${t.dropLocation ? ` → ${t.dropLocation}` : ""}`, t.vehicleNumber ?? "—", t.total != null ? `${formatMoney(t.total)} · ${t.paymentStatus}` : "—"],
              }))}
            />
          )}
          {related.restricted.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>Hidden because you are not assigned to these modules: {related.restricted.join(", ")}.</span>
            </div>
          )}
        </div>
      )}

      {editing && (
        <RecordModal
          resource={resource}
          base="/api/patients"
          record={patient}
          onClose={() => setEditing(false)}
          onSaved={(msg, saved) => {
            toast(msg);
            setEdited(saved as Patient);
            setEditing(false);
          }}
        />
      )}
      <ConfirmDialog
        open={confirmDelete}
        danger
        title="Delete patient record?"
        message={<>This permanently removes <strong>{patient.fullName} ({patient.code})</strong>. Patients with linked visits, orders or invoices cannot be deleted.</>}
        confirmLabel="Delete patient"
        loading={deleteBusy}
        error={deleteError}
        onConfirm={doDelete}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}

function Info({ label, value, wide, mono }: { label: string; value: string; wide?: boolean; mono?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-1 text-sm text-slate-900 ${mono ? "font-mono" : ""} whitespace-pre-line`}>{value}</dd>
    </div>
  );
}

function LabOrdersSection({ data, patientId }: { data: NonNullable<Related["lab"]>; patientId: string }) {
  return (
    <Card>
      <CardHeader
        title="Lab orders"
        description={`Laboratory · ${data.total} order${data.total === 1 ? "" : "s"}`}
        actions={<Link href={`/laboratory/new?patient=${patientId}`} className="text-xs font-medium text-brand-700 hover:underline">Book lab tests</Link>}
      />
      {data.items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-500">No lab orders for this patient.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead>
              <tr>
                {["Lab no.", "Date", "Tests", "Reported", "Status", "Amount", ""].map((h, i) => (
                  <th key={i} className="whitespace-nowrap px-5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((o) => (
                <tr key={o.id}>
                  <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs"><Link href={`/laboratory/orders/${o.id}`} className="text-brand-700 hover:underline">{o.code}</Link></td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-slate-700">{formatDate(o.orderDate)}</td>
                  <td className="max-w-xs truncate px-5 py-2.5 text-slate-700">{o.tests}{o.critical ? <span className="ml-2 text-xs font-semibold text-red-600">Critical</span> : o.abnormal ? <span className="ml-2 text-xs font-semibold text-amber-700">Abnormal</span> : null}</td>
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-slate-700">{o.reported}/{o.count}</td>
                  <td className="whitespace-nowrap px-5 py-2.5"><Badge tone={statusTone(o.status)}>{o.status}</Badge></td>
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-slate-700">{formatMoney(o.netAmount)}</td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-xs">{o.reported > 0 && <Link href={`/laboratory/orders/${o.id}/report`} className="text-brand-700 hover:underline">Report</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function PharmacySection({ data, patientId }: { data: NonNullable<Related["pharmacy"]>; patientId: string }) {
  return (
    <Card>
      <CardHeader
        title="Pharmacy bills"
        description={`Pharmacy · ${data.total} bill${data.total === 1 ? "" : "s"}`}
        actions={<Link href={`/pharmacy/new?patient=${patientId}`} className="text-xs font-medium text-brand-700 hover:underline">New bill for this patient</Link>}
      />
      {data.items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-500">No pharmacy bills for this patient.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead>
              <tr>
                {["Bill #", "Date", "Items", "Amount", "Paid", "Status"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((b) => (
                <tr key={b.id}>
                  <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs"><Link href={`/pharmacy/sales/${b.id}`} className="text-brand-700 hover:underline">{b.code}</Link></td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-slate-700">{formatDate(b.billDate)}</td>
                  <td className="max-w-xs truncate px-5 py-2.5 text-slate-700">{b.summary}</td>
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-slate-700">{formatMoney(b.netAmount)}</td>
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-slate-700">{formatMoney(b.paidAmount)}</td>
                  <td className="whitespace-nowrap px-5 py-2.5"><Badge tone={statusTone(b.status)}>{b.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Linked workflow records (pre-auths, claims, trips): code links to the record, last column is the status. */
function LinkedTable({ title, description, action, empty, headers, rows }: { title: string; description: string; action: { href: string; label: string }; empty: string; headers: string[]; rows: { id: string; href: string; code: string; status: string; cells: string[] }[] }) {
  return (
    <Card>
      <CardHeader title={title} description={description} actions={<Link href={action.href} className="text-xs font-medium text-brand-700 hover:underline">{action.label}</Link>} />
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead>
              <tr>{headers.map((h) => <th key={h} className="whitespace-nowrap px-5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs"><Link href={r.href} className="text-brand-700 hover:underline">{r.code}</Link></td>
                  {r.cells.map((c, i) => <td key={i} className="max-w-xs truncate whitespace-nowrap px-5 py-2.5 text-slate-700" title={c}>{c}</td>)}
                  <td className="whitespace-nowrap px-5 py-2.5"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function RelatedSection({ section }: { section: Related["sections"][number] }) {
  const def = getResource(section.module, section.resource)!;
  const cols = def.fields.filter((f) => f.list && f.ref !== "patients.patients");
  return (
    <Card>
      <CardHeader
        title={`${section.label}`}
        description={`${section.moduleLabel} · ${section.total} record${section.total === 1 ? "" : "s"}${section.total > section.items.length ? ` (latest ${section.items.length} shown)` : ""}`}
        actions={<Link href={`${moduleHref(section.module)}?tab=${section.resource}`} className="text-xs font-medium text-brand-700 hover:underline">Open {section.moduleLabel}</Link>}
      />
      {section.items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-500">No {section.label.toLowerCase()} for this patient.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead>
              <tr>
                {def.codePrefix && <th className="px-5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Ref #</th>}
                {cols.map((c) => <th key={c.name} className="whitespace-nowrap px-5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{c.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {section.items.map((it) => (
                <tr key={it.id}>
                  {def.codePrefix && <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs text-slate-600">{it.code}</td>}
                  {cols.map((c) => {
                    const text = formatValue(c, it[c.name]);
                    return (
                      <td key={c.name} className="whitespace-nowrap px-5 py-2.5 text-slate-700">
                        {c.name === def.statusField && text !== "—" ? <Badge tone={statusTone(text)}>{text}</Badge> : text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
