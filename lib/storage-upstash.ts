// Upstash KV (Vercel Marketplace) - shared store with member.fame.so.
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
  // The store is keyed by CARD id, so one slug can sit on more than one entry
  // (a shoot that changed card id leaves an orphan behind). Returning the
  // first match let a stale orphan shadow the live record permanently - the
  // client page froze on an old status while the sync kept updating the other
  // entry, and its milestone emails rendered the correct one. Take the most
  // recently updated match instead, so the live record always wins.
  let best: Shoot | null = null;
  let viaPrevious: Shoot | null = null;
  const fresher = (a: Shoot, b: Shoot | null) =>
    !b || (a.updatedAt ?? "") > (b.updatedAt ?? "");
  for (const shoot of Object.values(store)) {
    if (shoot.slug === slug) {
      if (fresher(shoot, best)) best = shoot;
    } else if (shoot.previousSlugs?.includes(slug)) {
      // Historical slug - old/emailed links still resolve (page redirects).
      if (fresher(shoot, viaPrevious)) viaPrevious = shoot;
    }
  }
  return best ?? viaPrevious;
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

/**
 * One-shot batch: read the store once, apply every upsert + delete, write once.
 *
 * The feed sync used to call getByCardId + upsertByCardId per shoot, and each
 * of those reads (and rewrites) the WHOLE store - ~3 full-store transfers per
 * shoot, ~370 for a 123-shoot run. That blew the 60s function limit, so the
 * sync was killed part-way and every shoot after the cut-off silently stopped
 * updating. It was also a lost-update race: two overlapping runs would clobber
 * each other's changes, since each held a whole-store snapshot.
 */
export async function applyBatch(batch: {
  upserts?: Record<string, Shoot>;
  deletes?: string[];
}): Promise<void> {
  const store = await readAll();
  for (const [cardId, shoot] of Object.entries(batch.upserts ?? {})) {
    store[cardId] = shoot;
  }
  for (const cardId of batch.deletes ?? []) delete store[cardId];
  await writeAll(store);
}

/** The whole store keyed by card id - one read, for callers that need to look
 *  up many shoots (see applyBatch). */
export async function listAllMap(): Promise<Record<string, Shoot>> {
  return readAll();
}
