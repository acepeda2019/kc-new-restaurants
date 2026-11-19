/**
 * Browser side of the question bar: sends a question to /api/ask with the visitor's location
 * and "Tried it" marks (both stay in the browser otherwise; ARCHITECTURE.md §7) and turns
 * every outcome into something the bar can show. Never throws.
 */
import type { AnswerPick } from "@/lib/ask";
import type { LatLon } from "@/lib/rank";

/** Matches the server's limit in app/app/api/ask/route.ts. */
export const MAX_QUESTION_CHARS = 500;

/** Example questions shown as chips under the bar (from the design mockup). */
export const ASK_CHIPS = ["Newest near me", "Skip ones I've tried", "Any to be wary of?", "New cafés this month"];

export type AskInput = { question: string; here?: LatLon; tried: Set<string> };
export type AskResult =
  | { ok: true; answer: string; picks: AnswerPick[]; left: number }
  | { ok: false; message: string; outOfQuestions?: true };

const NETWORK_ERROR = "Couldn't reach the server. Try again.";

export async function askQuestion(input: AskInput, fetchFn: typeof fetch = fetch): Promise<AskResult> {
  const question = input.question.trim();
  if (!question) return { ok: false, message: "Type a question first." };
  if (question.length > MAX_QUESTION_CHARS) {
    return { ok: false, message: `Keep it under ${MAX_QUESTION_CHARS} characters.` };
  }

  const body = { question, ...(input.here ? { here: input.here } : {}), tried: [...input.tried] };
  let res: Response;
  let data: { answer?: unknown; picks?: unknown; left?: unknown; message?: unknown };
  try {
    res = await fetchFn("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    data = await res.json();
  } catch {
    return { ok: false, message: NETWORK_ERROR };
  }

  if (res.ok && typeof data.answer === "string") {
    return {
      ok: true,
      answer: data.answer,
      picks: Array.isArray(data.picks) ? (data.picks as AnswerPick[]) : [],
      left: typeof data.left === "number" ? data.left : 0,
    };
  }
  const message = typeof data.message === "string" ? data.message : NETWORK_ERROR;
  return res.status === 429 ? { ok: false, message, outOfQuestions: true } : { ok: false, message };
}
