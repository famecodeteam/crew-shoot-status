# Cloudflare Stream integration - build summary & replication guide

How `crew-shoot-status` (shoots.fame.so) was moved from a slow Drive-proxy
video path to Cloudflare Stream. Written so the same can be added to the
main-service review tool (review.fame.so). Paste into a fresh Claude Code
session started in that repo.

## What it is / why

Review videos used to stream the raw original (a 641 MB 4K master, in one
case) through a serverless proxy - uncached, ~1-1.5s to first byte. They
now play from Cloudflare Stream: transcoded, adaptive HLS, CDN-cached -
**~70-100ms to first byte**, full clip buffered in seconds.

## The model

The original storage stays the **master**. Cloudflare Stream is a
**derived delivery copy**. An ingest cron copies each finished video into
Stream; the player plays Stream's HLS; the original-source proxy stays as
the **fallback** for any version not yet ingested - so there is never a
regression while a video transcodes.

## Cloudflare setup (one-time, human)

1. Create / use a Cloudflare account, enable **Stream**.
2. **Purchase storage.** Even the $0/month "Images & Stream" plan needs
   prepaid storage before *any* upload works - the API rejects uploads
   with `10011 Storage capacity exceeded` until you buy it. $5 = 1,000
   minutes stored (far more than a boutique agency needs).
3. Create an API token: **Account - Stream - Edit**.
4. Note the customer code from the playback domain
   `customer-<code>.cloudflarestream.com`.
5. Env vars: `CF_ACCOUNT_ID`, `CF_STREAM_TOKEN`, `CF_STREAM_CUSTOMER_CODE`.

## The code (crew-shoot-status reference - ports over almost as-is)

- **`lib/stream.ts`** - Stream API client: `copyFromUrl`, `getVideo`,
  `deleteVideo`, `listVideos`, `streamHlsUrl`. Reusable verbatim.
- **Data model** - add to the video-version type, all optional/additive:
  `streamUid?`, `streamStatus?: "pending" | "ready" | "error"`,
  `streamError?`.
- **Ingest** - `lib/sync-stream.ts` + `app/api/sync-stream/route.ts`
  (CRON_SECRET-gated, every 5 min in `vercel.json`). Each pass walks all
  versions: un-ingested -> `copyFromUrl` pointed at the existing
  video-source URL, mark `pending`; `pending` -> `getVideo` poll -> flip
  to `ready`/`error`. Non-blocking: `copyFromUrl` returns a uid instantly
  while Cloudflare downloads + transcodes async, so `pending -> ready`
  lands on a later tick. `scripts/run-stream-sync.ts` runs one pass
  manually.
- **Player** - `app/[slug]/asset/[asset]/review-shell.tsx`. hls.js, in
  this priority: `Hls.isSupported()` -> hls.js (MSE); else native HLS
  (Safari/iOS); else the original-source fallback. hls.js is
  dynamic-imported (code-split, never SSR-evaluated). Keep ONE persistent
  `<video>` element so comment/scrub/timestamp logic is untouched - only
  the source changes. Stream's auto thumbnail is the `<video>` poster.

## Gotchas (the expensive lessons)

- **copy-from-URL needs the source URL to answer HEAD or GET-range** so
  Cloudflare can size the file. The proxy must support `Range` and return
  `Content-Range: bytes .../<total>`. A source that doesn't -> error
  `10005 ... could not determine the size of the file`.
- **If ingesting via a serverless proxy, raise its `maxDuration`** -
  Cloudflare pulls the *whole* file through it. Even at 300s (Vercel Pro
  max), **multi-GB masters (~2-3 GB+) stall** - a serverless proxy can't
  reliably move that much. Fixes: web-optimised exports, or ingest big
  files straight from the storage origin (not via a proxy).
- **hls.js: check `Hls.isSupported()` BEFORE
  `canPlayType('application/vnd.apple.mpegurl')`.** Modern Chrome returns
  `"maybe"` for HLS - check `canPlayType` first and you wrongly take the
  native path; hls.js never runs.
- **Never run a manual sync while the cron is live.** Both do
  read-modify-write on the asset store -> lost-update race -> duplicate
  Stream ingests -> orphaned videos. `scripts/prune-stream-orphans.ts`
  cleans them (dry-run by default; refuses to delete if the referenced
  set is empty). The cron alone, single-instance, never races.
- **Stream bills by video DURATION, not file size** - a 641 MB 4K master
  and a 65 MB 1080p export of the same clip cost the same to host. So
  oversized uploads don't inflate the bill, they just slow ingest.

## Decisions taken

- **HLS + hls.js** (not the MP4 rendition) - adaptive, best playback UX.
- **Signed URLs deferred.** Videos are gated only by their unguessable
  Stream UID - same posture as the rest of the review system. Optional
  later hardening: set `requireSignedURLs` on `copyFromUrl` + mint signed
  tokens server-side.
- **Ingest = copy-from-URL** pointed at the existing video proxy -
  self-contained, no change to the upstream uploader.

## Cost

~$5-15/month at boutique-agency volume: $5 / 1,000 min stored, $1 / 1,000
min delivered, encoding free. Dominated by the small minimums, not usage.

## Build sequence (each shippable + verified before the next)

M1 Stream client - M2 ingest cron - M3 player swap - (M4 signed URLs,
optional) - M5 prune/cleanup. Reference commits in crew-shoot-status:
M1 `2a0762a`, M2 `bc8681d`, M3 `9ca6a2a` + fix `b040c93`, M5 `b56c9ab`.
