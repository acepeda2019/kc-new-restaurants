"use client";

/**
 * The question bar (SAN-40b): input, example chips and the answer. The caller binds `onAsk`
 * to the visitor's location and "Tried it" marks; the API checks the caps before Claude.
 * Answers are plain text, rendered as text (never HTML).
 */
import { useState, type FormEvent, type ReactNode } from "react";
import type { AnswerPick } from "@/lib/ask";
import { ASK_CHIPS, MAX_QUESTION_CHARS, type AskResult } from "@/lib/askClient";

type Props = {
  onAsk: (question: string) => Promise<AskResult>;
  /** Told the answer's picks (empty when a new question starts or fails), so the map can highlight them. */
  onPicks?: (picks: AnswerPick[]) => void;
  /** The answer cards, shown under the answer text. */
  children?: ReactNode;
};

export function AskBar({ onAsk, onPicks, children }: Props) {
  const [question, setQuestion] = useState("");
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
        <input
          id="ask-input"
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={MAX_QUESTION_CHARS}
          placeholder="Ask anything about new restaurants…"
          autoComplete="off"
          enterKeyHint="send"
        />
        {left !== null && <span className="ask-left">{left} left today</span>}
        <button type="submit" className="ask-send" aria-label="Ask" aria-disabled={pending}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>

      <ul className="ask-chips" aria-label="Example questions">
        {ASK_CHIPS.map((text) => (
          <li key={text}>
            <button type="button" className="chip" onClick={() => chip(text)} aria-disabled={pending}>
              {text}
            </button>
          </li>
        ))}
      </ul>

      <div role="status" aria-live="polite" className="ask-answer-wrap">
        {pending && <p className="ask-pending">Thinking…</p>}
        {!pending && result && (
          <div className={result.ok ? "ask-answer" : "ask-answer ask-error"}>
            <span className="ask-label">{result.ok ? "Answer" : "Couldn't answer"}</span>
            <p>{result.ok ? result.answer : result.message}</p>
            {result.ok && children}
          </div>
        )}
      </div>
    </section>
  );
}
