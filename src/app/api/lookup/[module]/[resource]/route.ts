import { handle, ok } from "@/lib/api";
import { lookup } from "@/lib/records";

type Ctx = { params: Promise<{ module: string; resource: string }> };

/** Minimal id/label search used by reference pickers in other modules' forms. `f.<field>=A|B` narrows by select fields. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { module, resource } = await params;
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const narrow = Object.fromEntries([...sp.entries()].filter(([k]) => k.startsWith("f.")).map(([k, v]) => [k.slice(2), v]));
  return ok(await lookup(module, resource, q, narrow));
});
