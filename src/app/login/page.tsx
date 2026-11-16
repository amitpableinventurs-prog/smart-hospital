import { FlaskConical, ReceiptIndianRupee, ShieldCheck, Sparkles, Stethoscope } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark, BrandTheme } from "@/components/BrandTheme";
import { licenceView } from "@/lib/licence";
import { LoginForm } from "./LoginForm";

// Every request re-checks the session against the database (deactivation and
// module changes apply immediately), so these routes intentionally block.
export const instant = false;

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const licence = await licenceView();
  if (licence.locked?.reason === "not_activated") redirect("/setup");
  // Only allow same-site relative redirects.
  const safeNext = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : undefined;

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[1.1fr_1fr]">
      <BrandTheme color={licence.brand.color} />
      <div className="relative hidden flex-col justify-between overflow-hidden bg-brand-950 bg-linear-to-br from-brand-600 via-brand-900 to-slate-950 p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -left-24 -top-24 size-96 rounded-full bg-brand-400/30 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 right-0 size-96 rounded-full bg-indigo-500/25 blur-3xl" aria-hidden />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
          aria-hidden
        />

        <div className="relative flex items-center gap-3">
          <BrandMark brand={licence.brand} className="size-6" boxClassName="rounded-xl bg-white/10 p-2 ring-1 ring-inset ring-white/20 backdrop-blur" />
          <span className="text-lg font-semibold tracking-tight">{licence.brand.appName}</span>
        </div>

        <div className="relative">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-brand-100 ring-1 ring-inset ring-white/15">
            <Sparkles className="size-3.5" aria-hidden /> Smart Hospital ERP
          </p>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.15] tracking-tight">
            Smart hospital automation,
            <br />
            <span className="bg-linear-to-r from-brand-200 to-white bg-clip-text text-transparent">one panel per department.</span>
          </h1>
          <p className="mt-4 max-w-md text-brand-100/90">
            Patients, OPD/IPD, doctors, nursing, laboratory, inventory, billing, HR, insurance and ambulance — each managed by its assigned admins, with full oversight for the super admin.
          </p>
          <ul className="mt-8 grid max-w-md grid-cols-2 gap-3 text-sm">
            {[
              { icon: <Stethoscope className="size-4" />, text: "OPD, IPD & clinic" },
              { icon: <FlaskConical className="size-4" />, text: "Lab & pharmacy" },
              { icon: <ReceiptIndianRupee className="size-4" />, text: "Billing & insurance" },
              { icon: <ShieldCheck className="size-4" />, text: "Role-based access" },
            ].map((f) => (
              <li key={f.text} className="flex items-center gap-2.5 rounded-xl bg-white/[0.07] px-3 py-2.5 ring-1 ring-inset ring-white/10 backdrop-blur">
                <span className="grid size-7 place-items-center rounded-lg bg-white/10 text-brand-100">{f.icon}</span>
                {f.text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-brand-200/80">Access is restricted to authorised hospital staff. All activity is recorded.</p>
      </div>

      <div className="relative flex items-center justify-center overflow-hidden p-6">
        <div className="pointer-events-none absolute -right-32 -top-32 size-96 rounded-full bg-brand-100/60 blur-3xl" aria-hidden />
        <div className="relative w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <BrandMark brand={licence.brand} />
            <span className="text-lg font-semibold tracking-tight text-slate-900">{licence.brand.appName}</span>
          </div>
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900">Welcome back</h2>
          <p className="mt-1.5 text-sm text-slate-500">{licence.mode === "client" && licence.hospitalName ? `${licence.hospitalName} · ` : ""}Sign in with the account provided by your super admin.</p>
          <LoginForm next={safeNext} />
        </div>
      </div>
    </div>
  );
}
