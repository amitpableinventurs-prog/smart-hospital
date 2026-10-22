import { Hospital } from "lucide-react";
import type { LicenceView } from "@/lib/licence-protocol";

const HEX = /^#[0-9a-f]{6}$/i;

/** Recolours the app's brand palette from one colour (a client's branding on the Control Panel). */
export function BrandTheme({ color }: { color: string | null | undefined }) {
  if (!color || !HEX.test(color)) return null;
  const mix = (pct: number, with_: "white" | "black") => `color-mix(in oklab, ${color} ${pct}%, ${with_})`;
  const css = `:root{--color-brand-50:${mix(7, "white")};--color-brand-100:${mix(18, "white")};--color-brand-200:${mix(35, "white")};--color-brand-300:${mix(55, "white")};--color-brand-400:${mix(75, "white")};--color-brand-500:${mix(88, "white")};--color-brand-600:${color};--color-brand-700:${mix(82, "black")};--color-brand-800:${mix(68, "black")};--color-brand-900:${mix(52, "black")}}`;
  return <style>{css}</style>;
}

/** The hospital's logo when its branding has one, otherwise the default mark. */
export function BrandMark({ brand, className = "size-5", boxClassName = "rounded-lg bg-brand-600 p-1.5 text-white" }: { brand?: LicenceView["brand"] | null; className?: string; boxClassName?: string }) {
  if (brand?.logoVersion) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/branding/logo?v=${encodeURIComponent(brand.logoVersion)}`} alt="" className="size-8 rounded-lg bg-white object-contain p-0.5" />;
  }
  return <div className={boxClassName}><Hospital className={className} aria-hidden /></div>;
}
