// The question bar (ARCHITECTURE.md §7): the only Claude call at request time. Order matters
// (CLAUDE.md guardrail 1): session → input checks → caps (fail closed) → Claude. Logs carry
// counts, timings and cost (an answer) or status and error class (a failure), never the
// question or location.
import { NextResponse, type NextRequest } from "next/server";
import Anthropic, { APIError, AuthenticationError, BadRequestError, RateLimitError } from "@anthropic-ai/sdk";
import { Redis } from "@upstash/redis";
import { answer, buildRequest, resolvePicks, runFindOpenings, SAMPLE_NOTE, statsLine } from "@/lib/ask";
import { SESSION_COOKIE, VISITOR_COOKIE, verifySession } from "@/lib/auth";
import { checkAndCount, pacificDate } from "@/lib/caps";
import { getOpeningSoon, getOpenings, isSampleData } from "@/lib/data";
import type { LatLon } from "@/lib/rank";

export const runtime = "nodejs";

const MAX_QUESTION_CHARS = 500;
const MAX_TRIED_IDS = 1000;
const OUT_OF_QUESTIONS = "Out of questions for today. The map and lists still work.";
const UNAVAILABLE = "Couldn't get an answer right now. Try again later.";

type AskBody = { question: string; here?: LatLon; tried: string[] };

const reply = (status: number, message: string) => NextResponse.json({ message }, { status });

function parseBody(body: unknown): AskBody | null {
  if (!body || typeof body !== "object") return null;
  const { question, here, tried = [] } = body as Record<string, unknown>;
  if (typeof question !== "string" || !question.trim() || question.length > MAX_QUESTION_CHARS) return null;
  if (!Array.isArray(tried) || tried.length > MAX_TRIED_IDS || !tried.every((id) => typeof id === "string")) return null;
  if (here === undefined) return { question, tried };
  const { lat, lon } = (here ?? {}) as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { question, here: { lat, lon }, tried };
}

/** Most specific first; a fixed name survives minification, unlike constructor.name. */
function errorClass(err: unknown): string {
  if (err instanceof RateLimitError) return "RateLimitError";
  if (err instanceof AuthenticationError) return "AuthenticationError";
  if (err instanceof BadRequestError) return "BadRequestError";
  if (err instanceof APIError) return "APIError";
  return err instanceof Error ? "Error" : "unknown";
}

function logFailure(err: unknown): void {
  console.error("ask failed", { status: err instanceof APIError ? err.status : undefined, error: errorClass(err) });
}

export async function POST(request: NextRequest) {
  // 1. Session: checked here too, not only in proxy.ts.
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!(await verifySession(session, process.env.SESSION_SECRET ?? ""))) {
    return reply(401, "Log in first.");
  }

  // 2–3. Input and visitor id, before anything is counted.
  const body = parseBody(await request.json().catch(() => null));
  if (!body) return reply(400, `Ask a question of up to ${MAX_QUESTION_CHARS} characters.`);
  const visitor = request.cookies.get(VISITOR_COOKIE)?.value;
  if (!visitor || !/^[A-Za-z0-9-]{1,64}$/.test(visitor)) return reply(400, "Log in again to ask questions.");

  // A deploy without a key can't answer; refuse before using up anyone's question.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ask failed", { status: undefined, error: "MissingAnthropicApiKey" });
    return reply(503, UNAVAILABLE);
  }

  // 4. Caps. Missing config, a Redis error or a cap hit all fail closed.
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return reply(429, OUT_OF_QUESTIONS);
  let left: number;
  try {
    const redis = new Redis({ url, token, retry: { retries: 1 } });
    const caps = await checkAndCount(redis, visitor, new Date());
    if (!caps.ok) return reply(429, OUT_OF_QUESTIONS);
    left = caps.left;
  } catch (err) {
    logFailure(err);
    return reply(429, OUT_OF_QUESTIONS);
  }

  // 5. Only now: Claude. No SDK retries, so one counted question is at most MAX_TOOL_ROUNDS + 1
  //    billed calls (a search round trip adds one).
  try {
    const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 0 });
    const params = buildRequest(body.question, { here: body.here, today: pacificDate(new Date()) });
    const search = { openings: getOpenings(), openingSoon: getOpeningSoon(), here: body.here, tried: body.tried };
    const raw = await answer(client, params, (input) => runFindOpenings(input, search));
    const picks = resolvePicks(raw.picks, getOpenings(), getOpeningSoon());
    console.info("ask answered", statsLine(raw.stats, { written: raw.picks.length, shown: picks.length }));
    // Guardrail 5: an answer built from the labelled sample says so.
    const summary = isSampleData() ? `${raw.summary}\n\n${SAMPLE_NOTE}`.trim() : raw.summary;
    return NextResponse.json({ answer: summary, picks, left });
  } catch (err) {
    logFailure(err);
    return reply(503, UNAVAILABLE);
  }
}
