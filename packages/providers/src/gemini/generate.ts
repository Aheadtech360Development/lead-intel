/**
 * Google's Generative Language API, for the two places this product asks a model a question.
 *
 * Shaped like every other adapter here: a discriminated union out, never a throw, so a caller
 * cannot mistake a failure for an empty answer. That matters more with a model than with an
 * ordinary API. A crawl that fails returns nothing and the absence is obvious; a model that fails
 * halfway can return *something*, and something plausible is the most expensive kind of wrong in a
 * tool whose output goes onto a sales call.
 *
 * Nothing here decides anything. Both callers treat the result as a suggestion sitting next to
 * evidence the operator can read for themselves.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export type GeminiResult =
  | { ok: true; text: string; inputTokens: number; outputTokens: number }
  | { ok: false; reason: GeminiFailure; detail: string };

export type GeminiFailure =
  | "no_key"
  | "auth_failed"
  | "rate_limited"
  | "quota_exhausted"
  | "blocked"
  | "empty_response"
  | "truncated"
  | "bad_json"
  | "timeout"
  | "http_error"
  | "network_error";

/**
 * Failures that mean *stop the whole pass*, not *skip this one*.
 *
 * Same distinction the Apify adapter draws. Without it a batch of 330 businesses meets a bad key
 * and makes 330 identical failing requests, which is slow, noisy, and can get an account limited
 * for the trouble.
 */
export function isFatal(reason: GeminiFailure): boolean {
  return reason === "no_key" || reason === "auth_failed" || reason === "quota_exhausted";
}

export interface GeminiRequest {
  apiKey: string | undefined;
  /** Defaults to the model the operator chose for testing. */
  model?: string;
  /** Instructions about the job. Sent as Gemini's `systemInstruction`. */
  system: string;
  /** The actual material to work on. */
  user: string;
  /** Ask for JSON back, and refuse anything else. */
  json?: boolean;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export async function callGemini(request: GeminiRequest): Promise<GeminiResult> {
  if (!request.apiKey) {
    return {
      ok: false,
      reason: "no_key",
      detail: "GEMINI_API_KEY is not set, so nothing was asked and nothing was spent.",
    };
  }

  const model = request.model ?? DEFAULT_GEMINI_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? 30_000);

  try {
    const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        // In the header rather than the query string: a key in a URL ends up in logs, proxies and
        // error messages, and this one would then be sitting in a stack trace somebody pastes.
        "x-goog-api-key": request.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.user }] }],
        generationConfig: {
          // Zero, deliberately. The same website should produce the same summary twice; a rule
          // suggestion that changes on a re-press is one the operator cannot reason about. Some
          // variation survives anyway — this reduces it, it does not remove it.
          temperature: 0,
          maxOutputTokens: request.maxOutputTokens ?? 2400,
          /**
           * Thinking off.
           *
           * The 2.5 models think by default, and **thinking tokens are charged against
           * `maxOutputTokens`**. So a 900-token ceiling was mostly spent reasoning, the answer got
           * cut off mid-string, and the caller reported "expected JSON and got something else" —
           * which is true but describes the symptom, not the cause.
           *
           * Neither of these jobs needs deliberation. Both are structured extraction from material
           * that is already in front of the model: pick keywords from a description, or restate
           * findings as prose. Turning it off makes the whole budget available for the answer, and
           * makes the answer cheaper and faster as well.
           */
          thinkingConfig: { thinkingBudget: 0 },
          ...(request.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, reason: httpFailure(response.status), detail: `HTTP ${response.status}. ${body.slice(0, 300)}` };
    }

    const payload = (await response.json()) as GeminiResponse;

    // A response can arrive with 200 and no content — the model declined, or stopped on a safety
    // filter, or hit the token ceiling mid-sentence. Each is reported as itself rather than as an
    // empty string the caller would render as a blank panel.
    const candidate = payload.candidates?.[0];
    if (!candidate) {
      const blocked = payload.promptFeedback?.blockReason;
      return blocked
        ? { ok: false, reason: "blocked", detail: `The model declined to answer: ${blocked}.` }
        : { ok: false, reason: "empty_response", detail: "The model returned no answer at all." };
    }
    if (candidate.finishReason === "SAFETY" || candidate.finishReason === "PROHIBITED_CONTENT") {
      return { ok: false, reason: "blocked", detail: `The model stopped: ${candidate.finishReason}.` };
    }

    const text = (candidate.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();

    if (text.length === 0) {
      // MAX_TOKENS with no text is its own thing: the answer was cut off before a single word
      // survived, which is a request that needs a bigger ceiling rather than a retry.
      const why =
        candidate.finishReason === "MAX_TOKENS"
          ? "The answer was cut off before any text came back — the length limit is too low for this request."
          : `The model returned an empty answer (${candidate.finishReason ?? "no reason given"}).`;
      return { ok: false, reason: "empty_response", detail: why };
    }

    /**
     * A partial answer is a failure, not a success with less in it.
     *
     * Returning `ok` here was the bug the operator hit: the model stopped at the ceiling mid-string,
     * the caller got well-formed-looking text that `JSON.parse` rejected, and the message said "not
     * JSON" — sending anyone debugging it after the prompt rather than the token limit. Truncation
     * has to be named where it is detected, because it is the only place that can see it.
     */
    if (candidate.finishReason === "MAX_TOKENS") {
      return {
        ok: false,
        reason: "truncated",
        detail: `The answer was cut off at the ${request.maxOutputTokens ?? 2400}-token limit, so it is incomplete.`,
      };
    }

    return {
      ok: true,
      text,
      inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, reason: "timeout", detail: `No answer within ${request.timeoutMs ?? 30_000}ms.` };
    }
    return { ok: false, reason: "network_error", detail: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parses a JSON answer, and says so plainly when it is not JSON.
 *
 * `responseMimeType: "application/json"` makes this rare rather than impossible, and the failure
 * mode without a check here is the bad one: `JSON.parse` throws inside a server action and the
 * operator gets a stack trace instead of "the model returned something I could not read".
 */
export function parseJsonAnswer<T>(result: GeminiResult): { ok: true; value: T } | { ok: false; detail: string } {
  if (!result.ok) return { ok: false, detail: result.detail };
  // Models sometimes wrap JSON in a fenced block even when asked not to. Cheap to tolerate.
  const cleaned = result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return { ok: true, value: JSON.parse(cleaned) as T };
  } catch {
    return { ok: false, detail: `Expected JSON and got something else: ${cleaned.slice(0, 200)}` };
  }
}

function httpFailure(status: number): GeminiFailure {
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 429) return "rate_limited";
  return "http_error";
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}
