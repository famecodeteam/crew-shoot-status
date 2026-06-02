// POST /api/backfill-briefs
//
// One-shot operational endpoint: iterates every shoot in storage, and
// for each one with a detected brief Doc (shoot.briefUrl set), registers
// the BriefRecord + immediately syncs it. Server-side mirror of
// scripts/backfill-briefs.ts — used when we need to populate the briefs
// store against the production environment (the CLI script writes to
// whatever store the local .env points at, which isn't always prod).
//
// Auth: same CRON_SECRET bearer as the cron route. Idempotent — safe to
// run again (registerBrief no-ops when nothing changed; syncOne hashes
// the Doc and skips if unchanged).

import { NextResponse, type NextRequest } from "next/server";
import { listAll as listShoots } from "@/lib/storage";
import { getBySlug as getBriefBySlug, registerBrief } from "@/lib/brief-storage";
import { extractDocId, shootSlugToBriefSlug } from "@/lib/brief-slug";
import { logSyncResult, syncOne, type SyncResult } from "@/lib/sync-brief";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Vercel Pro: 60s default function timeout on the production tier; bump
// the cap so a single call can chew through ~30+ briefs without truncating.
export const maxDuration = 300;

const TIME_BUDGET_MS = 280_000;

type SkipReason = "no-briefUrl" | "slug-shape" | "doc-id-extract";

type BackfillSummary = {
  totalShoots: number;
  eligible: number;
  skipped: { slug: string; reason: SkipReason }[];
  registered: number;
  alreadyRegistered: number;
  syncs: SyncResult[];
  timedOut: boolean;
};

export async function POST(req: NextRequest) {
  // Accept CRON_SECRET (Vercel cron / CLI), ADMIN_RESYNC_TOKEN (manual), or
  // the shared SYNC_API_SECRET - the last lets the crew portal trigger a
  // re-register after a slug rename orphans a hosted brief. Bearer or ?token=.
  const accepts = [
    process.env.CRON_SECRET,
    process.env.ADMIN_RESYNC_TOKEN,
    process.env.SYNC_API_SECRET,
  ].filter(Boolean) as string[];
  if (accepts.length > 0) {
    const auth = req.headers.get("authorization") ?? "";
    const token = req.nextUrl.searchParams.get("token") ?? "";
    const ok = accepts.some((s) => auth === `Bearer ${s}` || token === s);
    if (!ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const deadline = Date.now() + TIME_BUDGET_MS;
  // Optional single-shoot scope (?cardId= or ?shootNumber=): a slug rename
  // orphans just one brief, so the portal triggers a targeted re-register
  // rather than chewing through every shoot (which would outlast the
  // caller's request timeout). Unscoped = the original full backfill.
  const onlyCard = req.nextUrl.searchParams.get("cardId")?.trim();
  const onlyNum = req.nextUrl.searchParams.get("shootNumber")?.trim();
  const allShoots = await listShoots();
  const shoots =
    onlyCard || onlyNum
      ? allShoots.filter(
          (s) =>
            (!onlyCard || s.cardId === onlyCard) &&
            (!onlyNum || s.shootNumber === onlyNum),
        )
      : allShoots;
  const summary: BackfillSummary = {
    totalShoots: shoots.length,
    eligible: 0,
    skipped: [],
    registered: 0,
    alreadyRegistered: 0,
    syncs: [],
    timedOut: false,
  };

  for (const s of shoots) {
    if (Date.now() > deadline) {
      summary.timedOut = true;
      break;
    }
    if (!s.briefUrl) {
      summary.skipped.push({ slug: s.slug, reason: "no-briefUrl" });
      continue;
    }
    const split = shootSlugToBriefSlug(s.slug);
    if (!split) {
      summary.skipped.push({ slug: s.slug, reason: "slug-shape" });
      continue;
    }
    const docId = extractDocId(s.briefUrl);
    if (!docId) {
      summary.skipped.push({ slug: s.slug, reason: "doc-id-extract" });
      continue;
    }
    summary.eligible++;

    const reg = await registerBrief({
      briefSlug: split.briefSlug,
      hash: split.hash,
      docId,
      cardId: s.cardId,
      shootNumber: s.shootNumber || undefined,
    });
    if (reg.created) summary.registered++;
    else if (!reg.updated) summary.alreadyRegistered++;
    else summary.registered++;

    const rec = await getBriefBySlug(split.briefSlug);
    if (!rec) {
      // Shouldn't happen — register-then-read is sequential, but log
      // and continue defensively.
      console.warn(`[backfill-briefs] missing record after register: ${split.briefSlug}`);
      continue;
    }

    // Backfill is the "definitely re-parse everything" path — it's
    // typically invoked after a parser change, so we want to bypass
    // syncOne's content-hash short-circuit. Pass an empty hash + null
    // parsedJson so syncOne always re-parses + writes back.
    const forced = { ...rec, lastContentHash: null, parsedJson: null };
    const result = await syncOne(forced);
    logSyncResult(result);
    summary.syncs.push(result);
  }

  return NextResponse.json({ ok: true, summary });
}
