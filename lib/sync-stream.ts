// Shared logic for the sync-stream cron: keep every asset version's
// Cloudflare Stream delivery copy in step with Drive.
//
//   - version with no streamUid       → copyFromUrl, mark "pending"
//   - version "pending"               → poll Stream, flip ready / error
//   - version "ready" / "error"       → settled, skipped
//
// One pass is non-blocking: copyFromUrl returns immediately with a uid
// while Cloudflare downloads + transcodes async, so the pending → ready
// transition lands on a later cron tick. Drive stays the master; Stream
// is a derived delivery copy, and the Drive proxy remains the fallback
// for any version that isn't "ready" yet.

import { listAll as listShoots } from "./storage";
import { getAssetsForShoot, upsertAsset } from "./asset-storage";
import { copyFromUrl, getVideo, STREAM_APP_TAG } from "./stream";
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

// The video proxy 404s unpublished versions for client requests (the
// contract v2 §4 publish gate). But this cron must ingest EVERY version
// into Stream, published or not (§12). Cloudflare's copy-from-URL fetch
// can't send an auth header, so we mark the ingest pull with
// ?ingest=<CRON_SECRET> in the URL - the one signal the proxy honours to
// skip the gate. Empty when CRON_SECRET is unset (local dev: the publish
// gate is a no-op there anyway).
function ingestQuery(): string {
  const secret = process.env.CRON_SECRET;
  return secret ? `?ingest=${encodeURIComponent(secret)}` : "";
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

    // No Stream copy yet → kick one off. Cloudflare pulls the file from
    // our Drive proxy (a public, range-capable URL).
    const srcUrl = `${publicBase()}/api/video/${encodeURIComponent(asset.slug)}/v${version.n}${ingestQuery()}`;
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
      for (const version of asset.versions) {
        if (Date.now() > deadline) {
          timedOut = true;
          break outer;
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
