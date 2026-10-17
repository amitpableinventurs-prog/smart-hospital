import { ApiError, handle, ok, readJson } from "@/lib/api";
import { aiConfigured, generateText } from "@/lib/ai";
import { requireUser } from "@/lib/session";

const MAX_PROMPT = 20_000;

/** GET /api/ai — whether AI automation is available. */
export const GET = handle(async () => {
  await requireUser();
  return ok({ configured: aiConfigured() });
});

/**
 * POST /api/ai  { prompt, system? }
 * General-purpose Gemini call for signed-in users.
 */
export const POST = handle(async (req) => {
  await requireUser();
  const body = await readJson(req);
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) throw new ApiError(422, "Validation failed", { prompt: "Prompt is required" });
  if (prompt.length > MAX_PROMPT) throw new ApiError(422, "Validation failed", { prompt: `Keep it under ${MAX_PROMPT} characters` });
  const system = typeof body.system === "string" ? body.system.slice(0, 4_000) : undefined;

  const result = await generateText({ prompt, system });
  return ok(result);
});
