# Crew Shoot Status

Per-shoot public status pages for Fame clients. One URL per shoot, branded, calm,
auto-updated when a card moves on the Trello "Crew Delivery" board.

- Production: `shoots.fame.so/[slug]`
- Stack: Next.js 15 (App Router) on Vercel, KV for per-shoot state
- Trello webhook drives state; clients never log in

## Local dev

```bash
pnpm install
cp .env.example .env.local   # then fill in TRELLO_KEY + TRELLO_TOKEN
pnpm dev
```

- `http://localhost:3000/demo` — static design demo (always works)
- `http://localhost:3000/<real-slug>` — live shoot from `.data/shoots.json`
  (run `pnpm backfill` first to populate it)

## Pulling shoots from Trello

```bash
pnpm backfill
```

Reads every card from the Crew Delivery board, transforms each into a Shoot
record, and writes to `.data/shoots.json`. Idempotent: existing slugs are
preserved on re-runs. Cards in non-publishable lists (e.g. Lead) and archived
cards are skipped.

The `/api/trello-webhook` route updates a single card on each Trello webhook —
register it once we have a public URL (M5).

## Milestones

- **M0** — Visual scaffold. Static `/demo` page, brand tokens locked, no plumbing. *(in progress)*
- **M1** — Trello webhook + KV upsert + backfill script.
- **M2** — `/[slug]` reads from KV; status mapping; graceful hiding.
- **M3** — Attachment auto-discovery (brief / quote / final assets), reusing Crew Scout's logic.
- **M4** — Slug generation on first sync, page lifecycle from "Won", crew reveal, on-hold copy.
- **M5** — Deploy to Vercel + KV + DNS cutover to `shoots.fame.so`. See [DEPLOY.md](./DEPLOY.md).
