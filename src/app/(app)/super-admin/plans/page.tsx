"use client";

import { Check, Gift, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { PlanForm } from "@/components/control/PlanForm";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, Spinner, cx, useToast } from "@/components/ui";
import { api } from "@/lib/client";
import { durationLabel, priceOf, type PlanRow } from "@/lib/control-shared";
import { formatMoney } from "@/lib/format";
import { MODULE_MAP } from "@/lib/modules";
import { useApiQuery } from "@/lib/useApi";

/** Control Panel: what hospitals can subscribe to. */
export default function PlansPage() {
  const toast = useToast();
  const q = useApiQuery<PlanRow[]>("/api/control/plans");
  const plans = q.data ?? q.stale ?? [];
  const [editing, setEditing] = useState<PlanRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<PlanRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/control/plans/${deleting.id}`, { method: "DELETE" });
      toast("Plan deleted");
      setDeleting(null);
      q.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Plans & Pricing"
        description="Each plan decides a hospital's modules, staff logins and how long the licence runs. Paying for a plan extends the licence automatically."
        actions={<Button onClick={() => setEditing("new")}><Plus className="size-4" /> New plan</Button>}
      />
      {q.error && !q.stale ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : q.loading && !q.stale ? (
        <Spinner label="Loading plans…" />
      ) : plans.length === 0 ? (
        <Card><EmptyState title="No plans yet" description="Create a free-trial plan and one or more paid plans (e.g. Basic, Standard, Premium)." action={<Button onClick={() => setEditing("new")}><Plus className="size-4" /> New plan</Button>} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((p) => {
            const price = priceOf(p.price, p.gstPct);
            return (
              <Card key={p.id} className={cx("flex flex-col p-5", !p.active && "opacity-70")}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{p.name}</h2>
                    <p className="font-mono text-xs text-slate-500">{p.code}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    {p.trial && <Badge tone="violet"><Gift className="size-3" /> Free trial</Badge>}
                    {!p.active ? <Badge tone="red">Not on sale</Badge> : !p.public ? <Badge tone="slate">Hidden</Badge> : null}
                  </div>
                </div>
                <p className="mt-3 text-2xl font-semibold tabular-nums text-slate-900">
                  {p.price === 0 ? "Free" : formatMoney(p.price)}
                  <span className="text-sm font-normal text-slate-500"> / {durationLabel(p.durationDays)}</span>
                </p>
                {p.price > 0 && <p className="text-xs text-slate-500">+ {p.gstPct}% GST = {formatMoney(price.total)}</p>}
                {p.description && <p className="mt-3 text-sm text-slate-600">{p.description}</p>}
                {p.features.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm text-slate-700">
                    {p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{f}</li>)}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap gap-1">{p.modules.map((m) => <Badge key={m} tone="blue">{MODULE_MAP[m]?.label ?? m}</Badge>)}</div>
                <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-xs">
                  <div><dt className="text-slate-500">Staff logins</dt><dd className="font-medium text-slate-900">{p.maxUsers || "Unlimited"}</dd></div>
                  <div><dt className="text-slate-500">Offline grace</dt><dd className="font-medium text-slate-900">{p.graceDays} days</dd></div>
                  <div><dt className="text-slate-500">Clients</dt><dd className="flex items-center gap-1 font-medium text-slate-900"><Users className="size-3.5" />{p.clients}</dd></div>
                </dl>
                <div className="mt-4 flex gap-2">
                  <Button variant="secondary" onClick={() => setEditing(p)}><Pencil className="size-4" /> Edit</Button>
                  {p.clients === 0 && <Button variant="ghost" onClick={() => { setError(null); setDeleting(p); }} aria-label={`Delete ${p.name}`}><Trash2 className="size-4" /></Button>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {editing && (
        <PlanForm
          plan={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSubmit={async (body) => {
            if (editing === "new") await api("/api/control/plans", { method: "POST", body });
            else await api(`/api/control/plans/${editing.id}`, { method: "PATCH", body });
            toast(editing === "new" ? "Plan created" : "Plan saved");
            setEditing(null);
            q.reload();
          }}
        />
      )}
      <ConfirmDialog open={!!deleting} title={`Delete plan ${deleting?.name}?`} message="Only plans that no client or payment uses can be deleted." confirmLabel="Delete" danger loading={busy} error={error} onConfirm={remove} onClose={() => setDeleting(null)} />
    </>
  );
}
