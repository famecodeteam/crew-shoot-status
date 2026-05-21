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
