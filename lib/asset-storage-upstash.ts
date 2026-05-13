// Asset + comment storage on Upstash KV (shared with member.fame.so).
// Same key layout as the Redis Cloud impl:
//   assets:<cardId>            JSON { [assetSlug]: Asset }
//   comments:<assetSlug>:v<n>  JSON Comment[]

import { Redis } from "@upstash/redis";
import type { Asset, Comment } from "./types";

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

function assetsKey(cardId: string): string {
  return `assets:${cardId}`;
}

function commentsKey(slug: string, version: number): string {
  return `comments:${slug}:v${version}`;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = (await client().get(key)) as T | string | null;
  if (raw == null) return fallback;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return raw as T;
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await client().set(key, JSON.stringify(value));
}

export async function getAssetsByCardId(
  cardId: string,
): Promise<Record<string, Asset>> {
  return readJson(assetsKey(cardId), {} as Record<string, Asset>);
}

export async function setAssetsByCardId(
  cardId: string,
  all: Record<string, Asset>,
): Promise<void> {
  await writeJson(assetsKey(cardId), all);
}

export async function getCommentsByVersion(
  slug: string,
  version: number,
): Promise<Comment[]> {
  return readJson(commentsKey(slug, version), [] as Comment[]);
}

export async function setCommentsByVersion(
  slug: string,
  version: number,
  list: Comment[],
): Promise<void> {
  await writeJson(commentsKey(slug, version), list);
}
