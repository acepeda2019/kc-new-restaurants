import { Metrics } from "@/components/Metrics";
import { OpeningList } from "@/components/OpeningList";
import { TopThree } from "@/components/TopThree";
import { getManifest, getMetrics, getOpenings, isSampleData } from "@/lib/data";
import { formatPlainDate, pacificDate } from "@/lib/format";
import { othersByRank, personalTopThree } from "@/lib/rank";

// Data is baked in at build time; each daily deploy rebuilds the page.
export const revalidate = false;

export default function Home() {
  const openings = getOpenings();
  // No location or "Tried it" yet (SAN-39): plain rank order.
  const top = personalTopThree(openings, { tried: new Set() });
  const rest = othersByRank(openings, top);
  const updated = formatPlainDate(pacificDate(getManifest().built_at));

  return (
    <main>
      {isSampleData() && (
        <p className="sample-banner" role="note">
          Sample data — a small real cut of King County records with hand-labelled
          classifications, not today&apos;s list.
        </p>
      )}
      <h1>King County New Eats</h1>
      <p className="updated">Updated {updated}</p>

      <Metrics metrics={getMetrics()} />

      <section aria-labelledby="top-three">
        <h2 id="top-three">Top 3 new openings</h2>
        <TopThree items={top} />
      </section>

      {rest.length > 0 && (
        <section aria-labelledby="the-rest">
          <h2 id="the-rest">Everything else, by rank</h2>
          <OpeningList items={rest} />
        </section>
      )}
    </main>
  );
}
