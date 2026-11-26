/**
 * The owner's score sheet for the answer judge (SAN-69). The owner scores eval answers by hand
 * against RUBRIC, before any model judge sees them; the judge is trusted only if it agrees.
 * Each answer is shown the way its cards look in the app (name, where, fact bubbles, blurb), so
 * "does the blurb repeat the card?" is judged against what a visitor actually sees.
 */
import type { EvalCase, Trace } from "@/evals/graders";
import type { AppData } from "@/lib/data";
import { addressLine, openingFacts, openingSoonFacts } from "@/lib/format";
import { haversineMi, type LatLon } from "@/lib/rank";

/** Three yes/no questions per answer. A tick (yes) is always the good outcome. */
export const RUBRIC = [
  { key: "answers", question: "The summary answers what was asked (saying plainly when nothing fits counts)." },
  { key: "adds", question: "The blurbs add something the card can't show: why it fits, what it replaced, a caution." },
  { key: "no_repeats", question: "No blurb restates the card: cuisine, dates, inspection result or points, distance, address." },
] as const;
export type RubricKey = (typeof RUBRIC)[number]["key"];
/** null: the item doesn't apply (an answer with no picks has no blurbs to judge). */
export type Scores = Record<RubricKey, boolean | null>;

/** One answer as a reviewer sees it. */
export type AnswerForReview = {
  case: string;
  question: string;
  summary: string;
  picks: { id: string; name: string; where: string; facts: string[]; blurb: string }[];
};

const distance = (here: LatLon | undefined, lat: number | null, lon: number | null) =>
  here && lat !== null && lon !== null ? haversineMi(here, { lat, lon }) : undefined;

/** Builds the reviewer's view of one eval run: each pick with the card the app would show. */
export function answerForReview(c: EvalCase, trace: Trace, data: Pick<AppData, "openings" | "openingSoon">): AnswerForReview {
  const picks = trace.rawPicks.map(({ id, blurb }) => {
    const o = data.openings.find((x) => x.restaurant_id === id);
    if (o) {
      const facts = openingFacts({ ...o, distanceMi: distance(c.here, o.latitude, o.longitude) });
      return { id, name: o.name, where: addressLine(o), facts: facts.map((f) => f.label), blurb };
    }
    const s = data.openingSoon.find((x) => x.notice_id === id);
    if (s) {
      const facts = openingSoonFacts({ ...s, distanceMi: distance(c.here, s.latitude, s.longitude) });
      const where = addressLine({ address: s.street_address, city: s.city ?? "King County", category: "restaurant" });
      return { id, name: s.trade_name, where, facts: facts.map((f) => f.label), blurb };
    }
    return { id, name: "(unknown id: the app would drop this pick)", where: "", facts: [], blurb };
  });
  return { case: c.id, question: c.question, summary: trace.summary, picks };
}

/** The markdown sheet: one section per answer, a box per rubric item that applies. */
export function scoreSheet(answers: AnswerForReview[], source: string): string {
  const out = [
    "# Answer scores (SAN-69)",
    "",
    `Answers from \`${source}\`, run 0. Tick a box (\`[x]\`) when the answer meets it; leave it empty when it`,
    "doesn't. Answers with no picks only get the first question. A note after `Note:` is optional.",
    "Score these before looking at any judge output.",
    "",
  ];
  answers.forEach((a, i) => {
    out.push(`## ${i + 1}. ${a.case}`, "", `**Question:** ${a.question}`, "", `**Summary:** ${a.summary}`, "");
    if (a.picks.length === 0) out.push("_No picks._", "");
    a.picks.forEach((p, n) => {
      const where = p.where ? `, ${p.where}` : "";
      const facts = p.facts.length ? ` · ${p.facts.map((f) => `[${f}]`).join(" ")}` : "";
      out.push(`${n + 1}. **${p.name}**${where}${facts}`, `   > ${p.blurb}`);
    });
    if (a.picks.length) out.push("");
    for (const r of RUBRIC) if (a.picks.length || r.key === "answers") out.push(`- [ ] ${r.key}: ${r.question}`);
    out.push("", "Note:", "");
  });
  return out.join("\n");
}

/** Reads a filled-in sheet back: case id → scores (null where no box was offered) and the note. */
export function parseScoreSheet(md: string): Map<string, { scores: Scores; note: string }> {
  const out = new Map<string, { scores: Scores; note: string }>();
  for (const section of md.split(/^## \d+\. /m).slice(1)) {
    const id = section.slice(0, section.indexOf("\n")).trim();
    const scores = Object.fromEntries(RUBRIC.map((r) => [r.key, null])) as Scores;
    for (const m of section.matchAll(/^- \[([ xX])\] (\w+):/gm)) {
      if (m[2] in scores) scores[m[2] as RubricKey] = m[1] !== " ";
    }
    const note = section.match(/^Note:(.*)$/m)?.[1].trim() ?? "";
    out.set(id, { scores, note });
  }
  return out;
}
