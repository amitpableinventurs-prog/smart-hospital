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
    <div className="grid min-h-screen lg:grid-cols-2">
      <BrandTheme color={licence.brand.color} />
      <div className="relative hidden flex-col justify-between bg-brand-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <BrandMark brand={licence.brand} className="size-6" boxClassName="rounded-lg bg-white/10 p-2" />
          <span className="text-lg font-semibold">{licence.brand.appName}</span>
        </div>
        <div>
          <h1 className="text-3xl font-semibold leading-tight">Smart hospital automation,<br />one panel per department.</h1>
          <p className="mt-4 max-w-md text-brand-100">
            Patients, OPD/IPD, doctors, nursing, laboratory, inventory, billing, HR, insurance and ambulance — each managed by its assigned admins, with full oversight for the super admin.
          </p>
        </div>
        <p className="text-xs text-brand-200">Access is restricted to authorised hospital staff. All activity is recorded.</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <BrandMark brand={licence.brand} />
            <span className="text-lg font-semibold text-slate-900">{licence.brand.appName}</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">{licence.mode === "client" && licence.hospitalName ? `${licence.hospitalName} · ` : ""}Use the account provided by your super admin.</p>
          <LoginForm next={safeNext} />
        </div>
      </div>
    </div>
  );
}
