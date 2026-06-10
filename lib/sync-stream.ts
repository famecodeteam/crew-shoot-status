// Shared logic for the sync-stream cron: keep every CLIENT-FACING asset
// version's Cloudflare Stream delivery copy in step with Drive. Only the
// LATEST published version of each asset belongs on Stream - the client
// review page is its sole consumer, CPM/editor review runs on Mux, and older
// published cuts stay visible on the review page via the Drive-proxy
// fallback. A version that's unpublished, superseded by a newer published
// cut, on-hold, approved, or on a delivered/paid/closed shoot is torn down
// (if it has a copy) and skipped, so Stream only ever holds the cut the
// client is reviewing.
//
//   - latest published, no streamUid           → copyFromUrl, mark "pending"
//   - latest published, "pending"              → poll Stream, flip ready / error
//   - latest published, "ready" / "error"      → settled, skipped
//   - unpublished / superseded / on-hold / approved → release Stream copy, skip
//   - shoot delivered / paid / closed          → release ALL its copies, skip
//
// One pass is non-blocking: copyFromUrl returns immediately with a uid
// while Cloudflare downloads + transcodes async, so the pending → ready
// transition lands on a later cron tick. Drive stays the master; Stream
// is a derived delivery copy, and the Drive proxy remains the fallback
// for any version that isn't "ready" yet.

import { listAll as listShoots } from "./storage";
import { getAssetsForShoot, upsertAsset } from "./asset-storage";
import { releaseStreamCopiesForAsset } from "./approval";
import { copyFromUrl, deleteVideo, getVideo, STREAM_APP_TAG } from "./stream";
import type { Asset, AssetVersion } from "./types";

export type StreamSyncOutcome =
  | "ingest_started" // copyFromUrl kicked off; now pending
  | "now_ready" // pending → ready this pass
  | "still_pending" // pending; transcode not finished yet
  | "ingest_error" // Stream reported a transcode error
  | "failed"; // our copy/poll call threw

export type StreamSyncResult = {
  assetSlug: string;
  version: number;
  outcome: StreamSyncOutcome;
  streamUid?: string;
  detail?: string;
};

export type StreamSyncSummary = {
  total: number;
  results: StreamSyncResult[];
  timedOut: boolean;
};

function publicBase(): string {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "") ?? "";
  if (!base) throw new Error("PUBLIC_BASE_URL must be set for sync-stream.");
  return base;
}

// We ingest ONLY client-facing (published) versions now (the version loop
// gates on isPublishedToClient), so an ingest pull is for a version the §4
// publish gate already serves to clients. The ?ingest=<CRON_SECRET> marker
// stays as belt-and-braces so the pull can never trip the gate mid-publish
// (Cloudflare's copy-from-URL fetch can't send an auth header). Empty when
// CRON_SECRET is unset (local dev: the publish gate is a no-op there anyway).
function ingestQuery(): string {
  const secret = process.env.CRON_SECRET;
  return secret ? `?ingest=${encodeURIComponent(secret)}` : "";
}

// The public, range-capable URL Cloudflare Stream pulls a version from.
//
// Default: the Vercel Drive proxy. But Vercel functions cap at ~300s, so
// a multi-GB shoot master can't be pulled through in that window - the
// ingest stalls at "downloading" and never reaches "ready". When the
// video-origin Worker is configured (VIDEO_ORIGIN_BASE set), the ingest
// is pulled straight from Drive via the Worker instead - a Worker request
// lives as long as bytes flow, no 300s wall. The ?key= secret gates the
// Worker (copy-from-URL can't send headers, so it rides in the URL).
// Falls back to the proxy when the Worker isn't configured.
function ingestSourceUrl(asset: Asset, version: AssetVersion): string {
  const workerBase = (process.env.VIDEO_ORIGIN_BASE ?? "").replace(/\/+$/, "");
  const workerSecret = process.env.VIDEO_ORIGIN_SECRET ?? "";
  if (workerBase && workerSecret && version.driveFileId) {
    return (
      `${workerBase}/file/${encodeURIComponent(version.driveFileId)}` +
      `?key=${encodeURIComponent(workerSecret)}`
    );
  }
  return `${publicBase()}/api/video/${encodeURIComponent(asset.slug)}/v${version.n}${ingestQuery()}`;
}

// Immutable patch of one version inside one asset. Re-reads the asset so
// concurrent writes to OTHER versions aren't clobbered.
async function patchVersion(
  cardId: string,
  slug: string,
  n: number,
  patch: Partial<AssetVersion>,
): Promise<void> {
  await upsertAsset(cardId, slug, (existing) => {
    if (!existing) throw new Error(`asset ${slug} vanished mid-sync`);
    return {
      ...existing,
      versions: existing.versions.map((v) =>
        v.n === n ? { ...v, ...patch } : v,
      ),
      updatedAt: new Date().toISOString(),
    };
  });
}

// One version: copy-or-poll. Called only for versions that aren't already
// settled (the loop filters ready/error out first).
async function syncVersion(
  cardId: string,
  asset: Asset,
  version: AssetVersion,
): Promise<StreamSyncResult> {
  const base = { assetSlug: asset.slug, version: version.n };
  try {
    // Already ingested → poll the transcode.
    if (version.streamUid && version.streamStatus === "pending") {
      const v = await getVideo(version.streamUid);
      if (v.status.state === "error") {
        const detail =
          v.status.errorReasonText ??
          v.status.errorReasonCode ??
          "transcode error";
        await patchVersion(cardId, asset.slug, version.n, {
          streamStatus: "error",
          streamError: detail,
        });
        return { ...base, outcome: "ingest_error", streamUid: version.streamUid, detail };
      }
      if (v.readyToStream) {
        await patchVersion(cardId, asset.slug, version.n, {
          streamStatus: "ready",
          streamError: null,
        });
        return { ...base, outcome: "now_ready", streamUid: version.streamUid };
      }
      return {
        ...base,
        outcome: "still_pending",
        streamUid: version.streamUid,
        detail: v.status.pctComplete ?? v.status.state,
      };
    }

    // No Stream copy yet → kick one off. Cloudflare pulls the file from a
    // public, range-capable URL - the video-origin Worker, or the Drive
    // proxy as fallback. See ingestSourceUrl.
    const srcUrl = ingestSourceUrl(asset, version);
    const name = `${asset.name} v${version.n} (${asset.slug})`;
    // Tag the ingest so the orphan-prune can scope to this app's videos
    // (the Cloudflare Stream account is shared with the Video Review Tool).
    const created = await copyFromUrl(srcUrl, name, { app: STREAM_APP_TAG });
    await patchVersion(cardId, asset.slug, version.n, {
      streamUid: created.uid,
      streamStatus: "pending",
      streamError: null,
    });
    return { ...base, outcome: "ingest_started", streamUid: created.uid };
  } catch (err) {
    return { ...base, outcome: "failed", detail: (err as Error).message };
  }
}

// One full pass over every asset version. Time-boxed by the caller's
// deadline; unfinished work is simply picked up on the next tick.
export async function syncStreamOnce(deadline: number): Promise<StreamSyncSummary> {
  const shoots = await listShoots();
  const results: StreamSyncResult[] = [];
  let timedOut = false;

  outer: for (const shoot of shoots) {
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
    const assets = await getAssetsForShoot(shoot.cardId);
    for (const asset of assets) {
      // Approved assets are done: free any Stream delivery copies they
      // still hold, then skip (never re-ingest an approved asset). The
      // approve route already releases on new approvals; doing it here too
      // backfills assets approved BEFORE that shipped and catches any
      // approve-time delete that failed. Idempotent - once cleansed there's
      // no streamUid, so later ticks are a no-op. Un-approval flips the
      // status and the next tick picks the asset back up.
      if (asset.approval?.status === "approved") {
        if (asset.versions.some((v) => v.streamUid)) {
          try {
            const res = await releaseStreamCopiesForAsset(shoot.cardId, asset.slug);
            console.log(
              `[sync-stream] cleansed approved ${asset.slug}: ${res.deleted} deleted, ${res.failed} failed`,
            );
          } catch (err) {
            console.warn(
              `[sync-stream] cleanse approved ${asset.slug} failed:`,
              (err as Error).message,
            );
          }
        }
        continue;
      }

      // On-hold assets: tear down their Stream delivery copies too. Two
      // hold cases, both meaning "this work is paused - take it off
      // Cloudflare": (a) the whole shoot is in the "On Hold" list
      // (shoot.status === "on-hold", synced from the member feed), or (b) a
      // CPM paused this single asset (member writes lifecycle "on_hold").
      // Same release-and-skip pattern as approved: idempotent (a cleared
      // streamUid makes later ticks a no-op) and reversible - once the shoot
      // leaves On Hold / the asset resumes, the next tick re-ingests.
      if (shoot.status === "on-hold" || asset.lifecycle === "on_hold") {
        if (asset.versions.some((v) => v.streamUid)) {
          try {
            const res = await releaseStreamCopiesForAsset(shoot.cardId, asset.slug);
            console.log(
              `[sync-stream] released on-hold ${asset.slug}: ${res.deleted} deleted, ${res.failed} failed`,
            );
          } catch (err) {
            console.warn(
              `[sync-stream] release on-hold ${asset.slug} failed:`,
              (err as Error).message,
            );
          }
        }
        continue;
      }

      // Delivered / paid / closed: the whole shoot is done with client
      // review, so take every one of its assets off Cloudflare Stream. These
      // shoots have moved to "Assets Approved By Client", "Awaiting Payment",
      // or "Closed" on the board - all three map to the "delivered" status
      // here (lib/list-mapping). Same release-and-skip pattern as on-hold, and
      // a backstop to the per-asset "approved" teardown above: it also catches
      // a published asset on the shoot that was never individually approved.
      // Reversible - moved back to an earlier list, the next tick re-ingests.
      if (shoot.status === "delivered") {
        if (asset.versions.some((v) => v.streamUid)) {
          try {
            const res = await releaseStreamCopiesForAsset(shoot.cardId, asset.slug);
            console.log(
              `[sync-stream] released delivered ${asset.slug}: ${res.deleted} deleted, ${res.failed} failed`,
            );
          } catch (err) {
            console.warn(
              `[sync-stream] release delivered ${asset.slug} failed:`,
              (err as Error).message,
            );
          }
        }
        continue;
      }

      // Only the LATEST published version of an asset belongs on Cloudflare
      // Stream - it's the cut the client is actively reviewing. Older
      // published versions stay VISIBLE on the review page (the client keeps
      // the full version history) but play via the Drive-proxy fallback, so
      // their Stream copy is torn down. "Published" matches the client's own
      // visibility filter (clientVersions): an absent isPublishedToClient
      // counts as published, for legacy records.
      const latestPublishedN = asset.versions.reduce(
        (max, v) => (v.isPublishedToClient !== false ? Math.max(max, v.n) : max),
        0,
      );

      for (const version of asset.versions) {
        if (Date.now() > deadline) {
          timedOut = true;
          break outer;
        }
        // On Stream only if this is the single latest published version.
        // Everything else - unpublished (CPM/editor review on Mux) or an
        // older published cut superseded by a newer one - is torn down (if it
        // has a copy) and skipped. Reversible: (re)publishing or a new latest
        // flips it and a later tick re-ingests. The clear-write is guarded so
        // a version that was never on Stream is a true no-op.
        const published = version.isPublishedToClient !== false;
        if (!published || version.n !== latestPublishedN) {
          if (version.streamUid) {
            const reason = published ? "superseded" : "unpublished";
            try {
              await deleteVideo(version.streamUid);
              console.log(
                `[sync-stream] released ${reason} ${asset.slug} v${version.n}`,
              );
            } catch (err) {
              console.warn(
                `[sync-stream] release ${reason} ${asset.slug} v${version.n} failed:`,
                (err as Error).message,
              );
            }
          }
          if (version.streamUid || version.streamStatus || version.streamError) {
            await patchVersion(shoot.cardId, asset.slug, version.n, {
              streamUid: null,
              streamStatus: null,
              streamError: null,
            });
          }
          continue;
        }
        // Settled versions need no API call - skip before touching Stream.
        if (version.streamStatus === "ready" || version.streamStatus === "error") {
          continue;
        }
        results.push(await syncVersion(shoot.cardId, asset, version));
      }
    }
  }

  return { total: results.length, results, timedOut };
}
