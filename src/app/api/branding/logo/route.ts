import { connection } from "next/server";
import { connectDB } from "@/lib/db";
import { appMode } from "@/lib/deployment";
import { Licence } from "@/models/licence";

/** The hospital's logo from its Control Panel branding (public: shown on the sign-in page). ?v= changes with the branding. */
export async function GET() {
  await connection();
  if (appMode() !== "client") return new Response(null, { status: 404 });
  await connectDB();
  const lic = await Licence.findById("licence").select("branding").lean();
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(String((lic?.branding as { logo?: string } | undefined)?.logo ?? ""));
  if (!m) return new Response(null, { status: 404 });
  return new Response(Buffer.from(m[2], "base64"), { headers: { "Content-Type": m[1], "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
}
