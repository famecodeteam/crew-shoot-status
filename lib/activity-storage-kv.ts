// Activity stream + comment-auth storage on Redis (REDIS_URL) - the
// legacy connection kept alongside Upstash, same client-caching pattern
// as lib/asset-storage-kv.ts. Same key layout as the Upstash impl.

import { createClient, type RedisClientType } from "redis";
import { randomBytes } from "node:crypto";
import type { AssetActivity, CommentAuth } from "./types";

let cached: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;

async function client(): Promise<RedisClientType> {
  if (cached?.isReady) return cached;
  if (connecting) return connecting;

  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");

  connecting = (async () => {
    const c = createClient({ url }) as RedisClientType;
    c.on("error", (err) => console.error("[redis] error:", err));
    await c.connect();
    cached = c;
    connecting = null;
    return c;
  })();

  return connecting;
}

function activityKey(cardId: string, assetSlug: string): string {
  return `activity:${cardId}:${assetSlug}`;
}

function authKey(activityId: string): string {
  return `comment-auth:${activityId}`;
}

function parseEntry(raw: string): AssetActivity | null {
  try {
    return JSON.parse(raw) as AssetActivity;
  } catch {
    return null;
  }
}

export async function appendActivity(
  cardId: string,
  assetSlug: string,
  entry: AssetActivity,
): Promise<void> {
  const c = await client();
  await c.rPush(activityKey(cardId, assetSlug), JSON.stringify(entry));
}

export async function listActivity(
  cardId: string,
  assetSlug: string,
): Promise<AssetActivity[]> {
  const c = await client();
  const raw = await c.lRange(activityKey(cardId, assetSlug), 0, -1);
  return raw.map(parseEntry).filter((e): e is AssetActivity => e !== null);
}

export async function replaceActivity(
  cardId: string,
  assetSlug: string,
  entry: AssetActivity,
): Promise<boolean> {
  const c = await client();
  const key = activityKey(cardId, assetSlug);
  const raw = await c.lRange(key, 0, -1);
  const idx = raw.findIndex((r) => parseEntry(r)?.id === entry.id);
  if (idx === -1) return false;
  await c.lSet(key, idx, JSON.stringify(entry));
  return true;
}

export async function removeActivity(
  cardId: string,
  assetSlug: string,
  id: string,
): Promise<boolean> {
  const c = await client();
  const key = activityKey(cardId, assetSlug);
  const raw = await c.lRange(key, 0, -1);
  const idx = raw.findIndex((r) => parseEntry(r)?.id === id);
  if (idx === -1) return false;
  const tombstone = `__removed__${randomBytes(8).toString("hex")}`;
  await c.lSet(key, idx, tombstone);
  await c.lRem(key, 1, tombstone);
  return true;
}

export async function getCommentAuth(
  activityId: string,
): Promise<CommentAuth | null> {
  const c = await client();
  const raw = await c.get(authKey(activityId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CommentAuth;
  } catch {
    return null;
  }
}

export async function setCommentAuth(
  activityId: string,
  auth: CommentAuth,
): Promise<void> {
  const c = await client();
  await c.set(authKey(activityId), JSON.stringify(auth));
}

export async function deleteCommentAuth(activityId: string): Promise<void> {
  const c = await client();
  await c.del(authKey(activityId));
}
