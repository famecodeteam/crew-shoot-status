// Shared sync logic for the cron route and the on-demand single-slug
// route. Pulled out so both endpoints emit the same structured log line
// and apply the same hash-skip + error-handling rules.

import { createHash } from "node:crypto";
import { upsertBySlug } from "./brief-storage";
import { fetchDocStructure } from "./docs";
import { parseBriefDoc } from "./parse-brief";
import type { BriefRecord } from "./types";

export type SyncStatus =
  | "unchanged"
  | "updated"
  | "parse_error"
  | "fetch_error"
  | "skipped_timeout";

export type SyncResult = {
  slug: string;
  status: SyncStatus;
  durationMs: number;
  error?: string;
};

function hashStructure(doc: unknown): string {
  return createHash("sha256").update(JSON.stringify(doc)).digest("hex");
}

export async function syncOne(rec: BriefRecord): Promise<SyncResult> {
  const start = Date.now();

  // Fetch
  let doc;
  try {
    doc = await fetchDocStructure(rec.docId);
  } catch (err) {
    const msg = (err as Error).message;
    await upsertBySlug(rec.slug, (existing) => ({
      ...(existing ?? rec),
      lastErrorAt: new Date().toISOString(),
      lastErrorMessage: `fetch: ${msg}`,
      updatedAt: new Date().toISOString(),
    }));
    return {
      slug: rec.slug,
      status: "fetch_error",
      durationMs: Date.now() - start,
      error: msg,
    };
  }

  // Hash-skip: if the structural response hasn't changed since the last
  // successful sync, just touch lastSyncedAt and skip the parse + write.
  const newHash = hashStructure(doc);
  if (newHash === rec.lastContentHash && rec.parsedJson) {
    await upsertBySlug(rec.slug, (existing) => ({
      ...(existing ?? rec),
      lastSyncedAt: new Date().toISOString(),
      lastErrorAt: null,
      lastErrorMessage: null,
      // Don't bump updatedAt — preserves "real change" signal downstream.
    }));
    return { slug: rec.slug, status: "unchanged", durationMs: Date.now() - start };
  }

  // Parse
  let parsed;
  try {
    parsed = parseBriefDoc(doc);
  } catch (err) {
    const msg = (err as Error).message;
    await upsertBySlug(rec.slug, (existing) => ({
      ...(existing ?? rec),
      lastErrorAt: new Date().toISOString(),
      lastErrorMessage: `parse: ${msg}`,
      updatedAt: new Date().toISOString(),
    }));
    return {
      slug: rec.slug,
      status: "parse_error",
      durationMs: Date.now() - start,
      error: msg,
    };
  }

  // Upsert
  await upsertBySlug(rec.slug, (existing) => ({
    ...(existing ?? rec),
    lastSyncedAt: new Date().toISOString(),
    lastContentHash: newHash,
    parsedJson: parsed,
    lastErrorAt: null,
    lastErrorMessage: null,
    updatedAt: new Date().toISOString(),
  }));
  return { slug: rec.slug, status: "updated", durationMs: Date.now() - start };
}

// One-line JSON log per sync attempt. Vercel adds the timestamp; we add
// the rest. Used for both the cron loop and the single-slug endpoint so
// log queries don't have to special-case either path.
export function logSyncResult(r: SyncResult): void {
  console.log(
    `[sync-briefs] ${JSON.stringify({
      slug: r.slug,
      status: r.status,
      durationMs: r.durationMs,
      ...(r.error ? { error: r.error } : {}),
    })}`,
  );
}
