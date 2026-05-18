// Redis Cloud brief store. Legacy fallback path during the Upstash
// migration window — mirrors lib/storage-kv.ts for shoots.

import { createClient, type RedisClientType } from "redis";
import type { BriefRecord } from "./types";

const STORE_KEY = "briefs:store";

type Store = Record<string, BriefRecord>;

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

async function readAll(): Promise<Store> {
  const c = await client();
  const raw = await c.get(STORE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Store;
  } catch (err) {
    console.error("[redis] failed to parse briefs store JSON:", err);
    return {};
  }
}

async function writeAll(store: Store): Promise<void> {
  const c = await client();
  await c.set(STORE_KEY, JSON.stringify(store));
}

export async function getBySlug(slug: string): Promise<BriefRecord | null> {
  const store = await readAll();
  return store[slug] ?? null;
}

export async function getByCardId(cardId: string): Promise<BriefRecord | null> {
  const store = await readAll();
  for (const r of Object.values(store)) {
    if (r.cardId === cardId) return r;
  }
  return null;
}

export async function upsertBySlug(
  slug: string,
  updater: (existing: BriefRecord | null) => BriefRecord,
): Promise<BriefRecord> {
  const store = await readAll();
  const next = updater(store[slug] ?? null);
  store[slug] = next;
  await writeAll(store);
  return next;
}

export async function deleteBySlug(slug: string): Promise<void> {
  const store = await readAll();
  if (!(slug in store)) return;
  delete store[slug];
  await writeAll(store);
}

export async function listAll(): Promise<BriefRecord[]> {
  return Object.values(await readAll());
}
