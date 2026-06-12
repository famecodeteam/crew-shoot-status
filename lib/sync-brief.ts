// Shared sync logic for the cron route and the on-demand single-slug
// route. Pulled out so both endpoints emit the same structured log line
// and apply the same hash-skip + error-handling rules.

import { createHash } from "node:crypto";
import { upsertBySlug } from "./brief-storage";
import { fetchDocStructure } from "./docs";
import { parseBriefDoc, type ParsedBrief } from "./parse-brief";
import type { BriefRecord } from "./types";

export type SyncStatus =
  | "unchanged"
  | "updated"
  | "parse_error"
  | "fetch_error"
  | "skipped_timeout";

// Lightweight parse-quality signal. Producer-drift canaries:
//   • sections === 0 → the Doc has no numbered HEADING_3 at all
//   • overviewFields === 0 → the Project Overview section parsed empty,
//     usually meaning all-prose-fallback (no fields recognised)
//   • crewMembers === 0 → no "Assigned Crew Member" row found
//   • proseFallback flips true when most sections fell through to prose
// `suspicious` rolls a heuristic up so logs/dashboards can filter for
// briefs that need human attention without reading every metric.
export type ParseHealth = {
  sections: number;
  overviewFields: number;
  crewMembers: number;
  proseFallback: number;
  suspicious: boolean;
};

export type SyncResult = {
  slug: string;
  status: SyncStatus;
  durationMs: number;
  error?: string;
  health?: ParseHealth;
};

function computeHealth(parsed: ParsedBrief): ParseHealth {
  let overviewFields = 0;
  let crewMembers = 0;
  let proseFallback = 0;
  for (const s of parsed.sections) {
    if (s.kind === "overview") overviewFields = Object.keys(s.fields).length;
    if (s.kind === "crew") crewMembers = s.members.length;
    if (s.kind === "prose") proseFallback++;
  }
  const sections = parsed.sections.length;
  const suspicious =
    // Brief has structure but the Project Overview parsed empty —
    // typically means heading-style drift or the template was
    // rewritten without our field labels.
    (sections > 0 && overviewFields === 0) ||
    // The Doc had no recognised section headers at all.
    sections === 0 ||
    // Most sections fell through to prose — the template's section
    // names probably no longer match SECTION_KIND_BY_TITLE.
    (sections >= 3 && proseFallback >= sections - 1);
  return { sections, overviewFields, crewMembers, proseFallback, suspicious };
}

// Bump whenever parseBriefDoc's output for an unchanged Doc could differ
// (a parser fix, a new section mapping, etc.). It's folded into the
// content-hash key below so a parser change invalidates every stored parse
// - the next cron tick re-parses all briefs with the new code instead of
// short-circuiting on the unchanged Doc hash. (v2: split sections on any
// heading level + strip the must-have-shots fence.)
const PARSER_VERSION = 2;

function hashStructure(doc: unknown): string {
  const docHash = createHash("sha256")
    .update(JSON.stringify(doc))
    .digest("hex");
  return `v${PARSER_VERSION}:${docHash}`;
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
    // Compute health off the stored parse so monitoring stays accurate
    // even when nothing changed since the last sync. Same shape as the
    // "updated" path, so log dashboards don't have to special-case.
    return {
      slug: rec.slug,
      status: "unchanged",
      durationMs: Date.now() - start,
      health: computeHealth(rec.parsedJson),
    };
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
  const health = computeHealth(parsed);
  return {
    slug: rec.slug,
    status: "updated",
    durationMs: Date.now() - start,
    health,
  };
}

// One-line JSON log per sync attempt. Vercel adds the timestamp; we add
// the rest. Used for both the cron loop and the single-slug endpoint so
// log queries don't have to special-case either path. Suspicious parses
// also emit a console.warn so they're filterable as warnings in the
// Vercel log UI without changing the structured log entry.
export function logSyncResult(r: SyncResult): void {
  const payload = {
    slug: r.slug,
    status: r.status,
    durationMs: r.durationMs,
    ...(r.error ? { error: r.error } : {}),
    ...(r.health ? { health: r.health } : {}),
  };
  console.log(`[sync-briefs] ${JSON.stringify(payload)}`);
  if (r.health?.suspicious) {
    console.warn(
      `[sync-briefs] suspicious parse for ${r.slug} — overviewFields=${r.health.overviewFields} sections=${r.health.sections} proseFallback=${r.health.proseFallback}. Likely producer template drift (HEADING_3 misuse / renamed sections / missing field labels).`,
    );
  }
}
