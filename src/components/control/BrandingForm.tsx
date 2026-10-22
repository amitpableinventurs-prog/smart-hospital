"use client";

import { Hospital, ImagePlus, X } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, Button, Field, Modal, errorRing, inputClass, omitKey } from "../ui";
import { ApiClientError } from "@/lib/client";
import type { Branding } from "@/lib/licence-protocol";

const EMPTY: Branding = { appName: null, tagline: null, address: null, phone: null, email: null, website: null, gstin: null, color: null, logo: null, printFooter: null };
const MAX_LOGO = 150_000;

/** Downscale a logo to at most 256 px; PNG keeps transparency, JPEG when PNG would be too large. */
async function resizeLogo(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const png = canvas.toDataURL("image/png");
  if (png.length <= MAX_LOGO) return png;
  const ctx = canvas.getContext("2d")!;
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** The client's app name, logo, colour and letterhead — sent to their installation at its next check-in. */
export function BrandingForm({ name, branding, onSubmit, onClose }: { name: string; branding: Branding | null; onSubmit: (b: Branding | null) => Promise<void>; onClose: () => void }) {
  const [v, setV] = useState<Branding>({ ...EMPTY, ...branding });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof Branding) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setV((s) => ({ ...s, [k]: e.target.value || null }));
    if (errors[`branding.${k}`]) setErrors((x) => omitKey(x, `branding.${k}`));
  };

  async function pick(file?: File) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setErrors((x) => ({ ...x, "branding.logo": "Choose a PNG, JPEG or WebP image" }));
    try {
      const logo = await resizeLogo(file);
      if (logo.length > MAX_LOGO) return setErrors((x) => ({ ...x, "branding.logo": "This image is too large even after resizing" }));
      setV((s) => ({ ...s, logo }));
      setErrors((x) => omitKey(x, "branding.logo"));
    } catch {
      setErrors((x) => ({ ...x, "branding.logo": "This image could not be read" }));
    }
  }

  async function submit(clear = false) {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(clear ? null : v);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiClientError && e.fields) setErrors(e.fields);
      setBusy(false);
    }
  }

  const input = (k: keyof Branding, label: string, props: React.InputHTMLAttributes<HTMLInputElement> & { hint?: string } = {}) => {
    const { hint, ...rest } = props;
    return (
      <Field label={label} htmlFor={`b-${k}`} error={errors[`branding.${k}`]} hint={hint}>
        <input id={`b-${k}`} value={v[k] ?? ""} onChange={set(k)} className={`${inputClass} ${errorRing(errors[`branding.${k}`])}`} {...rest} />
      </Field>
    );
  };
  const color = v.color ?? "#16759a";

  return (
    <Modal open onClose={onClose} size="xl" title={`Branding · ${name}`} description="How the app looks for this hospital (and on its domain), and what its bills and reports print as letterhead. Applied at the next check-in; kept offline."
      footer={
        <>
          {branding && <Button variant="ghost" className="mr-auto" onClick={() => submit(true)} disabled={busy}>Reset to default</Button>}
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => submit()} loading={busy}>Save branding</Button>
        </>
      }>
      <div className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-5 lg:grid-cols-[1fr_16rem]">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {input("appName", "App name", { placeholder: "MediCare", maxLength: 40, hint: "Replaces “MediCare” in the menu and sign-in page" })}
              {input("tagline", "Tagline", { placeholder: "Care that counts", maxLength: 120 })}
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Logo" htmlFor="b-logo" error={errors["branding.logo"]} hint="Square works best; resized to 256 px">
                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={() => fileRef.current?.click()}><ImagePlus className="size-4" /> {v.logo ? "Change" : "Upload"}</Button>
                  {v.logo && <Button variant="ghost" onClick={() => setV((s) => ({ ...s, logo: null }))} aria-label="Remove logo"><X className="size-4" /></Button>}
                  <input id="b-logo" ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
                </div>
              </Field>
              <Field label="Theme colour" htmlFor="b-color" error={errors["branding.color"]}>
                <div className="flex items-center gap-2">
                  <input id="b-color" type="color" value={color} onChange={(e) => setV((s) => ({ ...s, color: e.target.value }))} className="h-[38px] w-14 cursor-pointer rounded-lg ring-1 ring-slate-300" />
                  <span className="font-mono text-xs text-slate-500">{v.color ?? "default"}</span>
                  {v.color && <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setV((s) => ({ ...s, color: null }))}>Default</Button>}
                </div>
              </Field>
            </div>
            <p className="pt-1 text-sm font-medium text-slate-800">Letterhead on bills, reports and slips</p>
            <Field label="Address" htmlFor="b-address" error={errors["branding.address"]}>
              <textarea id="b-address" value={v.address ?? ""} onChange={set("address")} rows={2} maxLength={300} className={inputClass} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              {input("phone", "Phone", { maxLength: 40 })}
              {input("email", "Email", { type: "email", maxLength: 120 })}
              {input("website", "Website", { maxLength: 120, placeholder: "www.cityhospital.com" })}
              {input("gstin", "GSTIN", { maxLength: 15, className: `${inputClass} uppercase ${errorRing(errors["branding.gstin"])}` })}
            </div>
            <Field label="Footer on bills" htmlFor="b-footer" hint="e.g. “Thank you. Get well soon.”">
              <input id="b-footer" value={v.printFooter ?? ""} onChange={set("printFooter")} maxLength={300} className={inputClass} />
            </Field>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Preview</p>
            <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
              <div className="flex items-center gap-2.5 p-4" style={{ background: `color-mix(in oklab, ${color} 55%, black)` }}>
                {v.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.logo} alt="" className="size-8 rounded-lg bg-white object-contain p-0.5" />
                ) : (
                  <div className="rounded-lg p-1.5 text-white" style={{ background: color }}><Hospital className="size-5" /></div>
                )}
                <div>
                  <p className="text-sm font-semibold leading-tight text-white">{v.appName || "MediCare"}</p>
                  <p className="text-[11px] leading-tight text-white/70">{name}</p>
                </div>
              </div>
              <div className="space-y-2 bg-white p-4">
                <div className="h-2 w-2/3 rounded bg-slate-200" />
                <div className="h-2 w-1/2 rounded bg-slate-200" />
                <span className="inline-block rounded-lg px-3 py-1.5 text-xs font-medium text-white" style={{ background: color }}>Button</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
