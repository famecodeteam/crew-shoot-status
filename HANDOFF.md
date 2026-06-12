# Brief Pages — Session Handoff

Context carry-over from the build session. Paste this into a fresh Claude
Code session started **inside `crew-shoot-status`** to continue brief-pages
work with full context. Delete the file once consumed, or commit it if you
want it kept.

## What it is

Doc-synced brief pages at `shoots.fame.so/brief/[slug]`. A producer edits a
Google Doc; the page mirrors it and refreshes every 5 minutes via a Vercel
cron. Replaced the old "link to a Google Doc" brief on the status page.

## Status — shipped & live

All work is on `main` (PRs #1–19, all merged, 0 open). Live in production.
Phases 1–5 were the original build; #6–19 were polish + fixes from review.

## Architecture

- **Storage** — `lib/brief-storage*.ts`. A `briefs:store` collection in
  Upstash (file fallback in dev), keyed by short slug (`0219-demand-ai`).
  `BriefRecord` type is in `lib/types.ts`.
- **Sync** — `app/api/sync-briefs/route.ts`, Vercel cron every 5 min
  (`vercel.json`). Fetch Doc → SHA-256 the structural response → skip if
  unchanged → parse → upsert. Time-boxed at 55s, oldest-first.
- **Parser** — `lib/parse-brief.ts` + `lib/doc-walker.ts`. Walks the Docs
  API response into a typed `ParsedBrief` (discriminated-union sections).
- **Page** — `app/brief/[slug]/page.tsx` + `sections.tsx` + `brief.css`.
  SSR, shoot-code modal gate, per-section components.
- **Status-page link** — `app/[slug]/page.tsx` renders the brief link card.

## Endpoints (all take `Authorization: Bearer <CRON_SECRET>`)

- `GET  /api/sync-briefs` — cron; syncs every registered brief.
- `POST /api/sync-briefs/<slug>` — sync one (hash-skips if Doc unchanged).
- `POST /api/sync-briefs/<slug>?force=1` — force a full re-parse of one.
- `POST /api/backfill-briefs` — register + force re-parse every shoot's
  brief. Run after any parser change.

`CRON_SECRET` is in the Vercel env (Production + Preview) — get the value
from there, it is intentionally not in this file.

## Spec deviations (all confirmed during the build)

1. **Auth** — reused the existing Google service account with an added
   `documents.readonly` scope, not an OAuth refresh token. No new env vars.
2. **Brief-Doc detection** — hooks off the existing `findShootDriveLinks`
   Drive scan, not Trello card attachments.
3. **Access gate** — HttpOnly cookie + SSR validation (lifted from the
   Video Review Tool), not `localStorage`. Content never enters the HTML
   until the code is validated.

## Operational facts

- Vercel must be on **Pro** — Hobby caps crons at once-per-day; the 5-min
  cadence needs Pro.
- `GOOGLE_SERVICE_ACCOUNT_JSON` already set in Vercel env (shared SA).
- Deploys: `vercel deploy --prod` from the repo root.

## Known issues / follow-ups

- **~16 of 45 briefs flagged `suspicious`** by the parseHealth canary —
  producer template drift (section headers not styled as Heading 3, or
  renamed). Fix is producer-side, not code. Pull the list:
  `curl -s -X POST .../api/backfill-briefs -H 'Authorization: Bearer <secret>' | jq '.summary.syncs[] | select(.health.suspicious)'`
- **parseHealth** — every sync result carries
  `health: { sections, overviewFields, crewMembers, proseFallback, suspicious }`.
  Suspicious parses also `console.warn` (filterable in Vercel logs).
- **Access-code mismatch** — *resolved (2026-05-20).* The brief unlock code
  was the 8-hex shoot-slug hash, and a few Docs carried a different hash in
  the body. Fixed by making the access code the **4-digit shoot number**
  (`briefAccessCode` in `lib/brief-slug.ts`), derived from the brief slug at
  request time — so a stale hash in a Doc body no longer affects access.
  Applies to all three checkpoints: the status-page `?code=` one-tap link,
  the brief page's `?code=` match, and the `/api/brief/<slug>/unlock` API.

## Producer template guidance (reduces drift)

- `Heading 3` style **only** on the 6 numbered section headers
  (`1. Project Overview`, `2. Shoot Objectives & Style`, …).
- Field rows are plain text or bold — never heading-styled.
- Keep section names matching the known set or they fall to the generic
  prose renderer.

## Parser tolerances already built in

- All-`HEADING_3` Docs — only numbered `HEADING_3`s split sections.
- `Label: value` rows — colon inside OR outside bold, plus a no-bold
  fallback (for heading-styled rows).
- Nested bullets preserved from the Docs API `nestingLevel`.
- `richLink` Drive embeds rendered as links (filename prettified).
- Free-form section 3 (no Confirmed Schedule / Equipment subheadings)
  routes to deliverables.
- "File Transfer Plan" hidden on Post-Production shoots (client-facing).
- The trailing "Shoot Status / Pre-Event Communications" section is
  replaced by a designed status-page CTA card.

## Verify

- `pnpm test` — fixture-driven parser unit tests (#0203/#0214/#0219).
- `pnpm typecheck && pnpm build`.
- `scripts/dump-brief-doc.ts <docId> <outPath>` — capture a new fixture.
