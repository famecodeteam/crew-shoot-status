// Vercel Cron: GET /api/sync-briefs (every 5 minutes per vercel.json).
//
// For each registered brief:
//   • Fetch the Doc via documents.get.
//   • SHA-256 the structural response. If unchanged since last sync → just
//     touch lastSyncedAt, skip the parse + write.
//   • Otherwise re-parse and upsert the record.
//
// Per-brief failures are captured on the record (lastErrorAt /
// lastErrorMessage) and never blow away the last good parse. The whole
// loop is time-boxed at 55s so we exit cleanly before Vercel's 60s cron
// cap; oldest-first ordering means stragglers land on the next tick.
//
// Auth: when CRON_SECRET is set in env, Vercel includes Authorization:
// Bearer <secret> on every cron-triggered request. In dev (no secret set)
// the route is callable directly — handy for manual triggers.

import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { fetchDocStructure } from "@/lib/docs";
import { parseBriefDoc } from "@/lib/parse-brief";
import { listAll, upsertBySlug } from "@/lib/brief-storage";
import type { BriefRecord } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const TIME_BUDGET_MS = 55_000;

type SyncStatus =
  | "unchanged"
  | "updated"
  | "parse_error"
  | "fetch_error"
  | "skipped_timeout";

type SyncResult = {
  slug: string;
  status: SyncStatus;
  durationMs: number;
  error?: string;
};

function hashStructure(doc: unknown): string {
  return createHash("sha256").update(JSON.stringify(doc)).digest("hex");
}

async function syncOne(rec: BriefRecord): Promise<SyncResult> {
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
    return { slug: rec.slug, status: "fetch_error", durationMs: Date.now() - start, error: msg };
  }

  // Hash-skip
  const newHash = hashStructure(doc);
  if (newHash === rec.lastContentHash && rec.parsedJson) {
    await upsertBySlug(rec.slug, (existing) => ({
      ...(existing ?? rec),
      lastSyncedAt: new Date().toISOString(),
      lastErrorAt: null,
      lastErrorMessage: null,
      // Don't bump updatedAt on no-op sync — preserves "real change" signal.
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
    return { slug: rec.slug, status: "parse_error", durationMs: Date.now() - start, error: msg };
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

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const deadline = Date.now() + TIME_BUDGET_MS;
  const briefs = await listAll();

  // Oldest-first so stragglers in long batches still get caught next tick.
  // null lastSyncedAt sorts first (brand-new briefs).
  briefs.sort((a, b) => {
    const av = a.lastSyncedAt ?? "";
    const bv = b.lastSyncedAt ?? "";
    return av < bv ? -1 : av > bv ? 1 : 0;
  });

  const results: SyncResult[] = [];
  for (const b of briefs) {
    if (Date.now() > deadline) {
      results.push({ slug: b.slug, status: "skipped_timeout", durationMs: 0 });
      continue;
    }
    const r = await syncOne(b);
    console.log(
      `[sync-briefs] ${JSON.stringify({
        slug: r.slug,
        status: r.status,
        durationMs: r.durationMs,
        ...(r.error ? { error: r.error } : {}),
      })}`,
    );
    results.push(r);
  }

  return NextResponse.json({ ok: true, total: briefs.length, results });
}
