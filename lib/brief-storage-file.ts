// File-backed brief store. Local dev only (no UPSTASH / REDIS_URL set).
//
// Shape on disk: { "<briefSlug>": BriefRecord, ... } in .data/briefs.json.
// Mirrors the layout used by storage-file.ts for shoots — single map keyed
// by the record's natural identity (here, the brief slug).

import { promises as fs } from "node:fs";
import path from "node:path";
import type { BriefRecord } from "./types";

const STORE_PATH = path.join(process.cwd(), ".data", "briefs.json");

type Store = Record<string, BriefRecord>;

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
