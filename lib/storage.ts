// Storage dispatcher. Picks an implementation based on env:
//   • KV_REST_API_URL set → Vercel KV (production)
//   • otherwise           → file-backed JSON store (local dev)
//
// Both impls export the same interface, so callers (page, webhook handler,
// backfill script) don't need to know which one is in use.
//
// The KV module is lazy-loaded so local dev doesn't pull `@vercel/kv` into
// the dev bundle when it isn't needed.

import * as fileStorage from "./storage-file";
import type { Shoot } from "./types";

type StorageModule = {
  getBySlug(slug: string): Promise<Shoot | null>;
  getByCardId(cardId: string): Promise<Shoot | null>;
  upsertByCardId(
    cardId: string,
    updater: (existing: Shoot | null) => Shoot,
  ): Promise<Shoot>;
  deleteByCardId(cardId: string): Promise<void>;
  listAll(): Promise<Shoot[]>;
};

let cached: StorageModule | null = null;

async function getImpl(): Promise<StorageModule> {
  if (cached) return cached;
  if (process.env.KV_REST_API_URL) {
    cached = (await import("./storage-kv")) as unknown as StorageModule;
  } else {
    cached = fileStorage;
  }
  return cached;
}

export async function getBySlug(slug: string): Promise<Shoot | null> {
  return (await getImpl()).getBySlug(slug);
}

export async function getByCardId(cardId: string): Promise<Shoot | null> {
  return (await getImpl()).getByCardId(cardId);
}

export async function upsertByCardId(
  cardId: string,
  updater: (existing: Shoot | null) => Shoot,
): Promise<Shoot> {
  return (await getImpl()).upsertByCardId(cardId, updater);
}

export async function deleteByCardId(cardId: string): Promise<void> {
  return (await getImpl()).deleteByCardId(cardId);
}

export async function listAll(): Promise<Shoot[]> {
  return (await getImpl()).listAll();
}
