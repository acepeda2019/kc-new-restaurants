"use client";

/**
 * The question bar (SAN-40b): input, location button, chips and the answer. Before the
 * first question it shows the caller's "Today" brief (`intro`) as plain text under the bar,
 * with chips that follow from it; an answer's cards come in as `children`. The caller binds `onAsk` to the visitor's location and "Tried it" marks; the
 * API checks the caps before Claude.
 * Answers are plain text, rendered as text (never HTML).
 */
import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { AnswerPick } from "@/lib/ask";
import { MAX_QUESTION_CHARS, type AskResult } from "@/lib/askClient";

export type LocationStatus = "idle" | "asking" | "found" | "unavailable";

type Props = {
  onAsk: (question: string) => Promise<AskResult>;
  /** The Today brief, shown as plain text under the bar until the first question. */
  intro: ReactNode;
  /** Its label: "AI summary" when Claude wrote it, else "Today". */
  introLabel: string;
  /** Question chips (the brief's follow-ups). */
  chips: string[];
  location: { status: LocationStatus; onLocate: () => void };
  /** Told the answer's picks (empty when a new question starts or fails), so the map can highlight them. */
  onPicks?: (picks: AnswerPick[]) => void;
  /** The answer cards, shown under the answer text. */
  children?: ReactNode;
};

export function AskBar({ onAsk, intro, introLabel, chips, location, onPicks, children }: Props) {
  const [question, setQuestion] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  // Grow with the text (CSS caps it at six lines, then it scrolls), so a long question stays
  // readable after the visitor taps away. Runs on every change, including a chip filling it in.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [question]);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [left, setLeft] = useState<number | null>(null);

  async function ask(q: string) {
    if (pending) return; // aria-disabled keeps focus on the button, so ignore repeat clicks here
    setPending(true);
    onPicks?.([]);
    const r = await onAsk(q);
    setResult(r);
    onPicks?.(r.ok ? r.picks : []);
    if (r.ok) setLeft(r.left);
    else if (r.outOfQuestions) setLeft(0);
    setPending(false);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void ask(question);
  }

  // Enter sends, as in the old one-line input; Shift+Enter is ignored (questions are one line).
  // Skipped while an input method is composing (e.g. Japanese), where Enter confirms text.
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (!e.shiftKey) void ask(question);
  }

  function chip(text: string) {
    setQuestion(text);
    void ask(text);
  }

  return (
    <section aria-label="Ask about new restaurants" className="ask">
      <form className="ask-form" onSubmit={submit}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ask-spark">
          <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
        </svg>
        <label htmlFor="ask-input" className="sr-only">Ask about new restaurants</label>
        {/* The question, with a small "N left today" note under it once the visitor has asked. */}
        <div className="ask-field">
          <textarea
            id="ask-input"
            ref={input}
            rows={1}
            value={question}
            onChange={(e) => setQuestion(e.target.value.replace(/\n/g, " "))}
            onKeyDown={onKeyDown}
            maxLength={MAX_QUESTION_CHARS}
            placeholder="Ask anything about new restaurants…"
            autoComplete="off"
            enterKeyHint="send"
          />
          {left !== null && <span className="ask-left">{left} left today</span>}
        </div>
        {question && (
          // Clears the box for a new question and puts the cursor back; the last answer stays.
          <button
            type="button"
            className="ask-clear"
            onClick={() => {
              setQuestion("");
              input.current?.focus();
            }}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
            <span className="sr-only">Clear question</span>
          </button>
        )}
        <button
          type="button"
          className="ask-locate"
          onClick={location.onLocate}
          aria-disabled={location.status === "asking"}
          aria-pressed={location.status === "found"}
          title={location.status === "found" ? "Using your location" : "Use my location"}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z" />
            <circle cx="12" cy="11" r="2.2" />
          </svg>
          <span className="sr-only">{location.status === "asking" ? "Finding you…" : "Use my location"}</span>
        </button>
        <button type="submit" className="ask-send" aria-label="Ask" aria-disabled={pending}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>

      <p role="status" className="locate-status">
        {location.status === "asking" && "Finding you…"}
        {location.status === "unavailable" && "Location unavailable — showing the default order"}
        {location.status === "found" && "Showing what's near you"}
      </p>

      <div role="status" aria-live="polite" className="ask-answer-wrap">
        {pending && <p className="ask-pending">Thinking…</p>}
        {!pending && !result && (
          <div className="ask-brief">
            <span className="ask-brief-label">
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
              </svg>
              {introLabel}
            </span>
            {intro}
          </div>
        )}
        {!pending && result && (
          <div className={result.ok ? "ask-answer" : "ask-answer ask-error"}>
            <span className="ask-label">{result.ok ? "Answer" : "Couldn't answer"}</span>
            <p>{result.ok ? result.answer : result.message}</p>
            {result.ok && children}
          </div>
        )}
      </div>

      <ul className="ask-chips" aria-label="Example questions">
        {chips.map((text) => (
          <li key={text}>
            <button type="button" className="chip" onClick={() => chip(text)} aria-disabled={pending}>
              {text}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
