# Opening soon: which early signals exist (research, 2026-11-19)

**Question:** "What restaurants are about to open near me in King County?" needs a signal that
appears *before* a business's first health inspection (our "just opened" signal). This note
records which sources exist, what was checked, and why only one is used. Decision:
`docs/decisions.md`, 2026-11-19 "Opening soon uses LCB licence notices only".

## Scale: King County is not Seattle

King County has 39 cities and towns plus unincorporated areas; Seattle is about a third of
its ~2.3M people. Our live export on 2026-11-19 had **238 openings: 79 in Seattle (33%), 159
(66%) in 34 other places** (Kent 18, Redmond 16, Tukwila 15, Issaquah 11, Burien 10,
Woodinville 9, Renton 9, Bellevue 9, …). A Seattle-only signal misses two-thirds of openings
and skews a county-wide ranking (the same reason Seattle business licences were dropped on
2026-11-12).

## Sources checked

| Source | What it is | Coverage | Machine-readable? | Verdict |
|---|---|---|---|---|
| **WSLCB Local Authority Letters** (data.wa.gov `vgcw-qfjm`) | Notices the Liquor and Cannabis Board must send a city/county when a business applies for a licence: trade name, UBI, address, privilege (e.g. "S/B/W RESTAURANT LOUNGE", "B/W RESTAURANT - BEER/WINE"), notice type (new application, assumption, change of location, added privilege), application date | Statewide, so all 39 KC cities equally | Yes: Socrata API, no key, updated daily | **Use.** Only businesses applying for alcohol |
| Seattle building permits (data.seattle.gov `76t5-zqzr`) | All SDCI permits, nightly | City of Seattle only (33% of openings) | Yes, but "restaurant build-out" is only in free-text descriptions | Not used: Seattle-only bias, needs text classification |
| MyBuildingPermit.com | Shared *application* portal for Auburn, Bellevue, Bothell, Burien, Federal Way, Issaquah, Kenmore, King County (unincorporated), Kirkland, Mercer Island, Sammamish, Snoqualmie, … | ~13 jurisdictions | No open data or API found; would need scraping | Not used: fragile, likely against its terms |
| Other city permit systems (Redmond, Renton, Kent, Tukwila, …) | Each city's own portal | One city each | Varies; each needs its own parser | Not used: a patchwork of portals to maintain |
| King County Accela permits (data.kingcounty.gov `76qh-9bwf`) | Unincorporated King County permits | Unincorporated only | Yes, but last modified 2021 | Not used: stale and partial |
| **Public Health food plan review** | Every new food business must get construction plans approved before building; initial review takes ~8–10 weeks | County-wide, food-specific (the ideal signal) | **No.** Not published; handled in the Public Health Permit Center | Not used: unavailable (see below) |
| KC open data food datasets (`r878-4sxa`, `sgr5-u9rw`, `j2pu-r4ru`) | Inspection results, repackaged | County-wide | Yes | Not a pre-opening signal: every business listed has ≥ 1 inspection (`j2pu-r4ru` min inspections = 1; also last updated 2024) |
| KC inspection types | Only Routine, Return, Educational | n/a | n/a | No pre-opening inspection type (`docs/source_cards/kc_inspections_current.md`) |

## Why not plan review via other routes

- **Public records request** to Public Health: manual, takes weeks, must be repeated to stay
  current. Useful for a one-off study (how far ahead of opening plan review runs), not for a
  daily list.
- **Scraping the Permit Center portal**: no API, fragile, likely against its terms, and it
  may expose applicants' personal details.

## What LCB looked like on first contact

On 2026-11-19 the dataset held **14 notices statewide, 7 in King County**, application dates
2026-10-31 to 2026-11-14. It is a **rolling window**, not history, so we must land a daily
snapshot to build history (our raw layer is write-once, so that fits). Of the 7 King County
notices: 5 new applications, 2 assumptions (ownership changes). By privilege, 2 restaurants
(S/B/W restaurant lounge; B/W restaurant); the rest were off-premises, specialty shop,
direct shipment or cannabis. `location_city` was null on these rows.

Open questions for profiling after ~2 weeks of snapshots: true weekly volume of King County
restaurant applications; whether notices drop out on approval; the stable key (UBI +
application date + notice type?); where the street address lives (`location`?).

## Consequences

- "Opening soon" covers businesses applying for alcohol: restaurants, bars and wine/beer cafés.
  It misses coffee shops, bakeries, many counter-service places and food trucks. Those still
  appear in "Just opened" at their first inspection.
- The list is labelled with its source ("from liquor licence applications") so nobody
  expects every upcoming opening.
- Revisit if King County publishes plan-review data, or for a one-off records request.

## Sources

- data.wa.gov: Washington State Liquor and Cannabis Board (LCB) Local Authority Letters, `vgcw-qfjm` (catalog: https://catalog.data.gov/dataset/washington-state-liquor-and-cannabis-board-lcb-local-authority-letters)
- LCB Frequently Requested Lists: https://lcb.wa.gov/records/frequently-requested-lists
- Seattle Building Permits: data.seattle.gov `76t5-zqzr`
- King County Accela Permitting Portal dataset: https://catalog.data.gov/dataset/permitting-accela-permitting-portal
- MyBuildingPermit.com participating jurisdictions: https://www.mybuildingpermit.com/node/35
- King County permitting reports: https://kingcounty.gov/en/dept/local-services/certificates-permits-licenses/permits/permits-inspections-codes-buildings-land-use/permit-forms-application-materials/reports
- KC permanent food plan review: https://cd.kingcounty.gov/en/dept/dph/certificates-permits-licenses/food-business-permits/permanent-food-plan-review
- KC open data catalog searched via the Socrata Discovery API (domain data.kingcounty.gov)
