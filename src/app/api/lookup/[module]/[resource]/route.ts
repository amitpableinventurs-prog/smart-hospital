import { handle, ok } from "@/lib/api";
import { lookup } from "@/lib/records";

type Ctx = { params: Promise<{ module: string; resource: string }> };

/** Minimal id/label search used by reference pickers in other modules' forms. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { module, resource } = await params;
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  return ok(await lookup(module, resource, q));
});
