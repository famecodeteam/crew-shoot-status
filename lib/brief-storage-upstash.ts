// Upstash KV brief store. Production path; mirrors lib/storage-upstash.ts.
//
// Single key: briefs:store → Record<briefSlug, BriefRecord> as JSON.

import { Redis } from "@upstash/redis";
import type { BriefRecord } from "./types";

const STORE_KEY = "briefs:store";

type Store = Record<string, BriefRecord>;

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
  await client().set(STORE_KEY, JSON.stringify(store));
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
