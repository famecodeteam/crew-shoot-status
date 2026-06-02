// Publish gate - shared-KV contract v2 §4.
//
// A finished version is invisible to the client until a CPM ticks
// "approve for client" on member.fame.so, which sets
// AssetVersion.isPublishedToClient. Absent ⇒ published: legacy records
// predate the flag, and there's an interim window after this filter
// deploys but before member.fame.so backfills the flag onto existing
// versions. Treating absent-as-published keeps every current version
// visible, so the cutover has no leak window.
//
// clientVersions() is the single chokepoint. Every client-facing read
// of asset.versions runs through it - the status page, the asset review
// page, the video proxy, the approve / request-changes endpoints.
// Internal pipelines (the sync-stream ingest, the orphan-prune)
// deliberately do NOT: they must see every version regardless of state.

import type { Asset, AssetVersion } from "./types";

// The versions a client may see. Only an explicit isPublishedToClient
// === false hides a version; absent or true ⇒ visible.
export function clientVersions(asset: Asset): AssetVersion[] {
  return asset.versions.filter((v) => v.isPublishedToClient !== false);
}

// Client-facing version numbering.
//
// The client should see a contiguous count - v1, v2, v3 - of the versions
// they can actually see, NOT the internal version number `n`. `n` is the
// canonical identity (it keys the Drive file, the comments, the approval's
// onVersion, and the cross-repo KV contract), so we never renumber it; we
// only relabel for display. The client number is simply the 1-based position
// among clientVersions(), in order. Internal-only cuts (unpublished /
// deleted) leave no gap because they were never in the visible list.

/**
 * The client-facing label number for internal version `n`, i.e. its 1-based
 * position among the versions the client can see. Returns null when `n`
 * isn't client-visible (so callers can fall back / skip). Pair `n` (for every
 * data read/write) with this (for every label the client reads).
 */
export function clientFacingVersionNumber(
  asset: Asset,
  n: number,
): number | null {
  const idx = clientVersions(asset).findIndex((v) => v.n === n);
  return idx === -1 ? null : idx + 1;
}
