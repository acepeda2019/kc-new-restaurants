"use client";

/**
 * The ⓘ button in the header and the About panel it opens (a native <dialog>: focus is trapped,
 * Escape closes it, and the page behind is inert). Static text; nothing is fetched.
 */
import { useRef } from "react";

type Props = { questionsPerDay: number };

export function AboutButton({ questionsPerDay }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button type="button" className="pill about-button" onClick={() => dialog.current?.showModal()} title="About">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
        <span className="sr-only">About this site</span>
      </button>

      {/* A click on the backdrop (the dialog element itself, outside its content) closes it. */}
      <dialog
        ref={dialog}
        className="about"
        aria-labelledby="about-title"
        onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
      >
        <div className="about-body">
          <div className="about-head">
            <h2 id="about-title">About King County New Eats</h2>
            <button type="button" className="about-close" onClick={() => dialog.current?.close()}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
              <span className="sr-only">Close</span>
            </button>
          </div>

          <h3>What this is</h3>
          <p>
            A map of restaurants that just opened in King County, WA, and the ones about to. Ask the bar anything
            (&ldquo;new Thai near me?&rdquo;, &ldquo;anything to be wary of?&rdquo;) and it answers from the data, with
            cards that show each place on the map.
          </p>

          <h3>Where the data comes from</h3>
          <ul>
            <li>
              <strong>Just opened:</strong> King County health inspections. A place counts as new at its first
              inspection, which usually comes weeks after it opens, so there are no exact opening dates. Cuisine
              is inferred and labelled &ldquo;likely&rdquo;.
            </li>
            <li>
              <strong>Opening soon:</strong> Washington liquor licence applications, so places without alcohol
              won&apos;t show until they open. An application isn&apos;t a promise: some applicants open months
              later, and some never do.
            </li>
            <li>
              <strong>Map:</strong> OpenStreetMap via OpenFreeMap; addresses placed by the US Census geocoder.
            </li>
            <li>Updated every morning. The summary under the bar is written by Claude from that day&apos;s data.</li>
          </ul>

          <h3>How to use it</h3>
          <ul>
            <li>Tap the pin in the question bar to see what&apos;s near you.</li>
            <li>Tap a name or a pin to show it on the map; the corner button resets the view.</li>
            <li>Mark places &ldquo;Tried&rdquo; to skip them in answers. That&apos;s stored in your browser only.</li>
            <li>You get {questionsPerDay} questions a day.</li>
            <li>
              Questions you ask are saved for 90 days, with your approximate location (about 1 km) if
              you shared it, so the app can be improved. Nothing else you do here is saved.
            </li>
          </ul>

          <p>
            <a href="https://github.com/acepeda2019/kc-new-restaurants" target="_blank" rel="noopener noreferrer">
              How it&apos;s built, on GitHub
            </a>
          </p>

          <p className="about-note">
            A personal project, not affiliated with King County or the Washington State Liquor and Cannabis Board. An
            inspection result describes one visit, not food quality.
          </p>
        </div>
      </dialog>
    </>
  );
}
