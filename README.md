# Crew Shoot Status

Per-shoot public status pages for Fame clients. One URL per shoot, branded, calm,
auto-updated when a card moves on the Trello "Crew Delivery" board.

- Production: `shoots.fame.so/[slug]`
- Stack: Next.js 15 (App Router) on Vercel, KV for per-shoot state
- Trello webhook drives state; clients never log in

## Local dev

```bash
pnpm install
pnpm dev
```

Then open http://localhost:3000/shoots/demo for the static design demo
(M0 — no Trello plumbing yet).

## Milestones

- **M0** — Visual scaffold. Static `/shoots/demo` page, brand tokens locked, no plumbing. *(in progress)*
- **M1** — Trello webhook + KV upsert + backfill script.
- **M2** — `/shoots/[slug]` reads from KV; status mapping; graceful hiding.
- **M3** — Attachment auto-discovery (brief / quote / final assets), reusing Crew Scout's logic.
- **M4** — Slug generation on first sync, page lifecycle from "Won", crew reveal, on-hold copy.
- **M5** — DNS cutover to `shoots.fame.so`, end-to-end on a real shoot.
