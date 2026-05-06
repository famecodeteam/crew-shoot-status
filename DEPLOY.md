# Deploy to Vercel + cut over to shoots.fame.so

This is the M5 runbook. Follow it once. Re-runs should be idempotent
(`vercel deploy --prod` is fine to run again, the webhook script de-dupes).

You'll need:
- A Fame Vercel team (or your personal account)
- Access to Fame's DNS provider (to add a CNAME for `shoots.fame.so`)
- Your local `.env.local` (we'll copy values into Vercel)

## 1. Link the project to Vercel

```bash
cd "/Users/tomhunt/Documents/Claude/Projects/Fame Operations/crew-shoot-status"
pnpm dlx vercel@latest login          # one-time, opens a browser
pnpm dlx vercel@latest link
```

Pick "Create new project" → name it `crew-shoot-status` → confirm scope (your Fame team).

This writes `.vercel/project.json` (gitignored) with the project + org IDs.

## 2. Provision Redis

In the Vercel dashboard:

1. Open the new `crew-shoot-status` project → **Storage** tab
2. Click **Create Database** → from the Marketplace section pick **Redis** (Serverless Redis from Redis Cloud)
3. Name it `crew-shoot-store`, region in EU
4. Click **Connect to Project** → tick `crew-shoot-status` → connect to Production + Preview + Development environments

That auto-injects `REDIS_URL` into the project's env vars. Our dispatcher in `lib/storage.ts` switches to Redis automatically when `REDIS_URL` is set.

## 3. Push the rest of the secrets

Still in the Vercel dashboard, **Settings → Environment Variables**. Add each below for **Production** and **Preview**:

| Key | Value source |
|---|---|
| `TRELLO_KEY` | from your `.env.local` |
| `TRELLO_TOKEN` | from your `.env.local` |
| `TRELLO_BOARD_ID` | `fMONysxJ` |
| `TRELLO_WEBHOOK_SECRET` | **generate a fresh random string** — `openssl rand -hex 32` and paste the output. Save the same value back to your local `.env.local` so the register-webhook script can use it. |
| `TRELLO_WEBHOOK_CALLBACK_URL` | leave blank for now — we'll fill this in after step 5 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | the **whole content** of `/Users/tomhunt/Downloads/fame-ham-dashboard-0b6f5c444b75.json` as a single string. Vercel handles multi-line values fine — paste as-is. |

Don't add `GOOGLE_APPLICATION_CREDENTIALS` (that's the local file-path version; production uses the inline JSON instead).

## 4. First deploy

```bash
pnpm dlx vercel@latest deploy --prod
```

When it finishes you'll get a `https://crew-shoot-status-xxxx.vercel.app` URL. Test it by visiting `/demo` — the static design page works without any data and confirms the deploy + Figtree font load OK.

## 5. Backfill the production KV

The KV is empty after first deploy. Push the local store's contents up by running the backfill against production env:

```bash
pnpm dlx vercel@latest env pull .env.production.local
pnpm tsx --env-file=.env.production.local scripts/backfill.ts
```

`vercel env pull` writes the KV connection strings + everything from step 3 into `.env.production.local` (also gitignored). The backfill then runs against KV instead of the local file.

After it finishes, hit `https://<your-vercel-url>/0189-flagright-...` to confirm a real shoot renders from KV.

## 6. Custom domain — `shoots.fame.so`

In Vercel: **Project → Settings → Domains** → add `shoots.fame.so`.

Vercel will tell you the CNAME target (usually `cname.vercel-dns.com`). In Fame's DNS panel:

- **Type:** CNAME
- **Name:** `shoots`
- **Value:** whatever Vercel gave you
- **TTL:** default

Wait a few minutes for propagation, then `https://shoots.fame.so/demo` should work and Vercel will auto-issue a TLS cert.

## 7. Set the webhook callback URL + register the webhook

Now that the public URL is live:

1. In the Vercel env settings, set `TRELLO_WEBHOOK_CALLBACK_URL` to:
   ```
   https://shoots.fame.so/api/trello-webhook
   ```
   for both Production and Preview. **Redeploy** so the env var is in the live build (Settings → Deployments → ⋯ → Redeploy on the latest deployment).

2. Locally, set the same value in `.env.local` so the register script knows where to point:
   ```
   TRELLO_WEBHOOK_CALLBACK_URL=https://shoots.fame.so/api/trello-webhook
   ```

3. Register the webhook:
   ```bash
   pnpm register-webhook
   ```
   The script:
   - Lists existing webhooks for our Trello token
   - If one already points at this exact callback URL + board, re-actives it
   - Otherwise creates a new one
   - Trello immediately HEADs the URL to verify; our `/api/trello-webhook` returns 200 on HEAD

4. Sanity check:
   ```bash
   pnpm register-webhook --list
   ```

## 8. End-to-end smoke test

1. Open one of your real shoot pages (e.g. `https://shoots.fame.so/0189-flagright-...`).
2. In Trello, move that card to a different list — e.g. Crew Booked → Ready For Shoot.
3. Refresh the page within ~60s. The status badge should reflect the new list.
4. In Vercel **Functions** tab, look at `/api/trello-webhook` — there should be a 200 invocation right around the time you moved the card.

You're live. 🎉

## Maintenance

- **Backfill drift.** If you ever suspect KV is out of sync (webhook missed something, manual edits, etc.), re-run step 5 — it's idempotent.
- **Webhook deactivated.** Trello auto-deactivates webhooks after several consecutive non-200 responses. Re-run `pnpm register-webhook` to re-activate.
- **Adding fields.** New Trello custom fields are picked up automatically by the next backfill / webhook event — no code change needed unless the field maps to a new page section.
- **Rotating Trello creds.** Update both `.env.local` and the Vercel env vars; redeploy.
