// Activity stream + comment-auth storage on Upstash KV (shared with
// member.fame.so). Keys:
//   activity:<cardId>:<assetSlug>  Redis LIST of AssetActivity (JSON)
//   comment-auth:<activityId>      JSON CommentAuth
//
// The activity list is SHARED - member.fame.so RPUSHes its own entries
// to the same key - so writes use list ops only (rpush / lset / lrem)
// and never read-rebuild-write.

import { Redis } from "@upstash/redis";
import { randomBytes } from "node:crypto";
import type { AssetActivity, CommentAuth } from "./types";

let cached: Redis | null = null;

function client(): Redis {
  if (cached) return cached;
  const url = process.env.UPSTASH_KV_REST_API_URL;
  const token = process.env.UPSTASH_KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      "UPSTASH_KV_REST_API_URL and UPSTASH_KV_REST_API_TOKEN must be set",
    );
  }
  cached = new Redis({ url, token });
  return cached;
}

function activityKey(cardId: string, assetSlug: string): string {
  return `activity:${cardId}:${assetSlug}`;
}

function authKey(activityId: string): string {
  return `comment-auth:${activityId}`;
}

// Global cross-portal activity feed - read by delivery.fame.so's
// Activity page. member.fame.so mirrors its own asset events into this
// same list; we mirror client comments + approvals here so they show up
// in the unified feed alongside everything else. Shape MUST match
// delivery's GlobalAssetFeedEntry: { cardId, assetSlug, assetName, entry }.
const GLOBAL_ASSET_FEED_KEY = "asset-feed:global";
const GLOBAL_ASSET_FEED_CAP = 500;

async function mirrorToGlobalFeed(
  cardId: string,
  assetSlug: string,
  entry: AssetActivity,
): Promise<void> {
  // Only the entry types delivery's feed surfaces - keeps the shared
  // list lean. This repo writes comment_client (incl. approval decision
  // notes); mirror those.
  if (
    entry.type !== "comment_client" &&
    entry.type !== "comment_internal" &&
    entry.type !== "system_version_published"
  ) {
    return;
  }
  try {
    await client().lpush(
      GLOBAL_ASSET_FEED_KEY,
      JSON.stringify({ cardId, assetSlug, assetName: null, entry }),
    );
    await client().ltrim(GLOBAL_ASSET_FEED_KEY, 0, GLOBAL_ASSET_FEED_CAP - 1);
  } catch (err) {
    // Best-effort: a failed mirror must never fail the primary comment
    // write (the per-asset stream is the source of truth).
    console.warn("[activity-upstash] global feed mirror failed:", err);
  }
}

// A list element comes back either already-parsed (Upstash deserialises
// JSON) or as a raw string - handle both, and drop anything unparseable
// (e.g. a delete tombstone observed mid-LREM).
function parseEntry(raw: unknown): AssetActivity | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as AssetActivity;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as AssetActivity;
  return null;
}

export async function appendActivity(
  cardId: string,
  assetSlug: string,
  entry: AssetActivity,
): Promise<void> {
  await client().rpush(activityKey(cardId, assetSlug), JSON.stringify(entry));
  // Mirror into the cross-portal global feed so client comments +
  // approvals appear on delivery.fame.so/ alongside everything else.
  await mirrorToGlobalFeed(cardId, assetSlug, entry);
}

export async function listActivity(
  cardId: string,
  assetSlug: string,
): Promise<AssetActivity[]> {
  const raw = (await client().lrange(
    activityKey(cardId, assetSlug),
    0,
    -1,
  )) as unknown[];
  return raw.map(parseEntry).filter((e): e is AssetActivity => e !== null);
}

export async function replaceActivity(
  cardId: string,
  assetSlug: string,
  entry: AssetActivity,
): Promise<boolean> {
  const key = activityKey(cardId, assetSlug);
  const list = await listActivity(cardId, assetSlug);
  const idx = list.findIndex((e) => e.id === entry.id);
  if (idx === -1) return false;
  await client().lset(key, idx, JSON.stringify(entry));
  return true;
}

export async function removeActivity(
  cardId: string,
  assetSlug: string,
  id: string,
): Promise<boolean> {
  const key = activityKey(cardId, assetSlug);
  const list = await listActivity(cardId, assetSlug);
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  // LSET a unique tombstone, then LREM it - leaves every other element
  // (including a concurrent member append) in place.
  const tombstone = `__removed__${randomBytes(8).toString("hex")}`;
  await client().lset(key, idx, tombstone);
  await client().lrem(key, 1, tombstone);
  return true;
}

export async function getCommentAuth(
  activityId: string,
): Promise<CommentAuth | null> {
  const raw = (await client().get(authKey(activityId))) as
    | CommentAuth
    | string
    | null;
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as CommentAuth;
    } catch {
      return null;
    }
  }
  return raw as CommentAuth;
}

export async function setCommentAuth(
  activityId: string,
  auth: CommentAuth,
): Promise<void> {
  await client().set(authKey(activityId), JSON.stringify(auth));
}

export async function deleteCommentAuth(activityId: string): Promise<void> {
  await client().del(authKey(activityId));
}
