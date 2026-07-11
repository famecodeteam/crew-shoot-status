# Crew Shoot Status - Instructions for Claude Code

Read this top to bottom before you touch anything. Several Claude Code
sessions work this repo in parallel (at time of writing: 14 local branches
plus 20+ `claude/*` branches on `origin`) - the rules below exist so one
session's work doesn't silently clobber another's, and so nothing reaches a
real client half-finished.

> ## ⚠️ UPDATE (fixed): `main` now auto-deploys to shoots.fame.so
>
> As of the date this line was added, the Vercel project is **Git-connected**
> (`famecodeteam/crew-shoot-status`, production branch `main`) - a push to
> `main` now builds and deploys automatically, the same as Team Portal. This
> reverses the "manual deploy only" warning that used to be here - if you're
> reading an old cached copy of this file that still says deploys are
> manual, trust this version and re-verify with
> `GET /v9/projects/crew-shoot-status` if in doubt.
>
> Consequence: **a push to `main` is live within minutes, with no review
> gate.** Prefer a feature branch + Vercel Preview URL for anything you
> can't explain in one sentence. `DEPLOY.md` in this repo still documents
> the old manual M5-cutover process - treat that file as historical, not
> current, until someone updates it.

---

## The repo at a glance

- **App:** per-shoot public status pages for Fame clients - one URL per
  shoot, branded, auto-updated when a card moves on the Trello "Crew
  Delivery" board. Clients never log in. Next.js 15 App Router, React 19,
  TypeScript, pnpm.
- **Production:** **https://shoots.fame.so** (also aliased at
  `crew-shoot-status.vercel.app`). Deployed manually - see banner above.
- **Storage:** no Postgres/Supabase in this repo. State lives in Redis - a
  Vercel-Marketplace Redis Cloud add-on (`REDIS_URL`) if provisioned, else
  Upstash KV REST (`UPSTASH_KV_REST_API_URL` / `UPSTASH_KV_REST_API_TOKEN`).
  `lib/storage.ts` dispatches between the two automatically depending on
  which env vars are set - check that file before assuming which backend is
  live in a given environment. Locally, `pnpm backfill` can instead populate
  a flat file at `.data/shoots.json` for dev without touching either Redis
  path.
- **Not connected to the shared Supabase project.** Team Portal and Client
  Portal share Supabase project `xttbrfynxdbcymzxysxf` (the `clients`
  table); this repo does not reference that project or Supabase at all - a
  schema change there does not affect this app, and vice versa.
- **Auth model:** there is no login of any kind, for anyone. Public
  `/[slug]` pages are unauthenticated - the slug itself is the access
  control (obscurity, not a real gate; don't assume a slug is secret in any
  strong sense). `/api/admin/*` and `/api/cron/*` routes are gated purely by
  bearer-token secrets checked in each route handler (`CRON_SECRET`,
  `ADMIN_RESYNC_TOKEN`, `ADMIN_SEND_SECRET`, `SYNC_API_SECRET`,
  `FEEDBACK_INGEST_SECRET`, `VIDEO_ORIGIN_SECRET`, `TRELLO_WEBHOOK_SECRET`).
  Unlike Team Portal / Client Portal, **there is no admin session to fall
  back to** - these endpoints are secret-only because no user-auth system
  exists here at all. If you add a new manually-triggered admin route,
  either give Tom a link that carries the token as a query param (only if
  the route already accepts one - check the existing pattern in
  `app/api/admin/*` first) or tell him the exact `curl` command; a bare
  "hit this URL" instruction won't work if the route expects a header.

---

## Branch and deploy hygiene - READ FIRST

### Before ANY commit, run these and report what you see

```bash
git branch --show-current
git fetch origin
git status --short               # unrelated dirty files? leave them alone
git log --oneline origin/main -5 # has main moved since you started?
```

If the working tree has files you didn't touch, don't stage them - use
`git add <specific-files>`, never `git add -A` or `git add .`.

### Two work patterns

**Pattern A - worktree off `main`** for small, single-file, self-contained
changes:

```bash
git fetch origin
git worktree add .claude/worktrees/<topic> origin/main
cd .claude/worktrees/<topic>
ln -s "$(pwd)/../../../node_modules" node_modules   # or pnpm install fresh
cp ../../../.env.local .env.local
# ... edit, typecheck, build, commit, push origin main (or open a PR) ...
```

**Pattern B - feature branch + PR** for anything multi-file, storage-shape
changing, or that touches auth/secret checks:

```bash
git fetch origin
git switch -c claude/<topic> origin/main
# ... commit as you go ...
git push -u origin claude/<topic>
```

### Branches pile up here - clean up after yourself

At time of writing there are 14 local branches and 20+ `claude/*` branches
on `origin` (a mix of merged and possibly-stale `feat/*`, `fix/*`, and
`claude/brief-*` work). Before starting new work, check whether an existing
branch already covers it (`git branch -a | grep <topic>`), and delete local
branches once their PR is merged:

```bash
git branch -d <branch>            # after merge
git push origin --delete <branch> # if you also own the remote copy
```

No `.claude/worktrees/` directory exists yet in this checkout - if you use
Pattern A and finish the work, remove the worktree rather than leaving it:

```bash
git worktree remove .claude/worktrees/<topic> --force
```

### Never

- **Never `vercel deploy --prod` from a feature branch or worktree
  checkout.** Only from a clean, up-to-date `main`.
- **Never force-push to `main`.**
- **Never `git reset --hard` or rewrite a branch/worktree you didn't
  create.** To undo something on `main`, use a forward `git revert`.
- **Never assume a merged PR is live.** Check the deploy banner above.

### Before you push, look at the actual diff

```bash
git fetch origin
git diff --stat origin/main..HEAD
git log --oneline origin/main..HEAD
```

Stop if you see files you don't recognise (someone else's WIP) or commits
you didn't author.

### After a manual deploy, verify + report

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://shoots.fame.so/<real-slug>
```

A real `/[slug]` page should be 200. Report back the deploy URL and a
**direct click-through link to the specific shoot/page you changed**, not
just the domain root.

---

## Environment & external systems

Env var names only - never values. See `.env.example` for the full
annotated list.

- **Trello** - `TRELLO_KEY`, `TRELLO_TOKEN`, `TRELLO_BOARD_ID` (Crew
  Delivery board, shortLink `fMONysxJ`). `TRELLO_WEBHOOK_SECRET` +
  `TRELLO_WEBHOOK_CALLBACK_URL` verify and register the webhook that drives
  card-state → page-state sync. Webhook signature validation
  short-circuits (with a warning) when the secret is unset in dev, but is
  required in production.
- **Google service account** - reuses the HAM Dashboard / Meeting Agenda
  Compiler key, same pattern as Team Portal and Client Portal.
  `GOOGLE_APPLICATION_CREDENTIALS` (local file path) or
  `GOOGLE_SERVICE_ACCOUNT_JSON` (inline, for CI/Vercel). Used to look up
  each shoot's Drive folder and pull the brief Doc / signed quote PDF.
- **Cloudflare Stream** - `CF_ACCOUNT_ID`, `CF_STREAM_TOKEN`,
  `CF_STREAM_CUSTOMER_CODE`. Finished review videos are ingested into
  Stream for adaptive HLS delivery; Drive stays the master copy (see
  `lib/stream.ts`).
- **Storage** - `REDIS_URL` (Vercel Marketplace Redis Cloud) or
  `UPSTASH_KV_REST_API_URL` / `UPSTASH_KV_REST_API_TOKEN` - see "The repo
  at a glance" above for how `lib/storage.ts` picks between them.
- **Postmark** - `POSTMARK_API_TOKEN`, plus `EMAIL_FROM_ADDRESS`,
  `EMAIL_FROM_NAME`, `EMAIL_REPLY_TO`, `EMAIL_BCC`, `EMAIL_DRYRUN_TO` -
  milestone emails to clients.
- **Slack** - `SLACK_FEEDBACK_WEBHOOK_URL` - alerts ops when
  `/api/admin/health` finds an unmapped Trello list with open cards in it,
  and (check `lib/` before assuming scope) potentially other operational
  alerts.
- **Secrets gating admin/cron/webhook routes** - `CRON_SECRET`,
  `ADMIN_RESYNC_TOKEN`, `ADMIN_SEND_SECRET`, `SYNC_API_SECRET`,
  `FEEDBACK_INGEST_SECRET`, `VIDEO_ORIGIN_SECRET`. Every Vercel env on this
  project is marked sensitive - values can't be read back
  (`vercel env pull` writes empty strings, `vercel env ls` lists names
  only). If a value must change, Tom sets it fresh in the Vercel dashboard
  and redeploys.
- **`PUBLIC_BASE_URL`** - `https://shoots.fame.so` in production, used to
  compose the URL written back to each Trello card's "Status Page URL"
  custom field and anywhere else a full link is rendered.
- **`MEMBER_API_BASE_URL`**, **`VIDEO_ORIGIN_BASE`**, **`CREW_FEED_URL`** -
  check the referencing file before assuming what these point at; not
  documented in `.env.example` at time of writing.

### Crons (`vercel.json`)

- `/api/sync-briefs` - every 5 min
- `/api/sync-stream` - every 5 min
- `/api/sync-shoots` - every 5 min
- `/api/cron/email-flush` - every 5 min
- `/api/admin/health` - daily 09:00 UTC (Trello list-mapping drift check,
  see the comment header in `app/api/admin/health/route.ts`)

All cron routes expect `Authorization: Bearer <CRON_SECRET>`; Vercel injects
that header automatically on cron-triggered calls.

---

## Conventions

- **Brand:** everything you build must follow the Fame brand guidelines -
  see [docs/brand-guidelines.md](docs/brand-guidelines.md). Tokens are
  already defined in `app/globals.css` `:root` (verified against Team
  Portal's and Client Portal's copies - keep all three in sync if the
  palette ever changes). Use `var(--token)`, never a raw off-palette hex.
  The brand has **no blue and no decorative red**; links/accents/chart
  series use `--pink` then `--periwinkle`. Font is Figtree.
- **Single hyphens, not em-dashes** - comments, copy, commit messages, PR
  bodies. `--` for CLI flags / CSS vars is fine.
- **Comments explain WHY, not WHAT.** This repo's existing comments (e.g.
  `app/api/admin/health/route.ts`) lead with the failure mode a piece of
  code guards against - match that style. Don't reference the current
  task/ticket - it rots. No `// removed:`-style comments; delete the code.
- **No backwards-compat shims** unless explicitly asked for.
- **Co-author trailer** on commits:
  `Co-Authored-By: Claude <model> <noreply@anthropic.com>`.

---

## When in doubt

- Read this file again, and check whether the deploy banner still matches
  reality - **if Vercel Git integration ever gets wired up for this repo,
  update this file's top banner immediately**, it would otherwise mislead
  every future session into thinking deploys are still manual.
- Look at the last 10 commits on `origin/main` for how recent changes were
  structured.
- Prefer Pattern B (feature branch + PR) for anything you can't explain in
  one sentence - a review is cheaper than clobbering a teammate's work.
- Ask Tom before anything destructive.
