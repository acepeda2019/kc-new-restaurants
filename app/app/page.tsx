import { MapLegend } from "@/components/MapLegend";
import { PersonalPicks } from "@/components/PersonalPicks";
import { getMetrics, getOpenings, isSampleData } from "@/lib/data";
import { formatPlainDate } from "@/lib/format";

// Data is baked in at build time; each daily deploy rebuilds the page.
export const revalidate = false;

export default function Home() {
  const metrics = getMetrics();

  // The map is a fixed layer behind everything; header, panels and footer float over it.
  return (
    <div className="shell">
      <header className="topbar">
        <h1 className="pill logo">
          <span className="logo-mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
              <circle cx="12" cy="9.5" r="2.5" />
            </svg>
          </span>
          <span aria-hidden="true">KC New Eats</span>
          <span className="sr-only">King County New Eats</span>
        </h1>
        {isSampleData() && (
          <p className="pill sample" role="note">
            {/* One span: the pill's flex gap would otherwise space out the pieces. */}
            <span>
              <span className="sample-long">Sample data</span>
              <span className="sample-short">Sample</span> · not today&apos;s list
              <span className="sr-only">: a small real cut of King County records with hand-labelled classifications.</span>
            </span>
          </p>
        )}
      </header>

      <main className="home">
        {/* The full list goes to the browser (ARCHITECTURE.md §6) so location and "Tried it" never leave it. */}
        <PersonalPicks openings={getOpenings()} metrics={metrics} />
      </main>

      <footer className="bottombar">
        <MapLegend />
        <p className="pill source">King County inspection records · data as of {formatPlainDate(metrics.pulled_on)}</p>
      </footer>
    </div>
  );
}
