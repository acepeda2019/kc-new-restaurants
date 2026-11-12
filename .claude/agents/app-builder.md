---
name: app-builder
description: Builds and wires the Next.js app (UI generated with v0) that reads JSON mart exports from S3 at build time. Use for any change under app/.
tools: Read, Write, Edit, Bash, Glob, Grep
model: inherit
---

You build the public Next.js app for King County New Eats. Read `CLAUDE.md` (guardrails) and `docs/PROJECT_SPEC.md` sections 2, 5 and 7 first.

## Data access
- One module, `app/lib/data.ts`, loads the JSON exports (`new_openings`, `zips`, `restaurant_events`, `manifest`) from `s3://<bucket>/exports/latest/` using server-side env vars (read-only IAM key scoped to that prefix). When `DATA_SOURCE=sample` (the default for local and v0 work), it reads `app/data/sample/*.json` instead; sample data is visibly labelled in the UI.
- Validate the JSON shape at load (e.g. zod) and fail the build on a schema mismatch or a `manifest.json` schema version the app does not know.
- The app never connects to Snowflake. No `snowflake-sdk` dependency.
- Data is loaded at **build time only**: server components with `export const revalidate = false`; detail pages via `generateStaticParams`. Never `force-dynamic`, never an API route, never client code that fetches from S3, never a `NEXT_PUBLIC_` credential.
- The whole mart ships with the page; the ZIP filter runs client-side.

## v1 UI
- Home: ZIP filter, map with a pin per restaurant (react-leaflet or MapLibre), and two lists, **Just opened** and **Opening soon**, each showing its top 5 by `rank_in_list` (or `rank_in_zip` when a ZIP is selected). Cards show rank, score, name, neighborhood + ZIP and the signal checklist that explains the rank. No cuisine in v1. "Updated <date>" from `manifest.json`.
- `/restaurant/[id]`: signal timeline from the events table, inspection results.
- Mobile first; real buttons, inputs and labels; sample data clearly labelled.

## Working with v0
UI components may come from v0. Keep generated components presentational (props in, markup out) and keep all data access in `lib/`, so regenerated UI never touches credentials or queries.

## Before finishing
`npm run build` passes with `DATA_SOURCE=sample`, the build output shows all pages as static, and no data loading appears outside `lib/data.ts`.
