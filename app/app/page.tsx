import { Metrics } from "@/components/Metrics";
import { TopThree } from "@/components/TopThree";
import { getMetrics, getOpenings, isSampleData } from "@/lib/data";
import { formatPlainDate } from "@/lib/format";
import { personalTopThree } from "@/lib/rank";

// Data is baked in at build time; each daily deploy rebuilds the page.
export const revalidate = false;

export default function Home() {
  const metrics = getMetrics();
  // No location or "Tried it" yet (SAN-39): plain rank order.
  const top = personalTopThree(getOpenings(), { tried: new Set() });

  return (
    <main>
      {isSampleData() && (
        <p className="sample-banner" role="note">
          Sample data — a small real cut of King County records with hand-labelled
          classifications, not today&apos;s list.
        </p>
      )}
      <h1>King County New Eats</h1>
      <p className="updated">Data as of {formatPlainDate(metrics.pulled_on)}</p>

      <Metrics metrics={metrics} />

      <section aria-labelledby="top-three">
        <h2 id="top-three">Top 3 new openings</h2>
        <TopThree items={top} />
      </section>
    </main>
  );
}
