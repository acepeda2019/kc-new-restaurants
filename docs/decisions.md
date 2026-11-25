# Decision log

Newest first. One entry per decision: context, decision, consequences.
This is the *why*. The current system is described in `ARCHITECTURE.md`; an entry marked
*(superseded)* is kept as history only.

## 2026-11-25 — Classification: 0.8 stays, thinking stays at its default
- **Context:** SAN-66. Nobody had measured how often Claude's classifications are right or whether the 0.8 `min_confidence` is calibrated. The owner labelled 50 places, sampled 10/15/15/10 across the confidence bands with floors for the hard cases (labels drafted by an AI tool, every row checked by the owner). Classification never sets `thinking`, so Haiku 5.5 thinks when it judges it useful.
- **Decision:** keep `min_confidence` at 0.8 and leave `thinking` unset. No code or setting changes.
- **Evidence:** stored answers (local build of 2026-11-20): 70% fully right, and accuracy rises with confidence (50%, 53%, 80% and 100% per band), so an estimated 16% of shown places are wrong at 0.8, against 31% at 0.6. Re-running today's prompt over the same 50 gives 82% with the default and 76% with thinking off (4 places better with the default, 1 worse, 45 the same); the default costs about 25% more output tokens, about $0.0104 against $0.0097 for 50 places.
- **Consequences:** today's prompt beats the stored answers (6 places better, none worse) because most stored answers predate the SAN-63 prompt change, and the input hash only re-sends a place when its inputs change. Under today's prompt the 0.6–0.8 band scored 11 of 13, so a lower threshold may become right once answers are refreshed; with bands of about 10 to 15 places (roughly ±13 points), that needs re-measuring before changing the threshold. Cuisine isn't scored: Claude names it at a finer grain than the labels ("Sushi" vs "Japanese"), and there is no fixed list.

## 2026-11-20 — A predecessor must be at the same premises and closed
- **Context:** SAN-63. Pizza Twist was labelled "replaces Apple Teriyaki", a neighbour in another unit of the same building that is still open. Priors were any business at the same address key (street and zip, no unit) last inspected within 12 months, so neighbours in malls and strip centres looked like predecessors.
- **Decision:** a prior must be in the same unit (no unit on either side counts as the same) and, if differently named, last inspected on or before the candidate's first inspection (same day kept after QA found real handovers there, e.g. Stone Korean replacing Subway in STE 114). The 365/30-day window moved into `score_params` too. A same-name prior (Jaro-Winkler on the name key ≥ 0.85, new seed column `score_params.prior_same_name_min`) stays even while still inspected: that's the county re-issuing an ID. The name-key expression moved into a macro shared with the WSLCB matching.
- **Consequences:** on 2026-11-20 data, 87 of 644 candidates lose at least one prior (42 lose all); data-qa judged 8 of the 10 "replaces X" labels that lose their predecessor as right (different units, or a neighbour still open). Ownership transfers keep their priors (one, Porter Hospitality, loses it). Venue sibling outlets (Space Needle kiosks, school serveries) still pass the 0.85 same-name test; Claude decides. Those 87 get a new input hash, so the next deploy re-classifies them (Haiku, a few cents). A neighbour with no unit on record is still kept, and a real predecessor whose last inspection came after the new place's first (overlap) is now dropped.

## 2026-11-20 — Claude sees places only through the search
- **Context:** SAN-62. Testing pizza questions, the owner saw a "last month" answer with a sushi place and a September opening on its cards. Claude had answered from the 100 places in its prompt instead of searching, so the code that limits cards to search results never ran. Instructions to search were not enough; a later run also translated "pizza" into "Italian" and found nothing.
- **Decision:** the request carries no places. Claude must search to see any, and code shows cards only from search results (no search, no cards). The search's cuisine filter also matches names, a miss returns the known cities or cuisines for one retry, and a "latest inspection Unsatisfactory" filter answers "anything to be wary of?". Fixed meanings for "last week"/"last month"; the summary always states count and period.
- **Consequences:** almost every question is two calls, but each carries at most 20 places instead of 100: on 8 real questions, about 6,700 input tokens per question versus about 26,100 before (~75% less). Pizza "last month" returned 3 in 6 of 6 runs; "Any to be wary of?" 48 and the Seattle version 14, both exact. Comparing across many places now works through filters, not one long list.

## 2026-11-20 — Desktop: the question column moves to the left
- **Context:** user feedback (SAN-61): on desktop the answer sat in the middle of the map, so when the map flew to a place it landed behind the answer.
- **Decision:** on screens 1100px and wider, the bar, brief, answer and chips sit in a left column (about 460px); a long answer scrolls inside it; the map camera pads 520px on the left so framing and fly-to land in the open area. Phones are unchanged. This reverses the 2026-11-19 "bar centred at the top" layout for desktop.
- **Consequences:** the map is always visible beside the answer; the bar is no longer centred, but it stays the first thing on the page.

## 2026-11-20 — Code counts, Claude talks: a search over every place for filtered questions
- **Context:** user feedback (SAN-58): "How many new restaurants opened in Kirkland this month?" asked five ways gave different, sometimes self-contradicting answers. Claude counted by reading a list of at most 100 of ~230 places (chosen by rank or distance), without knowing today's date; a named place outside that list (Nori Sushi, Maple Valley, rank 224) couldn't be found from Seattle.
- **Decision:** a deterministic search (`findOpenings`) over every place, with filters for name, city, cuisine, kind and first-inspected date (plus Opening soon). Claude requests it inside its structured reply rather than as a tool (Haiku 5.5 answered in JSON instead of calling tools when a strict answer format was set); code runs it and Claude answers from the result, stating the filter. Today's date and fixed meanings for "this week/month/recently" are in the prompt. Considered: precomputed counts (cheaper, rigid) and a semantic layer such as Cube (overkill for one metric over ~230 rows).
- **Consequences:** filtered questions cost two Claude calls (at most three), others still one; the per-visitor and global caps are unchanged. On the real data the four "this month" phrasings now all answer 1 (Mediterranean Kitchen), and "Tell me about Nori Sushi" finds both locations. Interpreting the question can still vary (e.g. a question with no time period lists recent places rather than counting).

## 2026-11-20 — Say "first inspected" and "licence applied", never an opening date
- **Context:** user feedback (SAN-59): is a permit the same as open, and does a filing mean "opening soon"? The data has no opening dates: a place's first King County inspection usually comes weeks after it opens, and a liquor licence application isn't a promise (55% of Jan–Jun 2026 King County restaurant licences had a first inspection by November, median 164 days).
- **Decision:** wording only. Card bubbles say "first inspected <date>" (shown only when a later inspection exists; with one visit the inspection bubble carries the date) and "licence applied <date>"; the template brief says "first inspected this week", "is new in", "applied for a liquor licence"; the About panel states both caveats; Claude's rules forbid "opened on <date>" and promising an applicant will open. Section and legend names ("Just opened", "Opening soon") stay.
- **Consequences:** slightly less natural wording in exchange for claims the data supports. No data, scoring or ranking change.

## 2026-11-20 — Show the county's latest result, score and address; orange means Unsatisfactory
- **Context:** user feedback (SAN-60). The map showed "Nori Sushi · 25 red points at first inspection (Jun 16)" with no address; the county's site shows that Maple Valley location as Unsatisfactory, 30 pts, while a separate Federal Way Nori Sushi scored 0. Cards fell back to a bad first inspection when a later one was clean (a bug from PR #54), and an educational first visit hid later failures.
- **Decision:** cards, popups and answers show the **latest** inspection as the county does (verdict, score = red + blue points, date) and the street address. No link out to the county's site (owner: it would send people to the source instead of showing what this app adds). The orange pin means "Unsatisfactory at the latest inspection" (the county's verdict on that visit), not "any red points" and not the county's rating, which we don't copy.
- **Consequences:** on 2026-11-20, 48 orange pins instead of 49 (the county marks almost any red points Unsatisfactory). Ranking still boosts a clean *first* inspection (2026-11-17 decision), so a place like Masthi (educational first visit, then three Unsatisfactory) can rank high while its pin is orange; revisit with SAN-58.

## 2026-11-19 — Claude words the Today brief once per daily build
- **Context:** the template brief is correct but flat; the owner wanted the brief in plain English, the way Claude would say it.
- **Decision:** the daily build makes one Haiku call (`WRITE_AI_BRIEF=1`, set only in `daily.yml`) that words the same facts the template uses. Claude names places only as `{{id}}` tokens; the build accepts the text only if every id is a place in the facts, it's under 500 characters and has no HTML, else it uses the template. Labelled "AI summary". Not a request-time call, so the guardrail that `/api/ask` is the only request-time Claude call still holds.
- **Consequences:** about one Haiku call a day (well under a cent). Preview and local builds never call Claude. Once a visitor shares their location the template brief takes over, since only it knows what's near them.

## 2026-11-19 — A public link-preview image
- **Context:** a shared link showed a plain grey bubble with the default Next.js icon; the owner wants a picture, like other apps (SAN-54).
- **Decision:** a generated 1200×630 preview image, an SVG icon and a phone home-screen icon, with Open Graph and Twitter tags in the root layout. Link previews can't pass the passcode, so they see `/login`, which carries the tags; the three image paths are added to the proxy's public list.
- **Consequences:** three paths are public, by exact match, and show the brand only; restaurant data stays behind the passcode. The preview image's URL is fixed to the production domain (`metadataBase`).

## 2026-11-19 — The page is the question bar: a Today brief replaces every panel
- **Context:** the owner wants the app centred on the question bar, encouraging exploration by asking rather than browsing tiles, cards and lists (the 2018 pattern). A first version with cards on load still took too much space.
- **Decision:** before the first question, a two- or three-sentence "Today" brief sits under the bar in a gradient-bordered panel, with tappable place names and up to four chips that follow from it. It's written by a template from the page's data (no Claude call) and labelled "Today", not "AI summary", until Claude writes it (next PR, publish-time). Removed: the top 3 panel, the three stat tiles, the Opening soon panel and the All places list. "Use my location" is a pin button in the bar. On desktop the bar is centred at the top.
- **Consequences:** the page costs no Claude call until someone asks, and a visitor out of questions still has the brief and map. Food trucks (no pin) and places the brief doesn't name are found only by asking; the text list that was the keyboard and screen-reader route to the map is gone, so the question bar now carries that. The 30-day comparison and clean-inspection count leave the screen (still in `metrics.json`).

## 2026-11-19 — Question-bar answers return picks, not prose
- **Context:** answers were a paragraph, so a visitor couldn't act on a suggested place (e.g. find Menya Muso on the map). The owner wants the bar to be the app's centre, with clickable answers.
- **Decision:** Claude replies through structured output with a short summary and up to 5 picks (owner: five, not three), each a place id from the data plus a one- or two-sentence blurb. The server drops ids that aren't real places and takes names from our data. `max_tokens` rises from 400 to 600 to fit five blurbs.
- **Consequences:** cards and tap-to-zoom can be built on the picks (next PR). Cost per question rises slightly (more output tokens, still within the existing caps). A reply that isn't valid JSON shows a fixed message instead of partial text.

## 2026-11-19 — How Opening soon appears in the app
- **Context:** the Opening soon data (SAN-48/50) needed a place on the one-screen app (SAN-49).
- **Decision:**
  - A panel labelled "From liquor licence applications", so visitors know it misses places without alcohol. On desktop it sits under the stat tiles; on phones it follows the top 3.
  - Map pins are **hollow rings**, so "not open yet" reads by shape, not just colour.
  - Ranked newest application first, or nearest first once located. The first five show.
  - The question bar receives the list as a separate block and must never call these places open.
- **Consequences:** a place leaves the panel when it is first inspected (it then appears in Just opened) or after 365 days.

## 2026-11-19 — Licence addresses share the KC geocode cache
- **Context:** Opening soon places need coordinates for map pins and distance ranking.
- **Decision:**
  - After saving the daily WSLCB snapshot, the job sends its King County addresses through the same Census geocoder, under the same key rule (v1), so licence and inspection addresses share one cache and are geocoded once.
  - In dbt the key rule is now one macro (`macros/geocode_key.sql`), used by both `int_establishments` and `int_opening_soon_candidates`. `assert_geocode_key_matches_requests` keeps checking it against what the geocoder was sent.
  - `mart_opening_soon` and `opening_soon.json` gain nullable `latitude`/`longitude`. That's an added column, not a schema bump.
- **Consequences:** a place gets coordinates from the first daily run after its notice appears. The step stays non-fatal, so a geocoder outage just leaves coordinates null.

## 2026-11-19 — Opening soon export (schema version 2)
- **Context:** the app needs the Opening soon list; the export/app contract is versioned by `manifest.schema_version`.
- **Decision:**
  - `mart_opening_soon` holds King County restaurant licence applications not yet matched to a KC inspection and younger than `seeds/opening_soon_params.csv` `max_pending_days` (365, given the 164-day median lead time).
  - Ranked newest application first, with a factual "why" ("Applied for a full-bar restaurant licence on Nov 4"; licence labels in `seeds/lcb_privilege_rules.csv`). "As of" is the newest snapshot, not the build clock.
  - The export adds `opening_soon.json` and `manifest.opening_soon_count`, as schema version 2. The app accepts only 2, and both ship in the same deploy.
  - An empty Opening soon list is allowed; the publish guard still applies only to Just opened.
- **Consequences:**
  - No coordinates yet: licence addresses aren't geocoded, so pins and distance ranking wait for a geocoding step before the app list.
  - The licensee name stays out of the mart (tested in dbt and in the app's sample test).

## 2026-11-19 — Match licence applicants to inspections by rules first
- **Context:** an Opening soon place has opened when it gets its first KC inspection, but LCB and KC share no ID.
- **Decision:**
  - Pair a notice with KC businesses at the same ZIP and street number, first inspected no earlier than 30 days before the application (earlier ones are the previous business).
  - Score cleaned names with Jaro-Winkler: ≥ 0.85 is a match, 0.70–0.85 is for review, below is a different business. Thresholds are in `seeds/lcb_match_params.csv`; `seeds/lcb_match_overrides.csv` wins.
  - Every pair is kept (`int_lcb_match_pairs`). Claude judging borderline pairs is deferred until review volume shows it's needed.
- **Consequences:**
  - On 69 real 2026 licences, 48% matched.
  - Median lead time is 164 days, so places stay in Opening soon for months.
  - KC often records the company name, so matching also scores the LCB licensee name. That lifts matches to 38 of 69 (55%).
  - **Owner decision:** `licensee_name` (sometimes a person) is kept in staging for matching only. It never reaches a mart or the app; test `no_licensee_name_in_marts` enforces it.
  - The drop-off cutoff waits for a week of snapshots.

## 2026-11-19 — Which licence notices count for Opening soon
- **Context:** WSLCB notices cover every licence type (restaurants, bars, shops, cannabis, tobacco, shipping) and several notice types. Source card: `docs/source_cards/lcb_local_authority.md`.
- **Decision:**
  - A King County notice counts when its notice type is a new application or a change of location, and **any** of its seven privileges is a restaurant licence (`S/B/W RESTAURANT LOUNGE (+)`/`(-)`, `B/W RESTAURANT - BEER/WINE`).
  - Assumptions (ownership changes), taverns, snack bars, shops, takeout add-ons, catering, cannabis, tobacco and shipping don't count. Taverns and snack bars are judgement calls, marked in the seed.
  - Rules live in `seeds/lcb_privilege_rules.csv` and `seeds/lcb_notice_types.csv`. A value not in the seeds doesn't count, and a warn-level test flags it for review.
- **Consequences:** on 2026-11-19 three King County notices qualify (Dantini Dello, Taurus Karaoke & Lounge, 67 Pizza). Flipping a judgement call is a one-line seed edit.

## 2026-11-19 — Opening soon uses LCB licence notices only
- **Context:** "Opening soon" needs a signal before a business's first health inspection. The candidates were WSLCB licence notices, building permits (Seattle, MyBuildingPermit.com, other city portals, King County Accela) and Public Health food plan review. King County is 39 cities; two-thirds of our live openings are outside Seattle. Full research: `docs/research/2026-11-19-opening-soon-sources.md`.
- **Decision (owner):**
  - Use the WSLCB Local Authority Letters dataset (data.wa.gov `vgcw-qfjm`): statewide, daily and machine-readable.
  - Start landing a daily snapshot now, because it is a rolling window with no history. Profile it after about two weeks, before building models or UI.
  - Not used:
    - Building permits: Seattle-only open data; elsewhere a patchwork of portals without data feeds.
    - Plan review: not published. A records request is manual and periodic; scraping is fragile and likely against the portal's terms.
- **Consequences:** Opening soon covers only businesses applying for alcohol, and is labelled with its source. Non-alcohol places still appear in "Just opened" at their first inspection. Revisit if King County publishes plan-review data.

## 2026-11-19 — Only the daily job deploys production
- **Context:** Vercel's git integration built production on every merge to `main`, from the repo alone, so it could only ever show the sample. SAN-41 adds the daily job that builds with the real export.
- **Decision:** `app/vercel.json` turns off git deploys for `main`; PR previews stay. Production deploys only from `daily.yml` (`vercel build` with `REQUIRE_EXPORT=1`, then `deploy --prebuilt --prod`). After the build, the job checks that the `/api/ask` bundle contains the real `openings.json` and fails otherwise. The first dbt pass builds only up to `int_candidates`, because classifications don't exist until the classify step runs.
- **Consequences:** a merged change reaches the live site at the next daily run, or when the owner runs the workflow by hand. A failed step leaves yesterday's site live and GitHub emails the owner.

## 2026-11-18 — Click a place to see it on the map; floating layout from 1100px
- **Context:** after the redesign merged (#33), the owner couldn't tell which pin was which, and the pin popups were unreadable (light text on MapLibre's white default). The #33 review also found panels covering pins between 720 and 1099px and red-points pins that differed only by colour on the dark map.
- **Decision (owner):**
  - Place names in the top 3 and "All N places" are buttons that fly the map to the pin, open its popup and highlight pin and card. Clicking again or pressing Escape clears it.
  - Top-3 pins carry name labels; hovering a pin shows its name on desktop.
  - Popups are themed dark, with a visible close button.
  - The floating layout starts at 1100px: below that, the side panels leave no usable map in the middle, so the map-on-top layout is used instead. The camera pads around the panels.
  - Red-points pins get a light ring, shown in the legend too.
  - Below 1100px, "Tried it" shows a visible "Tried". The sample pill reads "Sample data · not today's list".
- **Consequences:** tablets and small laptops get the stacked layout. If the map fails, names fall back to plain text rather than buttons that do nothing.

## 2026-11-18 — Dark, map-first redesign from the owner's mockup
- **Context:** the MVP screens were deliberately plain while the logic was built. The owner wants the look of the UI mockup (SAN-42).
- **Decision:**
  - The page follows the mockup: a full-window dark map on desktop with floating panels over it, and on phones a map on top with a scrolling sheet below.
  - Dark ground, lime accent, Geist (self-hosted via `next/font`). OpenFreeMap `dark` style. Top-3 pins numbered to match the cards.
  - Presentation only: no ranking, data or cap logic changed.
  - Kept from the current app where the mockup differs: the precise legend labels, the visible food-truck list, and muted greys that pass WCAG AA (the mockup's footer grey didn't).
- **Consequences:** the "Sample data" pill is short for sighted visitors, with the full sentence for screen readers (lengthened the same day, see the click-to-focus entry). "Tried it" is a tick icon button with an accessible name and tooltip. The question bar (SAN-40b) goes in the header slot on desktop; its place on phones is still to decide.

## 2026-11-18 — The question bar sends at most 100 places per question
- **Context:** `/api/ask` sends the restaurant list to Haiku with every question. A real 180-day export could hold several hundred places, which is about 66k input tokens per question and roughly $1.40/day at the 200-question cap. That would use up the owner's prepaid $5 in a few days of heavy use.
- **Decision (owner):** send at most 100 places: the nearest once located, else the top-ranked, after removing tried places. The prompt says the list may be a subset.
- **Also decided:** a visitor can mint a new `kcne_visitor` cookie for a fresh 20 questions. That's accepted for a passcode-only friends app, because the 200/day global cap still bounds the total. The API key is checked before any question is counted, so a misconfigured deploy doesn't use up anyone's questions.
- **Consequences:** at Haiku 5.5's $0.10 / $0.50 per million input / output tokens, about $0.0017 per question and $0.35/day worst case (no SDK retries, so one counted question is at most one billed call). A question about a far-off or low-ranked place may get "not in the current list".

## 2026-11-18 — A collapsed "All N places" list returns under the map
- **Context:** SAN-38c dropped a full list as out of scope ("browse everything"). The SAN-39b review found keyboard and screen-reader users could reach only the top 3; every other place was a map pin.
- **Decision (owner):** add an "All N places" list under the map, collapsed by default, with rows rendered only when opened. Once located, fixed-location places nearest first (ties by rank), then food trucks and places without coordinates in rank order; without a location, rank order. Tried places tagged, not hidden.
- **Consequences:** every place is reachable without a pointer. With real data it may hold a few hundred rows, so it stays closed until asked for. Reverses the "no full list" call made in the SAN-38c review.

## 2026-11-18 — Map tiles from OpenFreeMap; every fixed-location opening is pinned
- **Context:** the plan's default MapLibre demo style shows only country outlines, and openstreetmap.org's own tile servers forbid app traffic under their usage policy (open question in ARCHITECTURE §9).
- **Decision:**
  - OpenFreeMap's `liberty` style: free OpenStreetMap tiles, no account or key, attribution kept visible. `NEXT_PUBLIC_MAP_STYLE_URL` can swap providers without code changes.
  - Every opening with a fixed location is pinned, including places marked "Tried it" (owner request), so visitors can pan around and see what's near them. The top 3 are highlighted with larger, outlined pins drawn on top.
  - `maplibre-gl` is pinned to an exact release at least two weeks old.
- **Consequences:** no map cost and no key to manage. If OpenFreeMap is unavailable, the page shows "Map unavailable" and the lists still work.

## 2026-11-18 — Personal top 3 in the browser: 2-mile "near you", in-place undo
- **Context:** SAN-39a adds location and "Tried it". The spec gave the formula but not the radius, which headline number "near you" replaces, or how a tried mark is undone.
- **Decision:**
  - "Near you" means fixed-location places within 2 miles; once located it replaces the "last 7 days" number, so the strip keeps three numbers (owner default).
  - The 8 s location timeout starts after the visitor allows location, so a slow tap on "Allow" isn't treated as a failure.
  - The place just marked "Tried it" stays visible so it can be undone; earlier marks are hidden from the top 3; a "N hidden as tried · Clear" line under the top 3 resets them all (owner OK'd, SAN-39a follow-up).
- **Consequences:** `/api/ask` (SAN-40) should reuse `NEAR_RADIUS_MI` for "near me".

## 2026-11-18 — Daily deploys never fall back to sample data; trucks rank last near you
- **Context:** `app/lib/data.ts` falls back to the labelled sample when no export is present, so a production build without the pipeline would replace real data with the labelled sample. Separately, with a location known, the personal top 3 had to place food trucks, which have no fixed spot.
- **Decision (owner OK'd):**
  - With `REQUIRE_EXPORT=1`, set by the daily job, a missing export fails the build. A failed build leaves the last good deploy live and GitHub emails the owner. A flag rather than `VERCEL_ENV`, because Vercel's git integration builds production on every merge until SAN-41 turns that off, and those builds should keep showing the labelled sample.
  - With a location known, trucks and places without coordinates rank after every mappable place.
- **Consequences:** local and preview builds keep the sample. SAN-41's `daily.yml` must set `REQUIRE_EXPORT: "1"` in the job env, not as a Vercel env var (`vercel pull` would bring it into every build); the CI app build leaves it unset.

## 2026-11-18 — Passcode gate uses Next.js 16 `proxy.ts` and `SESSION_SECRET`
- **Context:** `create-next-app` now installs Next.js 16, which deprecates `middleware.ts` in favour of `proxy.ts`. The plan named the cookie-signing key `AUTH_SECRET`; the SAN-38a build used `SESSION_SECRET`.
- **Decision (owner OK'd):**
  - The gate lives in `app/proxy.ts`; signing uses Web Crypto only, so it works in any runtime.
  - The env var is `SESSION_SECRET`: it says exactly what it signs (the `kcne_session` cookie), and nothing was deployed under the old name, so the rename costs nothing.
  - Unlimited passcode attempts are accepted; a long passcode is the mitigation.
  - Changing `APP_PASSCODE` does not log anyone out; rotating `SESSION_SECRET` does.
  - `kcne_visitor` (the per-visitor cap id) lasts 1 year.
- **Consequences:** the owner sets `SESSION_SECRET` (`openssl rand -base64 32`) and a long `APP_PASSCODE` in Vercel. Revisit attempt limits if the site is ever shared beyond friends.

## 2026-11-17 — Keep places with a failed first inspection
- **Context:** the plan dropped candidates whose first inspection was "Unsatisfactory". Real data shows that is about 1 in 4 first routine inspections, and the "any to be wary of?" question needs those places.
- **Decision:** keep them; the safety part of the score ranks them lower. Exclude only places closed by their latest inspection.
- **Consequences:** more openings shown; "wary" answers can cite real records.

## 2026-11-17 — One evergreen architecture doc
- **Context:** `docs/PROJECT_SPEC.md`, the MVP design doc, the plan and `CLAUDE.md` all described the system, and disagreed after the MVP redesign. An engineer had to guess which was current.
- **Decision:** `ARCHITECTURE.md` (repo root) is the single current description and what code is reviewed against. `docs/PROJECT_SPEC.md` is deleted (in git history); its still-valid data rules moved into `ARCHITECTURE.md`. `docs/superpowers/` is frozen history. `CLAUDE.md` holds working rules only and points to the rest.
- **Consequences:** a PR that changes described behaviour must update `ARCHITECTURE.md` and add an entry here.

## 2026-11-16 — Lean MVP replaces the AWS/Snowflake design
- **Context:** a week produced ~3,500 lines of never-applied infrastructure and nothing a user could see. The owner wants an MVP before scale, for a private audience (owner + a few friends).
- **Decision:** one daily GitHub Actions job (extract → geocode → dbt on DuckDB → Claude Haiku classification → export → Vercel deploy). "Just opened" only. Rules first, Claude Haiku for grey-area classification with a confidence score (threshold 0.8) and an overrides seed. `restaurant_id` = KC `business_id`. Next.js on Vercel behind a shared passcode, with a live question bar capped at 200 questions/day globally and 20 per visitor. Terraform shrinks to the S3 bucket and a GitHub OIDC role. Design: `docs/superpowers/specs/2026-11-16-mvp-redesign-design.md`.
- **Consequences:** supersedes every entry below about Step Functions/Lambda/EventBridge, Snowflake (stack, budget, environments, JSON exports via `COPY INTO`), the persisted ID map, the two lists, press buzz, the area filter, "no live AI", milestones and the agent-loop exception. Opening soon, press, ratings and survival analysis become later scope. Cuisine returns only as Claude's labelled "likely" guess.

## 2026-11-12 — Auto-merge small, non-breaking PRs
- **Context:** the owner is often away from the terminal; waiting for a manual merge on small, safe PRs slows the loop.
- **Decision:** Claude may merge its own PR without asking when it is under 200 changed lines, contains no breaking change (as defined in `CLAUDE.md`, "Pull requests and auto-merge") and all required checks pass. Everything else waits for the owner.
- **Consequences:** faster iteration on small changes; spec, scoring, ID-map, guardrail, IAM/cost and destructive infra changes always get a human review. Claude reports every auto-merge.

## 2026-11-12 — KC: current dataset only in milestone 1; legacy deferred
- **Context:** profiling found the legacy dataset (`f29f-zza5`) is private (HTTP 403) and not in the catalog. The current dataset starts January 2021, which is enough history to tell a genuine first inspection from an older business.
- **Decision:** milestone 1 uses only the current dataset. Request the legacy export from Public Health – Seattle & King County for the milestone 6 survival analysis.
- **Consequences:** no legacy union or dedupe in v1; the 2021–2025 overlap problem disappears. If the export never arrives, the survival analysis covers 2021 onward only.

## 2026-11-12 — KC: daily full pull instead of incremental
- **Context:** Socrata `:updated_at` holds one value for all 111,644 rows, so it cannot drive incremental pulls. The dataset is about 3 pages.
- **Decision:** the KC extractor pulls the full dataset every run; dbt dedupes on key.
- **Consequences:** corrections and deletions are always captured; S3 grows by one full copy (a few MB compressed) per day, managed by lifecycle rules. Supersedes the `:updated_at` incremental default for KC.

## 2026-11-12 — Map coordinates from the US Census Geocoder
- **Context:** the current KC dataset has no lat/long, but the v1 app has a map.
- **Decision:** a geocode step in the Step Functions workflow sends only not-yet-geocoded addresses to the free Census batch geocoder and lands results in S3 raw; `int_address_geocodes` joins them in.
- **Consequences:** new source card and staging model; unmatched addresses and food trucks get no pin. Output is public domain, so storing it is fine.

## 2026-11-12 — Exclude stadium, arena and airport-terminal vendors
- **Context:** profiling found large multi-tenant venue addresses (e.g. about 60 units at Lumen Field, SeaTac airport) that diners cannot simply walk into.
- **Decision:** exclude them via `seeds/venue_exclusions.csv` (by address). Food halls and malls stay in as `food_hall_stall`.
- **Consequences:** one more seed to maintain; fewer false "openings" from seasonal concession permits.

## 2026-11-12 — Area filter instead of ZIP filter *(superseded 2026-11-16)*
- **Context:** a few hundred openings across about 100 King County ZIPs leaves many ZIPs with 0–2 places per list.
- **Decision:** filter by about 15–25 areas (neighborhoods or city groups) from `seeds/zip_to_area.csv` via `dim_zip`. `rank_in_area` replaces `rank_in_zip`. ZIP still shows on cards.
- **Consequences:** lists stay populated when filtered; one more seed to maintain. Food trucks stay out of area rankings.

## 2026-11-12 — Press buzz: name matching with a review queue *(superseded 2026-11-16)*
- **Context:** headlines rarely carry an address, so press-to-restaurant matching is its own fuzzy problem.
- **Decision:** `int_press_mentions` matches distinctive restaurant names in headlines (rules in `seeds/press_match_rules.csv`); low-confidence hits go to a review queue decided in `seeds/press_mention_overrides.csv`. Only accepted matches count toward buzz.
- **Consequences:** buzz stays a small, auditable weight; generic names (e.g. "Pho House") may get no buzz, which is acceptable.

## 2026-11-12 — Lighter agent loop in milestone 1 *(superseded 2026-11-16)*
- **Context:** the full six-step, eight-agent loop is heavy for the thin slice.
- **Decision:** milestone 1 uses profile → build → data-qa; the full loop (adding spec-reviewer and docs-writer) applies from milestone 2.
- **Consequences:** faster thin slice; spec drift in milestone 1 is caught by the first full review in milestone 2.

## 2026-11-12 — Persisted restaurant ID map *(superseded 2026-11-16)*
- **Context:** "anchor on the first key observed" is order-dependent; dbt full refreshes and backfills could reassign IDs, and there was no rule for merges or splits.
- **Decision:** `int_restaurant_id_map` is an append-only incremental model with `full_refresh: false`. On a merge the oldest ID survives and the other becomes an alias (`merged_into_id`); splits only via `seeds/entity_overrides.csv`.
- **Consequences:** IDs and detail-page URLs never change. The map is state that must be protected; recovery path is re-seeding from the latest JSON export.

## 2026-11-12 — Step Functions + repository_dispatch; Snowpipe dropped *(superseded 2026-11-16)*
- **Context:** separate schedules for extract, Snowpipe and dbt could race (dbt on a half-loaded day), and GitHub disables scheduled workflows after 60 days without repo activity.
- **Decision:** EventBridge Scheduler starts a Step Functions workflow that runs the extract Lambdas, then triggers the GitHub dbt workflow via `repository_dispatch`. The workflow loads RAW with `COPY INTO` before `dbt build`. Snowpipe is not used.
- **Consequences:** explicit step ordering and failure handling; no GitHub cron to expire. One fewer Snowflake object type; loading uses the warehouse wake the job already pays for. Supersedes "loaded by Snowpipe" in the S3 entry below.

## 2026-11-12 — Terraform from milestone 1 *(superseded 2026-11-16)*
- **Context:** building milestones 1–3 by hand meant importing or rebuilding resources in milestone 4.
- **Decision:** every resource is Terraform from milestone 1, including the resource monitor and Budgets alert.
- **Consequences:** slower start; no rework later, and cost guardrails exist before the first scheduled run.

## 2026-11-12 — Snowflake budget cap about $10/month *(superseded 2026-11-16)*
- **Context:** the Snowflake trial ends after about 30 days; after that the daily build, CI and storage are a small real cost.
- **Decision:** resource monitor with a hard monthly credit quota equal to about $10 at the account's credit price; notify at 75%, suspend at 100%.
- **Consequences:** a runaway job or heavy CI month pauses the pipeline instead of spending more; the static site keeps serving the last good build.

## 2026-11-12 — Environments, CI state and incremental pulls (defaults) *(superseded 2026-11-16)*
- **Context:** CI with `state:modified` needs a stored prod manifest; dev and CI need isolated schemas; date-based lookbacks miss corrections to old records.
- **Decision:** targets `prod`, `dev` (per-developer schema prefix) and `ci` (per-PR prefix, dropped on close); prod `manifest.json` stored at `s3://<bucket>/dbt-artifacts/prod/` and used with `--defer --state`. Incremental pulls filter on Socrata `:updated_at` with a 14-day lookback, plus a weekly full pull to catch deletions. LCB is pulled in full daily if size allows.
- **Consequences:** CI builds only changed models; S3 holds enough history to rebuild LCB status changes from raw.

## 2026-11-12 — What counts as a restaurant and an opening
- **Context:** KC inspections cover every food business (grocery, schools, caterers, events), and both KC and LCB data record ownership changes that look like openings. Without explicit rules the lists would fill with false openings.
- **Decision:** include four categories: `restaurant`, `cafe_bakery_dessert`, `food_hall_stall`, `food_truck`; exclude the rest. Classify each opening as `new_opening`, `new_concept` (different business at a recently occupied address, shown as "replaces X") or `ownership_transfer` (same address, similar name; excluded). Mapping rules, the 12-month window and the name-similarity threshold live in seeds, filled from profiling.
- **Consequences:** new models `int_lcb_notices_classified` and `int_opening_events`. Food trucks appear county-wide with a badge, with no map pin and no ZIP ranking, because their recorded address is usually not where they serve. Multi-tenant addresses require a strong name match.

## 2026-11-12 — History backfill moves to milestone 1 *(superseded 2026-11-16)*
- **Context:** "Just opened" depends on identifying a business's first-ever inspection, which incremental pulls with a 14-day lookback cannot do.
- **Decision:** milestone 1 loads the legacy CSV and one full pull of the current dataset before switching to incremental.
- **Consequences:** milestone 1 grows; milestone 4 no longer carries the backfill job.

## 2026-11-12 — Two separate lists: Just opened and Opening soon *(superseded 2026-11-16)*
- **Context:** in one combined ranking, LCB-only places could never compete: freshness decayed from the filing date (months before opening) and safety had no value before a first inspection.
- **Decision:** `mart_new_openings` carries a `list` column (`just_opened` | `opening_soon`); each list is scored and ranked separately with its own weights in `seeds/score_weights.csv`. The `stage` component is removed (it is constant within a list). Safety applies only to Just opened. A place moves lists on its first inspection and keeps its `restaurant_id`.
- **Consequences:** scores are comparable only within a list; the app shows two top-5 lists; `rank_in_list` and `rank_in_zip` (within list) replace `rank_overall`.

## 2026-11-12 — Framing: "newest openings, ranked by transparent signals"
- **Context:** there is no ground truth for "worth trying", and the planned survival backtest would validate a different model (no press or LCB history) against an outcome (survival) that is not "worth trying".
- **Decision:** present the ranking as the newest openings ordered by visible signals. Weights are set by judgment and documented; no weight tuning or score backtest.
- **Consequences:** milestone 6 survival analysis remains, as a standalone descriptive study, not score validation.

## 2026-11-12 — Seattle business licenses dropped from v1 *(revisit later)*
- **Context:** the dataset covers only the City of Seattle, so its "+ business license" signal was unreachable for the rest of King County and would bias a county-wide ranking toward Seattle. Licenses are also often filed at a mailing address. Its main use was UBI matching to LCB, which does not reach the inspection data.
- **Decision:** remove the source, `stg_seattle__business_licenses`, its snapshot and the `ubi_exact` match method from v1.
- **Consequences:** entity resolution between LCB and inspections relies on fuzzy name + address plus manual overrides. Revisit if a county-wide license source appears, or as a Seattle-only confidence boost for matching (not for scoring).

## 2026-11-12 — Cuisine removed from v1 *(superseded 2026-11-16)*
- **Context:** no source has a cuisine field; the inspection "description" is a seating/risk category, and name keywords are unreliable.
- **Decision:** no cuisine column in marts or UI in v1.
- **Consequences:** cards show name, neighborhood + ZIP, score and signals. Could return with Google Places (milestone 5) only within its terms.

## 2026-11-12 — App builds from JSON exports in S3, not from Snowflake *(superseded 2026-11-16)*
- **Context:** reading Snowflake from the Vercel build put warehouse credentials in Vercel, tied every app build (including local and v0 development) to warehouse access, and made builds non-reproducible.
- **Decision:** after a passing `dbt build`, GitHub Actions unloads the app's marts to JSON with Snowflake `COPY INTO` an S3 stage: `exports/dt=YYYY-MM-DD/<run_id>/` (kept) and `exports/latest/` (with `manifest.json`), then calls the Vercel deploy hook. The Vercel build reads `exports/latest/` with a read-only IAM key scoped to that prefix. Local and v0 development use checked-in, labelled sample JSON.
- **Consequences:** no Snowflake service user for the app; Snowflake's storage integration may write only under `exports/` (`raw/` stays immutable); every published build can be traced to a dated export. Supersedes the build-time Snowflake read in the entry below.

## 2026-11-12 — Next.js (v0) on Vercel, reading Snowflake at build time *(superseded 2026-11-16)*
- **Context:** the app should practice prompt-built React apps (Lovable/Vercel). A Supabase/Postgres copy of the marts only to serve a webpage was unnecessary. DuckDB was considered and rejected in favor of keeping Snowflake for the modern-data-stack story.
- **Decision:** keep S3 → Snowpipe → Snowflake → dbt. The UI is generated with v0 as a Next.js app on Vercel. Server code reads `MARTS` with a read-only service user (key-pair auth) at build time; a Vercel deploy hook triggers the rebuild after a passing `dbt build`.
- **Consequences:** no serving database and no per-visitor warehouse queries; about one warehouse wake per day. Supersedes the Evidence decision below.

## 2026-11-06 — No live AI agent in the public app *(superseded 2026-11-16)*
- **Context:** per-question LLM calls plus warehouse wake-ups scale cost with traffic.
- **Decision:** the public app is static; no AI Q&A. Agents are used to *build* the project.
- **Consequences:** dbt semantic layer (MetricFlow) is optional; metric definitions are documented in model YAML and the spec.

## 2026-11-06 — Evidence (static) for the app *(superseded 2026-11-12)*
- **Context:** need a usable, interactive app without web development or per-visitor cost. Lightdash public embedding requires its paid cloud.
- **Decision:** Evidence open source, built in GitHub Actions, hosted statically.
- **Consequences:** data shipped to the browser must be lean; only `mart_new_openings` (and small dims) are exposed.

## 2026-11-06 — Land raw data in S3 before Snowflake
- **Context:** source portals overwrite records and have changed dataset IDs.
- **Decision:** immutable dated raw files in S3, loaded by Snowpipe *(loading changed 2026-11-12 to `COPY INTO` in the pipeline job)*.
- **Consequences:** full replayability and warehouse portability; one more layer to manage.

## 2026-11-06 — AWS + Snowflake + dbt Core + Terraform; no Airflow in v1 *(superseded 2026-11-16)*
- **Context:** job postings reference the modern data stack; cost must stay near zero.
- **Decision:** EventBridge + Lambda for extraction, GitHub Actions to run dbt, Terraform for infra. Optional local Dagster demo later.

## 2026-11-06 — Google Places stores only place_id
- **Context:** Google terms prohibit caching Places content and building place databases. Yelp's API is no longer free.
- **Decision:** ratings deferred to milestone 5, fetched at build time, only `place_id` stored.

## 2026-11-06 — Differentiate from existing inspection maps
- **Context:** food.snoking.app already maps inspection ratings for King + Snohomish.
- **Decision:** focus on early opening detection, a multi-signal score, survival analysis and visible engineering.
