// File-backed JSON store. M1 only - swapped for Vercel KV in M5.
//
// Shape on disk:
//   { "<cardId>": Shoot, ... }
//
// We key by Trello card ID (stable across renames). Slug → record lookup
// scans values; fine for tens-to-hundreds of shoots. If we ever outgrow
// this, swap in KV with a second index.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Shoot } from "./types";

const STORE_PATH = path.join(process.cwd(), ".data", "shoots.json");

type Store = Record<string, Shoot>;

async function readAll(): Promise<Store> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as Store;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function writeAll(store: Store): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2) + "\n", "utf8");
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

// Read-modify-write. The updater receives the existing record (or null) and
// returns the new one - lets callers preserve the slug on subsequent syncs.
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
