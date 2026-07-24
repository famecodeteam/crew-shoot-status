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
