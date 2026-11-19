# Source card: WSLCB Local Authority Letters

- **Owner / publisher:** Washington State Liquor and Cannabis Board (LCB), on data.wa.gov.
- **Access:** Socrata, `https://data.wa.gov/resource/vgcw-qfjm.json`, no auth. Landed daily
  by `run.py snapshot-lcb` to `raw/lcb_local_authority/dt=…/<run_id>.jsonl.gz` (from 2026-11-19).
- **License / terms:** public records. Rows include applicants' personal details (`contact`,
  `dayphone`, `applicants`, `designatedsignee`, `licenseename`, `mailaddress`). Keep them in
  the private raw bucket only. Staging drops them, except `licenseename` (usually a company,
  sometimes a person), which is kept for matching only and never exported (owner decision
  2026-11-19; test `no_licensee_name_in_marts`).
- **Refresh cadence observed:** updated daily (catalog `data_updated_at` 2026-11-19). Holds
  only the **latest posted batches**, not a fixed window (see Quirks).
- **Coverage:** statewide; ~14 rows on 2026-11-19, posted 2026-09-22 to 2026-11-18, application
  dates 2026-08-27 to 2026-11-14.
- **Profiled on:** 2026-11-19. Sample: the live window (14 rows, 7 King County) plus the LCB
  On Premise Licensees list of 2026-11-17 (3,631 King County licences) for historical volume.
  **Not yet profiled:** behaviour across days (needs about a week of snapshots; see Open questions).

## Grain
One row per **licence notice sent to a local authority**: one application event for one
licence at one location. Evidence: in the 2026-11-19 window, `license` + `l_a_type` +
`applicationdate` are unique (14 of 14), as are `license` and `ubi` alone. A licence can get
several notices over time (application, later added privileges), so the notice key includes
type and date; not yet observed in the data.

## Keys
| Candidate key | Unique? | Null rate | Notes |
|---|---|---|---|
| `license` + `l_a_type` + `applicationdate` | yes (14/14) | 0% | Proposed notice key; confirm across snapshots |
| `license` | yes in this window (14/14) | 0% | LCB licence number; expected to repeat over time (one licence, several notices) |
| `ubi` | yes in this window (14/14) | 0% | 16-digit UBI incl. location suffix; expected to repeat for multi-location owners |

## Columns that matter
| Column | Type | Null % | Distinct (window) | Example | Use |
|---|---|---|---|---|---|
| `tradename` | text | 0 | 14 | `DANTINI DELLO` | display name, matching |
| `l_a_type` | text | 0 | 3 | `NEW LICENSE APPLICATION`, `ASSUMPTION OF A LICENSE`, `CHANGE OF LOCATION` | which notices count |
| `privdesc01`…`privdesc07` | text | 01: 0; others mostly null | 11 (01) | `S/B/W RESTAURANT LOUNGE (+)`, `B/W RESTAURANT - BEER/WINE` | restaurant rule (any of the 7) |
| `streetaddress`, `city`, `zipcode` | text | 0 | — | `704 NW 65TH ST`, `SEATTLE`, `981175049` | geocode, matching |
| `countyname` | text | 0 | 5 | `KING` | filter |
| `ubi`, `license` | text | 0 | — | `6063191540010001`, `455695` | keys, matching hints |
| `applicationdate` | `YYYYMMDD` text | 0 | — | `20261104` | "applied on", ranking |
| `la_posted_date` | date text | 0 | — | `2026-11-18` | when the notice went out |
| `corrected_amended` | text | 100 (window) | 0 | — | watch: may mark re-issued notices |

## Entity-resolution fields
- **Name:** upper-case trade name (`TAURUS KARAOKE & LOUNGE`). KC inspections also use upper-case names, but trade names can differ from the name on the health permit.
- **Address:** clean street line with suite (`18230 E VALLEY HWY STE 136`), city, ZIP+4. Good for the Census geocoder.
- **UBI / licence number:** LCB-only; nothing in KC inspections to join on (as recorded on 2026-11-12). Matching is name + address.

## Quirks and traps
- **Not a fixed two-week window.** Every King County row in the window had `la_posted_date`
  2026-11-18, while statewide posted dates run back to 2026-09-22. The dataset seems to hold
  the most recent batches, so history exists only in our daily snapshots.
- **The restaurant licence type can sit in any `privdesc` column.** 67 Pizza: `privdesc01`
  `OFF PREMISES`, `privdesc02` `B/W RESTAURANT - BEER/WINE`. Rules must check all seven.
- **Assumptions are ownership changes** (`ASSUMPTION OF A LICENSE`, e.g. Tailgate Sports Bar &
  Grill, Auburn): not new places. Exclude them, as with KC ownership transfers.
- Mixed licence world: cannabis, tobacco, direct-shipment, specialty shops and growlers share
  the dataset. Filter by privilege.

## Volume (go/no-go)
From the On Premise Licensees list (2026-11-17), King County licences with a restaurant
privilege (`… REST …`), by **Business Startup Date** month:

| Months | Per month | Reading |
|---|---|---|
| 2024-11 to 2025-03 | 219–246 | **Artifact**: re-dated licences (likely an LCB system change). Ignored |
| 2025-04 to 2026-06 | 6–15 (typically 10–15) | Steady rate of new restaurant licences |
| 2026-07 to 2026-09 | 1–3 | Low because recent applicants are still pending, i.e. what Opening soon shows |

- **About 10–15 new restaurant licences a month (2–4 a week)** in King County. That matches the 2026-11-18 batch: 3 new restaurant applications (Dantini Dello, Seattle; Taurus Karaoke & Lounge, Kent; 67 Pizza, Kirkland).
- Survivorship: the list holds current licences, so closed businesses are missing and older months undercount slightly.
- "Just opened" sees about 40 openings a month, so LCB would flag roughly **a quarter to a third** of openings ahead of time.
- With applications pending one to three months, the list would hold **about 10–40 places**.

**Decision: go.** A modest list, but early information nothing else provides.

## Matching to KC inspections (QA, 2026-11-19)
Rules as in `int_lcb_match_pairs` (same ZIP + street number, KC first inspection no earlier than
30 days before the licence, Jaro-Winkler on cleaned names), run on the 69 King County
restaurant licences with a Business Startup Date in Jan–Jun 2026 (LCB On Premise list)
against KC businesses first inspected since 2025-11 (Socrata `r878-4sxa`):

| Result | Licences |
|---|---|
| match (score ≥ 0.85) | 33 (48%) |
| review (0.70–0.85) | 2 |
| only a different-name business at the address | 6 |
| no KC business at the address after the licence | 28 |

- **Lead time:** median **164 days** from licence to first KC inspection, so places stay in
  Opening soon for months. The drop-off cutoff should be about a year, not 120 days.
- **KC often records the company name**, not the trade name: HANA KATSU is "C AND R 2026, CORP",
  TAILWIND CAFE AT GOOD WEATHER is "Giri's Concepts LLC", BELMONT is "MIDNIGHT RUNWAY LLC" (same
  address, inspected 4–7 months after the licence). So matching also scores the LCB
  `licenseename` (owner decision: kept in staging for matching only, never exported). On the
  same 69 licences: trade name only 33 match / 2 review / 6 different-name-only; trade or
  licensee name **38 match (55%) / 1 review / 2 different-name-only**.

## Open questions (need a week or more of snapshots)
- Do notices leave the window on approval, after a fixed time, or with the next batch?
  This sets how long a place stays in Opening soon and the drop-off cutoff (SAN-47).
- Is `license` + `l_a_type` + `applicationdate` stable across days? What does `corrected_amended` do?
- Lead time from application to first KC inspection (needs matched pairs).

## Proposed staging model
`stg_lcb__notices`: one row per notice (`license`, `l_a_type`, `applicationdate`), across
all snapshots.
- Renames: `tradename` → `trade_name`, `l_a_type` → `notice_type`.
- Casts: `applicationdate` → date, `la_posted_date` → date, `zipcode` → `zip5`.
- Collect `privdesc01..07` into a list.
- Add `first_seen_on` and `last_seen_on` from the snapshot dates.
- Drop all personal fields.

Rules in seeds:
- `lcb_privilege_rules.csv`: privilege → restaurant yes/no.
- `lcb_notice_types.csv`: notice type → counts yes/no (new application and change of location yes; assumption no).

## Proposed tests
- `unique` + `not_null` on the notice key; `accepted_values` on `notice_type`.
- No personal columns exist in staging (a column-list test).
- `applicationdate` ≤ `la_posted_date`; `zip5` is 5 digits.
