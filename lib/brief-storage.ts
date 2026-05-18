// Brief store dispatcher. Same env-driven selection as lib/storage.ts:
//   • UPSTASH_KV_REST_API_URL set → Upstash (production)
//   • REDIS_URL set               → Redis Cloud (legacy)
//   • otherwise                   → file (.data/briefs.json, local dev)
//
// Records are keyed by short brief slug (e.g. "0219-demand-ai"), which is
// the shoot slug with its 8-hex-char hash stripped. The hash is preserved
// on the record itself as the modal unlock code.

import * as fileImpl from "./brief-storage-file";
import type { BriefRecord } from "./types";

type Impl = {
  getBySlug(slug: string): Promise<BriefRecord | null>;
  getByCardId(cardId: string): Promise<BriefRecord | null>;
  upsertBySlug(
    slug: string,
    updater: (existing: BriefRecord | null) => BriefRecord,
  ): Promise<BriefRecord>;
  deleteBySlug(slug: string): Promise<void>;
  listAll(): Promise<BriefRecord[]>;
};

let cached: Impl | null = null;

async function impl(): Promise<Impl> {
  if (cached) return cached;
  if (
    process.env.UPSTASH_KV_REST_API_URL &&
    process.env.UPSTASH_KV_REST_API_TOKEN
  ) {
    cached = (await import("./brief-storage-upstash")) as unknown as Impl;
  } else if (process.env.REDIS_URL) {
    cached = (await import("./brief-storage-kv")) as unknown as Impl;
  } else {
    cached = fileImpl;
  }
  return cached;
}

export async function getBySlug(slug: string): Promise<BriefRecord | null> {
  return (await impl()).getBySlug(slug);
}

export async function getByCardId(cardId: string): Promise<BriefRecord | null> {
  return (await impl()).getByCardId(cardId);
}

export async function upsertBySlug(
  slug: string,
  updater: (existing: BriefRecord | null) => BriefRecord,
): Promise<BriefRecord> {
  return (await impl()).upsertBySlug(slug, updater);
}

export async function deleteBySlug(slug: string): Promise<void> {
  return (await impl()).deleteBySlug(slug);
}

export async function listAll(): Promise<BriefRecord[]> {
  return (await impl()).listAll();
}

// Convenience used by the Trello webhook: register a brief on first
// discovery, or update its docId if the producer pointed the shoot folder
// at a different Doc. Doesn't churn updatedAt on no-op calls.
export async function registerBrief(args: {
  briefSlug: string;
  hash: string;
  docId: string;
  cardId: string;
  shootNumber?: string;
}): Promise<{ created: boolean; updated: boolean }> {
  let created = false;
  let updated = false;
  await upsertBySlug(args.briefSlug, (existing) => {
    const now = new Date().toISOString();
    if (!existing) {
      created = true;
      return {
        slug: args.briefSlug,
        hash: args.hash,
        docId: args.docId,
        cardId: args.cardId,
        shootNumber: args.shootNumber,
        lastSyncedAt: null,
        lastContentHash: null,
        parsedJson: null,
        lastErrorAt: null,
        lastErrorMessage: null,
        createdAt: now,
        updatedAt: now,
      };
    }
    const docChanged = existing.docId !== args.docId;
    const hashChanged = existing.hash !== args.hash;
    const cardChanged = existing.cardId !== args.cardId;
    if (!docChanged && !hashChanged && !cardChanged) return existing;
    updated = true;
    return {
      ...existing,
      hash: args.hash,
      cardId: args.cardId,
      docId: args.docId,
      shootNumber: args.shootNumber ?? existing.shootNumber,
      // Doc swap → force a refetch + reparse on the next cron tick.
      lastContentHash: docChanged ? null : existing.lastContentHash,
      updatedAt: now,
    };
  });
  return { created, updated };
}
