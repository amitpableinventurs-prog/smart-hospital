import type { Metadata } from "next";
import { Check, Download, Gift, Hospital, Mail, Phone, WifiOff } from "lucide-react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { durationLabel, priceOf } from "@/lib/control-shared";
import { connectDB } from "@/lib/db";
import { appMode } from "@/lib/deployment";
import { formatMoney } from "@/lib/format";
import { MODULE_MAP } from "@/lib/modules";
import { publicPlans } from "@/lib/subscriptions";
import { EnquiryForm } from "./EnquiryForm";

// Plans change on the Control Panel; always read them fresh.
export const instant = false;

export const metadata: Metadata = { title: "Plans & Pricing" };

/** Public page of the Control Panel server: plans on sale, the free trial, and a "request a demo" form that becomes a lead. */
export default async function PricingPage() {
  await connection();
  if (appMode() !== "control") notFound();
  await connectDB();
  const { plans, trial, vendor } = await publicPlans();
  const download = process.env.SETUP_DOWNLOAD_URL?.trim() || null;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-brand-900 text-white">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-white/10 p-2"><Hospital className="size-6" aria-hidden /></div>
            <span className="text-lg font-semibold">{vendor.name}</span>
          </div>
          <h1 className="mt-8 text-3xl font-semibold leading-tight sm:text-4xl">Hospital software that keeps working offline.</h1>
          <p className="mt-3 max-w-2xl text-brand-100">Install it on your hospital&apos;s own Windows PC. Patients, OPD/IPD, billing, pharmacy, laboratory, HR and more — on your network, with a secure copy on our servers.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {download && <a href={download} className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-brand-900 hover:bg-brand-50"><Download className="size-4" /> Download the Windows setup</a>}
            <a href="#demo" className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/40 hover:bg-white/10">Request a demo</a>
          </div>
          <p className="mt-4 flex items-center gap-2 text-sm text-brand-200"><WifiOff className="size-4" /> Works without internet; checks in when you are online.</p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {trial && (
          <div className="mb-8 flex flex-col gap-3 rounded-xl bg-violet-50 p-5 text-violet-900 ring-1 ring-violet-200 sm:flex-row sm:items-center">
            <Gift className="size-6 shrink-0" />
            <p className="flex-1 text-sm"><strong>Free trial for {durationLabel(trial.durationDays)}</strong> — install the setup and choose “Start a free trial”. No payment or licence key needed{trial.modules.length ? `; includes ${trial.modules.length} modules` : ""}.</p>
          </div>
        )}
        {plans.length === 0 ? (
          <p className="text-center text-slate-500">Plans are being prepared. Request a demo below and we will call you.</p>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {plans.map((p) => (
              <section key={p.id} className="flex flex-col rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <h2 className="text-lg font-semibold text-slate-900">{p.name}</h2>
                {p.description && <p className="mt-1 text-sm text-slate-600">{p.description}</p>}
                <p className="mt-4 text-3xl font-semibold tabular-nums text-slate-900">{formatMoney(p.price)}<span className="text-sm font-normal text-slate-500"> / {durationLabel(p.durationDays)}</span></p>
                <p className="text-xs text-slate-500">+ {p.gstPct}% GST ({formatMoney(priceOf(p.price, p.gstPct).total)} total)</p>
                <ul className="mt-5 space-y-1.5 text-sm text-slate-700">
                  {p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{f}</li>)}
                  <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{p.maxUsers ? `Up to ${p.maxUsers} staff logins` : "Unlimited staff logins"}</li>
                </ul>
                <div className="mt-5 flex flex-wrap gap-1">{p.modules.map((m) => <span key={m} className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{MODULE_MAP[m]?.label ?? m}</span>)}</div>
                <a href={`#demo`} className="mt-6 inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Get {p.name}</a>
              </section>
            ))}
          </div>
        )}

        <section id="demo" className="mt-14 grid gap-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 lg:grid-cols-[1fr_1.4fr] lg:p-8">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Request a demo</h2>
            <p className="mt-2 text-sm text-slate-600">Tell us about your hospital and we will call you to show the software and help you choose a plan.</p>
            <div className="mt-4 space-y-1.5 text-sm text-slate-700">
              {vendor.phone && <a href={`tel:${vendor.phone}`} className="flex items-center gap-2 hover:underline"><Phone className="size-4" />{vendor.phone}</a>}
              {vendor.email && <a href={`mailto:${vendor.email}`} className="flex items-center gap-2 hover:underline"><Mail className="size-4" />{vendor.email}</a>}
            </div>
          </div>
          <EnquiryForm plans={plans.map((p) => ({ code: p.code, name: p.name }))} />
        </section>
      </main>
      <footer className="py-8 text-center text-xs text-slate-400">© {new Date().getFullYear()} {vendor.name}</footer>
    </div>
  );
}
