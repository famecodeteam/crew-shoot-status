// Upstash KV (Vercel Marketplace) — shared store with member.fame.so.
// Uses the REST endpoint via @upstash/redis. Serverless-native (no TCP
// connection pooling), correct shape for cross-repo coordination.
//
// Env vars come from the Marketplace integration with the "UPSTASH"
// custom prefix:
//   UPSTASH_KV_REST_API_URL
//   UPSTASH_KV_REST_API_TOKEN
//
// Same key shape as the Redis Cloud impl (single shoots:store key
// holding the full map). The migration script copies values 1:1.

import { Redis } from "@upstash/redis";
import type { Shoot } from "./types";

const STORE_KEY = "shoots:store";

type Store = Record<string, Shoot>;

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

async function readAll(): Promise<Store> {
  // @upstash/redis auto-parses JSON when the stored value is JSON. We
  // explicitly stringify on writes, so the parsed result is already the
  // map shape. If for any reason the stored value is a string, parse it.
  const raw = (await client().get(STORE_KEY)) as Store | string | null;
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Store;
    } catch {
      return {};
    }
  }
  return raw;
}

async function writeAll(store: Store): Promise<void> {
  // Stringify so we control the wire shape (the SDK will still try to
  // parse on read; consistent behaviour either way).
  await client().set(STORE_KEY, JSON.stringify(store));
}

export async function getBySlug(slug: string): Promise<Shoot | null> {
  const store = await readAll();
  for (const shoot of Object.values(store)) {
    if (shoot.slug === slug) return shoot;
  }
  return null;
}

export async function getByCardId(cardId: string): Promise<Shoot | null> {
  const store = await readAll();
  return store[cardId] ?? null;
}

export async function upsertByCardId(
  cardId: string,
  updater: (existing: Shoot | null) => Shoot,
): Promise<Shoot> {
  const store = await readAll();
  const next = updater(store[cardId] ?? null);
  store[cardId] = next;
  await writeAll(store);
  return next;
}

export async function deleteByCardId(cardId: string): Promise<void> {
  const store = await readAll();
  if (!(cardId in store)) return;
  delete store[cardId];
  await writeAll(store);
}

export async function listAll(): Promise<Shoot[]> {
  const store = await readAll();
  return Object.values(store);
}
