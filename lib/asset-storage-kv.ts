// Production: Redis. Same client/connection caching pattern as the
// shoots store in lib/storage-kv.ts.
//
// Key layout (shared with member.fame.so — see hand-off doc):
//   assets:<cardId>            JSON { [assetSlug]: Asset }
//   comments:<assetSlug>:v<n>  JSON Comment[]

import { createClient, type RedisClientType } from "redis";
import type { Asset, Comment } from "./types";

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

function assetsKey(cardId: string): string {
  return `assets:${cardId}`;
}

function commentsKey(slug: string, version: number): string {
  return `comments:${slug}:v${version}`;
}

export async function getAssetsByCardId(
  cardId: string,
): Promise<Record<string, Asset>> {
  const c = await client();
  const raw = await c.get(assetsKey(cardId));
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, Asset>;
  } catch (err) {
    console.error("[redis] failed to parse assets json:", err);
    return {};
  }
}

export async function setAssetsByCardId(
  cardId: string,
  all: Record<string, Asset>,
): Promise<void> {
  const c = await client();
  await c.set(assetsKey(cardId), JSON.stringify(all));
}

export async function getCommentsByVersion(
  slug: string,
  version: number,
): Promise<Comment[]> {
  const c = await client();
  const raw = await c.get(commentsKey(slug, version));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Comment[];
  } catch (err) {
    console.error("[redis] failed to parse comments json:", err);
    return [];
  }
}

export async function setCommentsByVersion(
  slug: string,
  version: number,
  list: Comment[],
): Promise<void> {
  const c = await client();
  await c.set(commentsKey(slug, version), JSON.stringify(list));
}
