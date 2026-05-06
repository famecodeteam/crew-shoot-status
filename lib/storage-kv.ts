// Vercel KV-backed storage. Used in production (when KV_REST_API_URL is set).
//
// Layout: a single key `shoots:store` holding the full shoots map as JSON.
// One read = one KV roundtrip; same shape as the file store. This is the
// simplest workable layout for ≤ a few hundred shoots and lets us preserve
// the read-modify-write semantics of the file store without per-key indexing.
// If we outgrow this (1000+ shoots, hot writes), switch to per-card keys
// + a slug→cardId index — but that's a future problem.

import { kv } from "@vercel/kv";
import type { Shoot } from "./types";

const STORE_KEY = "shoots:store";

type Store = Record<string, Shoot>;

async function readAll(): Promise<Store> {
  // kv.get auto-parses JSON. If the key doesn't exist yet, it returns null.
  const data = await kv.get<Store>(STORE_KEY);
  return data ?? {};
}

async function writeAll(store: Store): Promise<void> {
  await kv.set(STORE_KEY, store);
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
  // No optimistic locking — single-writer model (backfill is one-shot,
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
