// Asset + comment storage. Mirrors the dispatcher pattern in lib/storage.ts:
//   - Dev (no REDIS_URL): file-backed JSON in .data/
//   - Prod (REDIS_URL set): Redis keys (shared with the member.fame.so repo)
//
// KV key layout (canonical - also documented in the hand-off doc):
//   assets:<cardId>            → JSON object  { [assetSlug]: Asset }
//   comments:<assetSlug>:v<n>  → JSON array   Comment[]
//
// Reads and writes go through this module exclusively so both impls stay
// in lock-step with the schema in lib/types.ts.

import type { Asset, Comment } from "./types";

// ---------- Dispatcher ----------

type AssetStorageImpl = {
  getAssetsByCardId(cardId: string): Promise<Record<string, Asset>>;
  setAssetsByCardId(cardId: string, all: Record<string, Asset>): Promise<void>;
  getCommentsByVersion(slug: string, version: number): Promise<Comment[]>;
  setCommentsByVersion(slug: string, version: number, list: Comment[]): Promise<void>;
};

let cached: AssetStorageImpl | null = null;

async function impl(): Promise<AssetStorageImpl> {
  if (cached) return cached;
  if (process.env.UPSTASH_KV_REST_API_URL && process.env.UPSTASH_KV_REST_API_TOKEN) {
    cached = await import("./asset-storage-upstash");
  } else if (process.env.REDIS_URL) {
    cached = await import("./asset-storage-kv");
  } else {
    cached = await import("./asset-storage-file");
  }
  return cached;
}

// ---------- High-level operations ----------

export async function getAssetsForShoot(cardId: string): Promise<Asset[]> {
  const m = await (await impl()).getAssetsByCardId(cardId);
  return Object.values(m);
}

export async function getAsset(
  cardId: string,
  slug: string,
): Promise<Asset | null> {
  const m = await (await impl()).getAssetsByCardId(cardId);
  return m[slug] ?? null;
}

// Read-modify-write on the per-shoot map. Single-writer assumption: the
// only writers are server-side route handlers + scripts, sequentially.
export async function upsertAsset(
  cardId: string,
  slug: string,
  updater: (existing: Asset | null) => Asset,
): Promise<Asset> {
  const i = await impl();
  const all = await i.getAssetsByCardId(cardId);
  const next = updater(all[slug] ?? null);
  all[slug] = next;
  await i.setAssetsByCardId(cardId, all);
  return next;
}

export async function deleteAsset(cardId: string, slug: string): Promise<void> {
  const i = await impl();
  const all = await i.getAssetsByCardId(cardId);
  if (!(slug in all)) return;
  delete all[slug];
  await i.setAssetsByCardId(cardId, all);
}

// ---------- Comments ----------

export async function listComments(slug: string, version: number): Promise<Comment[]> {
  return (await impl()).getCommentsByVersion(slug, version);
}

export async function appendComment(
  slug: string,
  version: number,
  comment: Comment,
): Promise<Comment[]> {
  const i = await impl();
  const list = await i.getCommentsByVersion(slug, version);
  list.push(comment);
  await i.setCommentsByVersion(slug, version, list);
  return list;
}

export async function updateComment(
  slug: string,
  version: number,
  commentId: string,
  updater: (c: Comment) => Comment,
): Promise<Comment | null> {
  const i = await impl();
  const list = await i.getCommentsByVersion(slug, version);
  const idx = list.findIndex((c) => c.id === commentId);
  if (idx === -1) return null;
  const updated = updater(list[idx]);
  list[idx] = updated;
  await i.setCommentsByVersion(slug, version, list);
  return updated;
}

export async function deleteComment(
  slug: string,
  version: number,
  commentId: string,
): Promise<boolean> {
  const i = await impl();
  const list = await i.getCommentsByVersion(slug, version);
  const idx = list.findIndex((c) => c.id === commentId);
  if (idx === -1) return false;
  list.splice(idx, 1);
  await i.setCommentsByVersion(slug, version, list);
  return true;
}
