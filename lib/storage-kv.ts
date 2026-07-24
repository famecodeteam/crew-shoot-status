// Redis-backed storage. Used in production (when REDIS_URL is set).
//
// Layout: a single key `shoots:store` holding the full shoots map as JSON.
// One read = one Redis round-trip; same shape as the file store. This is
// the simplest workable layout for ≤ a few hundred shoots and lets us
// preserve the read-modify-write semantics of the file store without
// per-key indexing. If we outgrow this (1000+ shoots, hot writes), switch
// to per-card keys + a slug→cardId index.
//
// Connection model: lazy-create one client and reuse it across calls
// within the same warm function instance. Vercel reuses Node containers
// across invocations, so the connection cost is paid once per cold start.

import { createClient, type RedisClientType } from "redis";
import type { Shoot } from "./types";

const STORE_KEY = "shoots:store";

type Store = Record<string, Shoot>;

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
    console.error("[redis] failed to parse store JSON:", err);
    return {};
  }
}

async function writeAll(store: Store): Promise<void> {
  const c = await client();
  await c.set(STORE_KEY, JSON.stringify(store));
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
  // No optimistic locking - single-writer model (backfill is one-shot,
  // webhook is sequential per Trello's delivery). Good enough for v1.
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
