import "server-only";
import { ApiError } from "./api";

/**
 * Google Gemini client for AI automation. Server-side only — the API key
 * never reaches the browser. Configure in .env.local:
 *   GEMINI_API_KEY, GEMINI_MODEL (default gemini-3.5-flash),
 *   GEMINI_FALLBACK_MODEL (tried when the main model is rate-limited).
 */

const API = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 60_000;

export interface GenerateOptions {
  prompt: string;
  /** System instruction: role, tone, rules. */
  system?: string;
  /** Ask Gemini to answer with JSON only; use generateJson to parse it. */
  json?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface GenerateResult {
  text: string;
  model: string;
}

export function aiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

class RetryableError extends Error {}

async function callModel(model: string, key: string, opts: GenerateOptions): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
        contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
        generationConfig: {
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
          ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
          ...(opts.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    console.error("[ai] request failed:", err);
    throw new RetryableError("AI service is unreachable");
  }

  const body = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    console.error(`[ai] ${model} error ${res.status}:`, msg);
    if (res.status === 429 || res.status >= 500) throw new RetryableError(msg);
    if (res.status === 400 && /API key/i.test(msg)) throw new ApiError(503, "AI is not configured correctly (invalid API key)");
    if (res.status === 401 || res.status === 403) throw new ApiError(503, "AI API key was rejected");
    throw new ApiError(502, "AI request failed");
  }

  if (body.promptFeedback?.blockReason) throw new ApiError(422, "The AI declined this request");
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join("")
    .trim();
  if (!text) throw new ApiError(502, "AI returned an empty response");
  return text;
}

/** Generates text, falling back to GEMINI_FALLBACK_MODEL on rate limits or outages. */
export async function generateText(opts: GenerateOptions): Promise<GenerateResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ApiError(503, "AI is not configured. Set GEMINI_API_KEY.");

  const models = [process.env.GEMINI_MODEL || "gemini-3.5-flash", process.env.GEMINI_FALLBACK_MODEL].filter(
    (m, i, all): m is string => Boolean(m) && all.indexOf(m) === i
  );
  for (const model of models) {
    try {
      return { text: await callModel(model, key, opts), model };
    } catch (err) {
      if (!(err instanceof RetryableError)) throw err;
    }
  }
  throw new ApiError(503, "AI service is busy or out of quota. Please try again later.");
}

/** Generates and parses a JSON answer. Describe the expected shape in the prompt. */
export async function generateJson<T>(opts: Omit<GenerateOptions, "json">): Promise<T> {
  const { text } = await generateText({ ...opts, json: true });
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
  } catch {
    throw new ApiError(502, "AI returned malformed data");
  }
}
