// Activity-stream storage (shared-KV contract v2 §5, §8). Mirrors the
// dispatcher pattern in lib/storage.ts + lib/asset-storage.ts:
//   - Upstash KV when UPSTASH_* is set (prod, shared with member.fame.so)
//   - Redis (REDIS_URL) as the legacy fallback
//   - file-backed JSON under .data/ for local dev
//
// KV keys:
//   activity:<cardId>:<assetSlug>   Redis LIST of AssetActivity (JSON)
//   comment-auth:<activityId>       JSON CommentAuth (shoots.fame.so-only)
//
// The activity list is SHARED - member.fame.so RPUSHes its own
// comment_internal + system_* entries to the same key. Writers MUST use
// list ops (rpush / lset / lrem) and never read-rebuild-write, or a
// concurrent member append is lost.

import type { AssetActivity, CommentAuth } from "./types";

type ActivityStorageImpl = {
  appendActivity(
    cardId: string,
    assetSlug: string,
    entry: AssetActivity,
  ): Promise<void>;
  listActivity(cardId: string, assetSlug: string): Promise<AssetActivity[]>;
  replaceActivity(
    cardId: string,
    assetSlug: string,
    entry: AssetActivity,
  ): Promise<boolean>;
  removeActivity(
    cardId: string,
    assetSlug: string,
    id: string,
  ): Promise<boolean>;
  getCommentAuth(activityId: string): Promise<CommentAuth | null>;
  setCommentAuth(activityId: string, auth: CommentAuth): Promise<void>;
  deleteCommentAuth(activityId: string): Promise<void>;
};

let cached: ActivityStorageImpl | null = null;

async function impl(): Promise<ActivityStorageImpl> {
  if (cached) return cached;
  if (
    process.env.UPSTASH_KV_REST_API_URL &&
    process.env.UPSTASH_KV_REST_API_TOKEN
  ) {
    cached = await import("./activity-storage-upstash");
  } else if (process.env.REDIS_URL) {
    cached = await import("./activity-storage-kv");
  } else {
    cached = await import("./activity-storage-file");
  }
  return cached;
}

// Append one entry to the asset's activity list (RPUSH - hot path).
export async function appendActivity(
  cardId: string,
  assetSlug: string,
  entry: AssetActivity,
): Promise<void> {
  return (await impl()).appendActivity(cardId, assetSlug, entry);
}

// The whole activity list, oldest-first.
export async function listActivity(
  cardId: string,
  assetSlug: string,
): Promise<AssetActivity[]> {
  return (await impl()).listActivity(cardId, assetSlug);
}

// Replace the entry sharing this entry's id, in place (LSET). Returns
// false if no entry with that id is present.
export async function replaceActivity(
  cardId: string,
  assetSlug: string,
  entry: AssetActivity,
): Promise<boolean> {
  return (await impl()).replaceActivity(cardId, assetSlug, entry);
}

// Remove the entry with this id (LREM). Returns false if not present.
export async function removeActivity(
  cardId: string,
  assetSlug: string,
  id: string,
): Promise<boolean> {
  return (await impl()).removeActivity(cardId, assetSlug, id);
}

export async function getCommentAuth(
  activityId: string,
): Promise<CommentAuth | null> {
  return (await impl()).getCommentAuth(activityId);
}

export async function setCommentAuth(
  activityId: string,
  auth: CommentAuth,
): Promise<void> {
  return (await impl()).setCommentAuth(activityId, auth);
}

export async function deleteCommentAuth(activityId: string): Promise<void> {
  return (await impl()).deleteCommentAuth(activityId);
}
