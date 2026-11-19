import { PersonalPicks } from "@/components/PersonalPicks";
import { getMetrics, getOpenings, isSampleData } from "@/lib/data";
import { formatPlainDate } from "@/lib/format";

// Data is baked in at build time; each daily deploy rebuilds the page.
export const revalidate = false;

export default function Home() {
  const metrics = getMetrics();

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

      {/* The full list goes to the browser (ARCHITECTURE.md §6) so location and "Tried it" never leave it. */}
      <PersonalPicks openings={getOpenings()} metrics={metrics} />
    </main>
  );
}
