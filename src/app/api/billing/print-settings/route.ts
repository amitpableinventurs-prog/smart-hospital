import { handle, ok, readJson } from "@/lib/api";
import { getPrintSettings, savePrintSettings } from "@/lib/billing-print";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** The bill print template, logo and letterhead options, with the hospital's letterhead. */
export const GET = handle(async () => {
  await requireUser({ module: "billing" });
  await connectDB();
  return ok(await getPrintSettings());
});

/** { template, accent, logo, customLogo?, logoSize, headerNote, terms, footer, signatureLabel, showReceipts, showStamp, paper } */
export const PUT = handle(async (req) => {
  const user = await requireUser({ module: "billing" });
  const body = await readJson(req);
  await connectDB();
  return ok(await savePrintSettings(body, user, req));
});
