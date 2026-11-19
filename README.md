# kc-new-restaurants

A private app that finds restaurants that just opened in King County, WA.

**Live site:** https://kc-new-restaurants.vercel.app (passcode required; ask the owner).

How it works: [`ARCHITECTURE.md`](ARCHITECTURE.md). Why: [`docs/decisions.md`](docs/decisions.md).

## How it runs

- **Every morning** (about 6–7 am Pacific) `.github/workflows/daily.yml` pulls King County
  inspections, finds new openings, has Claude Haiku classify the new ones, rebuilds the scores
  and deploys the site to Vercel. If any step fails, nothing deploys, yesterday's site stays
  up, and GitHub emails you.
- **Run it by hand:** GitHub → Actions → daily → Run workflow (optionally limit how many new
  candidates Claude classifies). Merged changes reach the live site on the next run.
- **Every PR** runs `ci.yml` (ingestion, dbt on sample data, app) and, for `infra/`,
  `terraform.yml`.
- **What's pending review:** `transform/analyses/pending_review.sql` lists candidates Claude
  wasn't sure about; `pending_review_count` in `metrics.json` counts them (not shown on the page).
- **Costs are capped:** questions are limited to 20 per visitor and 200 in total per day,
  checked before any Claude call (about $0.35/day at most). Classification is about a cent a
  day after the first run. Details: `ARCHITECTURE.md` §8.

Setup and how everything fits: `ARCHITECTURE.md`. Infra: `infra/README.md`. App: `app/README.md`.
