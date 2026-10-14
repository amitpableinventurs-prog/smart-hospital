"use client";

import { ArrowLeft, FlaskConical, Layers, LoaderCircle, Search, Trash2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiClientError, api, qs } from "@/lib/client";
import { formatDate, formatMoney } from "@/lib/format";
import { PAYMENT_MODES, RATE_PLANS, getResource } from "@/lib/modules";
import { RefSelect, type RefOption } from "../RecordForm";
import { Alert, Button, Card, CardHeader, Field, Kbd, cx, inputClass, useDebounced, useHotkeys, useToast } from "../ui";

interface CatalogTest { id: string; name: string; code: string; category: string; sampleType: string; container: string; rate: number; outsourced: boolean; turnaroundHours: number | null; preparation: string | null }
interface CatalogProfile { id: string; name: string; code: string; rate: number; tests: { id: string; name: string; code: string }[] }
interface Context {
  patient: { id: string; name: string; code: string; gender: string; age: number | null; mobile: string };
  visits: { id: string; code: string; date: string; department: string; status: string; doctor: RefOption | null }[];
  admissions: { id: string; code: string; date: string; ward: string; bed: string; doctor: RefOption | null }[];
}
type Line = { kind: "test"; test: CatalogTest } | { kind: "profile"; profile: CatalogProfile };

const patientField = getResource("patients", "patients")!.fields.find((f) => f.name === "fullName")!;
const doctorRef = { name: "doctor", label: "Referring doctor", type: "ref" as const, ref: "doctors.doctors" };
const r2 = (n: number) => Math.round(n * 100) / 100;

export function BookingForm({ initialPatient }: { initialPatient?: RefOption }) {
  const router = useRouter();
  const toast = useToast();
  const [patient, setPatient] = useState(initialPatient?.id ?? "");
  const [ctx, setCtx] = useState<Context | null>(null);
  const [source, setSource] = useState<"OPD" | "IPD" | "Walk-in">("Walk-in");
  const [visit, setVisit] = useState("");
  const [admission, setAdmission] = useState("");
  const [doctor, setDoctor] = useState<RefOption | null>(null);
  const [doctorKey, setDoctorKey] = useState(0);
  const [priority, setPriority] = useState("Routine");
  const [ratePlan, setRatePlan] = useState("General");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState("");
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [paid, setPaid] = useState("");
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Patient context: recent OPD visits and current admission decide the request type.
  useEffect(() => {
    if (!patient) return;
    let live = true;
    api<Context>(`/api/laboratory/patient-context${qs({ patient })}`)
      .then(({ data }) => {
        if (!live) return;
        setCtx(data);
        if (data.admissions.length) pickSource("IPD", data);
        else if (data.visits.length) pickSource("OPD", data);
        else pickSource("Walk-in", data);
      })
      .catch((e) => live && setFormError((e as Error).message));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per selected patient
  }, [patient]);

  function setDoctorFrom(d: RefOption | null | undefined) {
    if (!d) return;
    setDoctor(d);
    setDoctorKey((k) => k + 1);
  }
  function pickSource(s: "OPD" | "IPD" | "Walk-in", c = ctx) {
    setSource(s);
    const v = s === "OPD" ? c?.visits[0] : undefined;
    const a = s === "IPD" ? c?.admissions[0] : undefined;
    setVisit(v?.id ?? "");
    setAdmission(a?.id ?? "");
    setDoctorFrom(v?.doctor ?? a?.doctor);
  }

  // Changing the rate plan re-prices the individual tests already added.
  useEffect(() => {
    const ids = lines.filter((l) => l.kind === "test").map((l) => (l as { test: CatalogTest }).test.id);
    if (!ids.length) return;
    api<{ tests: CatalogTest[] }>(`/api/laboratory/catalog${qs({ plan: ratePlan, ids: ids.join(",") })}`).then(({ data }) => {
      const rate = new Map(data.tests.map((t) => [t.id, t.rate]));
      setLines((ls) => ls.map((l) => (l.kind === "test" && rate.has(l.test.id) ? { ...l, test: { ...l.test, rate: rate.get(l.test.id)! } } : l)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the plan changes
  }, [ratePlan]);

  const testIdsInUse = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lines) {
      if (l.kind === "test") m.set(l.test.id, "added");
      else for (const t of l.profile.tests) m.set(t.id, l.profile.name);
    }
    return m;
  }, [lines]);

  function add(line: Line) {
    const ids = line.kind === "test" ? [line.test.id] : line.profile.tests.map((t) => t.id);
    const clash = ids.find((id) => testIdsInUse.has(id));
    if (clash) {
      const name = line.kind === "test" ? line.test.name : line.profile.tests.find((t) => t.id === clash)?.name;
      const where = testIdsInUse.get(clash);
      toast(`${name} is already ${where === "added" ? "added" : `in ${where}`}`, "error");
      return;
    }
    setLines((ls) => [...ls, line]);
    setErrors((e) => ({ ...e, tests: "" }));
  }

  const gross = r2(lines.reduce((s, l) => s + (l.kind === "test" ? l.test.rate : l.profile.rate), 0));
  const disc = Math.min(gross, Math.max(0, Number(discount) || 0));
  const net = r2(gross - disc);
  const paidValue = paymentMode === "Credit" ? 0 : paid === "" ? net : Math.max(0, Number(paid) || 0);

  async function save() {
    if (saving) return;
    const errs: Record<string, string> = {};
    if (!patient) errs.patient = "Select the patient";
    if (source === "IPD" && !admission) errs.admission = "The patient has no current admission";
    if (lines.length === 0) errs.tests = "Add at least one test or profile";
    if (Number(discount) > gross) errs.discount = "Discount cannot exceed the total";
    if (paidValue > net) errs.paidAmount = `Cannot exceed ${formatMoney(net)}`;
    setErrors(errs);
    if (Object.keys(errs).length) return setFormError("Please correct the highlighted fields.");
    setSaving(true);
    setFormError(null);
    try {
      const { data } = await api<{ id: string; code: string }>("/api/laboratory/orders", {
        method: "POST",
        body: {
          patient, source, visit: source === "OPD" ? visit || undefined : undefined, admission: source === "IPD" ? admission : undefined,
          doctor: doctor?.id, priority, ratePlan, clinicalNotes: notes, discount: disc,
          tests: lines.filter((l) => l.kind === "test").map((l) => (l as { test: CatalogTest }).test.id),
          profiles: lines.filter((l) => l.kind === "profile").map((l) => (l as { profile: CatalogProfile }).profile.id),
          paidAmount: paidValue, paymentMode: paidValue > 0 ? paymentMode : undefined, paymentReference: reference,
        },
      });
      toast(`Lab order ${data.code} registered`);
      router.push(`/laboratory/orders/${data.id}`);
    } catch (e) {
      if (e instanceof ApiClientError && e.fields) setErrors(e.fields);
      setFormError((e as Error).message);
      setSaving(false);
    }
  }
  useHotkeys({ "ctrl+s": () => save(), F10: () => save() });

  return (
    <>
      <Link href="/m/laboratory?tab=orders" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Back to lab orders
      </Link>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">New lab booking</h1>
          <p className="mt-1 text-sm text-slate-500">Registers the patient in the lab, generates the lab number and sample barcodes, and bills the tests.</p>
        </div>
        <Button onClick={save} loading={saving}><FlaskConical className="size-4" /> Register & bill <Kbd>Ctrl+S</Kbd></Button>
      </div>
      {formError && <div className="mb-4"><Alert>{formError}</Alert></div>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Patient & request" actions={<Link href="/patients/new" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><UserPlus className="size-3.5" /> Register new patient</Link>} />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Patient" htmlFor="lab-patient" required error={errors.patient} className="sm:col-span-2">
                <RefSelect id="lab-patient" field={{ ...patientField, name: "patient", label: "Patient", type: "ref", ref: "patients.patients", required: true }} value={patient} initial={initialPatient}
                  className={inputClass} onChange={(v) => { setPatient(v); setCtx(null); }} />
              </Field>
              {ctx && (
                <p className="-mt-2 text-xs text-slate-500 sm:col-span-2">
                  {ctx.patient.code} · {[ctx.patient.age != null ? `${ctx.patient.age} yrs` : null, ctx.patient.gender, ctx.patient.mobile].filter(Boolean).join(" · ")}
                  {ctx.admissions.length > 0 && <span className="ml-2 font-medium text-violet-700">Currently admitted</span>}
                </p>
              )}
              <Field label="Request type" htmlFor="lab-source" required className="sm:col-span-2">
                <div id="lab-source" className="flex gap-1 rounded-lg bg-slate-100 p-1" role="radiogroup">
                  {(["OPD", "IPD", "Walk-in"] as const).map((s) => (
                    <button key={s} type="button" role="radio" aria-checked={source === s} onClick={() => pickSource(s)} className={cx("flex-1 rounded-md px-3 py-1.5 text-sm font-medium", source === s ? "bg-white text-brand-700 shadow-sm" : "text-slate-600")}>
                      {s === "OPD" ? "OPD request" : s === "IPD" ? "IPD request" : "Walk-in"}
                    </button>
                  ))}
                </div>
              </Field>
              {source === "OPD" && (
                <Field label="OPD visit" htmlFor="lab-visit" error={errors.visit} hint={ctx && ctx.visits.length === 0 ? "No OPD visits in the last 30 days" : undefined}>
                  <select id="lab-visit" value={visit} onChange={(e) => { setVisit(e.target.value); setDoctorFrom(ctx?.visits.find((v) => v.id === e.target.value)?.doctor); }} className={inputClass}>
                    <option value="">— Not linked —</option>
                    {ctx?.visits.map((v) => <option key={v.id} value={v.id}>{v.code} · {formatDate(v.date)} · {v.department}</option>)}
                  </select>
                </Field>
              )}
              {source === "IPD" && (
                <Field label="Admission" htmlFor="lab-adm" required error={errors.admission} hint={ctx && ctx.admissions.length === 0 ? "Patient is not admitted" : undefined}>
                  <select id="lab-adm" value={admission} onChange={(e) => { setAdmission(e.target.value); setDoctorFrom(ctx?.admissions.find((a) => a.id === e.target.value)?.doctor); }} className={inputClass}>
                    <option value="">Select…</option>
                    {ctx?.admissions.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.ward} / bed {a.bed}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Referring doctor" htmlFor="lab-doctor" error={errors.doctor}>
                <RefSelect key={doctorKey} id="lab-doctor" field={doctorRef} value={doctor?.id ?? ""} initial={doctor ?? undefined} className={inputClass} onChange={() => {}} onPick={(o) => setDoctor(o)} />
              </Field>
              <Field label="Priority" htmlFor="lab-priority">
                <select id="lab-priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
                  {["Routine", "Urgent", "STAT"].map((p) => <option key={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Rate plan" htmlFor="lab-plan">
                <select id="lab-plan" value={ratePlan} onChange={(e) => setRatePlan(e.target.value)} className={inputClass}>
                  {RATE_PLANS.map((p) => <option key={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Clinical notes" htmlFor="lab-notes" className="sm:col-span-2">
                <textarea id="lab-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Provisional diagnosis, medication, fasting status…" className={inputClass} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Tests & profiles" description="Search by test name or code. Profiles add all their tests at the package rate." />
            <div className="p-5">
              <CatalogSearch plan={ratePlan} onAdd={add} inUse={testIdsInUse} />
              {errors.tests && <p className="mt-2 text-xs text-red-600">{errors.tests}</p>}
            </div>
            {lines.length > 0 && (
              <div className="overflow-x-auto border-t border-slate-100">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50/60">
                    <tr>{["Test / profile", "Sample", "Rate", ""].map((h, i) => <th key={i} className={cx("px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500", i === 2 ? "text-right" : "text-left")}>{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((l, i) => (
                      <tr key={i}>
                        <td className="px-5 py-2.5">
                          {l.kind === "test" ? (
                            <>
                              <span className="font-medium text-slate-900">{l.test.name}</span> <span className="font-mono text-xs text-slate-500">{l.test.code}</span>
                              {l.test.outsourced && <span className="ml-2 text-xs text-amber-700">Outsourced</span>}
                              {l.test.preparation && <div className="text-xs text-amber-700">Prep: {l.test.preparation}</div>}
                            </>
                          ) : (
                            <>
                              <span className="inline-flex items-center gap-1 font-medium text-slate-900"><Layers className="size-3.5 text-brand-600" /> {l.profile.name}</span>
                              <div className="text-xs text-slate-500">{l.profile.tests.map((t) => t.code || t.name).join(", ")}</div>
                            </>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-5 py-2.5 text-xs text-slate-600">{l.kind === "test" ? `${l.test.sampleType} · ${l.test.container}` : `${l.profile.tests.length} tests`}</td>
                        <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums">{formatMoney(l.kind === "test" ? l.test.rate : l.profile.rate)}</td>
                        <td className="px-3 py-2.5 text-right">
                          <button onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove"><Trash2 className="size-4" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <Card className="h-fit lg:sticky lg:top-20">
          <CardHeader title="Lab bill" />
          <div className="space-y-4 p-5">
            <dl className="space-y-1.5 text-sm tabular-nums">
              <div className="flex justify-between"><dt className="text-slate-600">Tests</dt><dd>{lines.reduce((s, l) => s + (l.kind === "test" ? 1 : l.profile.tests.length), 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Gross</dt><dd>{formatMoney(gross)}</dd></div>
            </dl>
            <Field label="Discount (₹)" htmlFor="lab-disc" error={errors.discount}>
              <input id="lab-disc" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" className={inputClass} />
            </Field>
            <div className="flex justify-between border-t-2 border-slate-800 pt-2 text-base font-bold tabular-nums text-slate-900"><span>Net payable</span><span>{formatMoney(net)}</span></div>
            <Field label="Payment mode" htmlFor="lab-mode">
              <select id="lab-mode" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className={inputClass}>
                {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m === "Credit" ? "Credit (collect later)" : m}</option>)}
              </select>
            </Field>
            {paymentMode !== "Credit" && (
              <>
                <Field label="Amount received" htmlFor="lab-paid" error={errors.paidAmount} hint="Defaults to the full amount">
                  <input id="lab-paid" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={String(net)} className={inputClass} />
                </Field>
                {paymentMode !== "Cash" && (
                  <Field label="Transaction reference" htmlFor="lab-ref">
                    <input id="lab-ref" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} className={inputClass} />
                  </Field>
                )}
              </>
            )}
            <div className="flex justify-between text-sm font-semibold text-amber-700 tabular-nums"><span>Balance due</span><span>{formatMoney(Math.max(0, net - paidValue))}</span></div>
            <Button className="w-full" onClick={save} loading={saving}>Register & bill <Kbd>Ctrl+S</Kbd></Button>
          </div>
        </Card>
      </div>
    </>
  );
}

function CatalogSearch({ plan, onAdd, inUse }: { plan: string; onAdd: (l: Line) => void; inUse: Map<string, string> }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q, 250);
  const [result, setResult] = useState<{ key: string; tests: CatalogTest[]; profiles: CatalogProfile[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const key = `${debounced}|${plan}`;

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    api<{ tests: CatalogTest[]; profiles: CatalogProfile[] }>(`/api/laboratory/catalog${qs({ q: debounced, plan })}`, { signal: ctrl.signal })
      .then(({ data }) => { setResult({ key, ...data }); setFailed(null); })
      .catch((e) => (e as Error).name !== "AbortError" && setFailed((e as Error).message));
    return () => ctrl.abort();
  }, [open, debounced, plan, key]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const loading = open && result?.key !== key && !failed;
  return (
    <div ref={wrap} className="relative">
      <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" aria-hidden />
      <input value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} placeholder="Search tests or profiles, e.g. CBC, lipid, thyroid…" className={cx(inputClass, "pl-9")} aria-label="Search tests" />
      {loading && <LoaderCircle className="absolute right-3 top-2.5 size-4 animate-spin text-slate-400" />}
      {open && (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200">
          {failed && <p className="px-3 py-2 text-red-600">{failed}</p>}
          {result && result.tests.length === 0 && result.profiles.length === 0 && <p className="px-3 py-2 text-slate-500">No active tests match. Add tests under Setup → Test Master.</p>}
          {result?.profiles.map((p) => (
            <button key={p.id} type="button" onClick={() => { onAdd({ kind: "profile", profile: p }); setQ(""); setOpen(false); }} className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-brand-50">
              <span>
                <span className="inline-flex items-center gap-1 font-medium text-slate-900"><Layers className="size-3.5 text-brand-600" /> {p.name}</span>
                <span className="block text-xs text-slate-500">Profile · {p.tests.map((t) => t.code || t.name).join(", ")}</span>
              </span>
              <span className="shrink-0 tabular-nums text-slate-700">{formatMoney(p.rate)}</span>
            </button>
          ))}
          {result?.tests.map((t) => (
            <button key={t.id} type="button" disabled={inUse.has(t.id)} onClick={() => { onAdd({ kind: "test", test: t }); setQ(""); setOpen(false); }} className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-brand-50 disabled:opacity-50">
              <span>
                <span className="font-medium text-slate-900">{t.name}</span> <span className="font-mono text-xs text-slate-500">{t.code}</span>
                <span className="block text-xs text-slate-500">{[t.category, t.sampleType, t.container, t.turnaroundHours ? `TAT ${t.turnaroundHours} h` : null, inUse.has(t.id) ? "already added" : null].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="shrink-0 tabular-nums text-slate-700">{formatMoney(t.rate)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
