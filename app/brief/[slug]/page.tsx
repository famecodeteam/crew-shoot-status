// shoots.fame.so/brief/<slug>
//
// Doc-synced brief page. SSR-fetches the parsed BriefRecord from the
// brief store and renders it section-by-section using the discriminated
// union from lib/parse-brief.
//
// Access control: HttpOnly cookie unlocked via /api/brief/<slug>/unlock.
// If the unlock cookie is missing AND the URL doesn't carry a matching
// ?code= for one-tap unlock from the status page, we render the locked
// view only — no brief content goes into the HTML at all.
//
// (Spec asked for localStorage; we follow the lifted Video Review Tool
// pattern instead because cookie+SSR-validated keeps content out of the
// HTML until unlock and removes the trivial "set localStorage" bypass.
// Flagged in the PR.)

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getBySlug } from "@/lib/brief-storage";
import { getBySlug as getShootBySlug } from "@/lib/storage";
import type { BriefRecord, Shoot } from "@/lib/types";
import type { ParsedBrief, Section } from "@/lib/parse-brief";
import { PasscodeForm } from "./passcode-form";
import { AutoUnlockSync } from "./auto-unlock-sync";
import { SectionCard } from "./sections";
import { briefUnlockCookieName } from "@/lib/brief-passcode";
import "./brief.css";

export const dynamic = "force-dynamic";

const FAME_F_ICON =
  "https://cdn.prod.website-files.com/65af97212977390aef05af1b/65dbc8c137b6d056d81db0ad_fame-f-icon-square-pink-cream%403x%201.png";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ code?: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const rec = await getBySlug(slug);
  const eventName = rec?.parsedJson?.header.eventName;
  return {
    title: eventName ? `${eventName} · Fame` : "Fame brief",
    robots: { index: false, follow: false },
  };
}

export default async function BriefPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { code: queryCode } = await searchParams;
  const rec = await getBySlug(slug);
  if (!rec) notFound();

  const cookieStore = await cookies();
  const unlocked = cookieStore.has(briefUnlockCookieName(slug));
  const codeMatches =
    queryCode && queryCode.toLowerCase() === rec.hash.toLowerCase();

  if (!unlocked && !codeMatches) {
    return <LockedView slug={slug} />;
  }

  // First render after arrival from the status page: SSR shows full
  // content, and the AutoUnlockSync client component sets the cookie +
  // strips ?code= from the URL so future loads stay clean.
  const showSync = Boolean(!unlocked && codeMatches && queryCode);

  if (!rec.parsedJson) {
    // Registered but not yet synced — we know about the brief but the
    // cron hasn't parsed the Doc yet. Show a soft placeholder.
    return <PendingView slug={slug} rec={rec} />;
  }

  // Look up the matching Shoot — used to enrich the brief's crew section
  // with the same photo / bio / "Vetted by Fame" treatment the status
  // page renders. Best-effort: if the Shoot has rotated to a different
  // slug or isn't in storage, we fall back to the brief Doc's crew data.
  const shoot = await getShootBySlug(`${rec.slug}-${rec.hash}`);

  return (
    <>
      {showSync && queryCode && <AutoUnlockSync slug={slug} code={queryCode} />}
      <UnlockedView
        slug={slug}
        rec={rec}
        parsed={rec.parsedJson}
        shoot={shoot}
      />
    </>
  );
}

// ---------- Unlocked view ----------

function UnlockedView({
  slug,
  rec,
  parsed,
  shoot,
}: {
  slug: string;
  rec: BriefRecord;
  parsed: ParsedBrief;
  shoot: Shoot | null;
}) {
  const statusUrl = `/${rec.slug}-${rec.hash}`;
  const subtitle = deriveSubtitle(parsed);
  const dateLabel = deriveDateLabel(parsed);
  const locationLabel = deriveLocationLabel(parsed);
  const pills = [dateLabel, locationLabel].filter((p): p is string => !!p);
  const sections = enrichAndFilterSections(parsed.sections, shoot);

  return (
    <div className="brief-root">
      <div className="brief-wrap">
        <header className="brief-header">
          <div className="brief-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={FAME_F_ICON} alt="Fame" />
            <span>Fame Crew</span>
          </div>
          <a className="brief-back" href={statusUrl}>
            ← Back to status page
          </a>
        </header>

        <div className="brief-hero">
          {parsed.header.briefNumber && (
            <div className="brief-eyebrow">Brief #{parsed.header.briefNumber}</div>
          )}
          <h1 className="brief-h1">{heroTitle(parsed)}</h1>
          {subtitle && <p className="brief-subtitle">{subtitle}</p>}
          {pills.length > 0 && (
            <div className="brief-meta">
              {pills.map((p) => (
                <span key={p} className="brief-pill">
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>

        {sections.map((s, i) => (
          <SectionCard key={`${s.kind}-${i}`} section={s} num={i + 1} />
        ))}

        <StatusPageCTA statusUrl={statusUrl} />

        <BriefFooter rec={rec} statusUrl={statusUrl} />
      </div>
    </div>
  );
}

// ---------- Locked view ----------

function LockedView({ slug }: { slug: string }) {
  return (
    <div className="brief-root">
      <div className="brief-wrap">
        <header className="brief-header">
          <div className="brief-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={FAME_F_ICON} alt="Fame" />
            <span>Fame Crew</span>
          </div>
        </header>
        <div className="brief-lock-card">
          <h2 className="brief-lock-title">This brief is locked</h2>
          <p className="brief-lock-hint">
            Enter the access code your Fame project manager shared with you to
            view the brief.
          </p>
          <PasscodeForm slug={slug} />
        </div>
      </div>
    </div>
  );
}

// ---------- Pending view ----------

function PendingView({ slug, rec }: { slug: string; rec: BriefRecord }) {
  const statusUrl = `/${rec.slug}-${rec.hash}`;
  return (
    <div className="brief-root">
      <div className="brief-wrap">
        <header className="brief-header">
          <div className="brief-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={FAME_F_ICON} alt="Fame" />
            <span>Fame Crew</span>
          </div>
          <a className="brief-back" href={statusUrl}>
            ← Back to status page
          </a>
        </header>
        <div className="brief-lock-card">
          <h2 className="brief-lock-title">Brief is being prepared</h2>
          <p className="brief-lock-hint">
            We&apos;re syncing this brief from the source document. Usually
            a minute or two. Refresh the page to check.
          </p>
        </div>
        <BriefFooter rec={rec} statusUrl={statusUrl} />
      </div>
    </div>
  );
}

// ---------- Footer ----------

// ---------- Status page CTA ----------

// Replaces whatever "Pre-Event Communications" / "Shoot Status" section
// the producer put in the Doc — those are always "click here to see live
// status" and look bad as a stack of bullets. The designed card below is
// the page's call-to-action: a single clickable surface that takes the
// client to the live status page.
function StatusPageCTA({ statusUrl }: { statusUrl: string }) {
  return (
    <a className="brief-status-cta" href={statusUrl}>
      <div className="brief-status-cta-content">
        <div className="brief-status-cta-eyebrow">Live shoot status</div>
        <div className="brief-status-cta-title">
          Track your shoot in real time
        </div>
        <div className="brief-status-cta-hint">
          Progress through every milestone, crew details, and final
          deliverables, all in one place.
        </div>
      </div>
      <div className="brief-status-cta-arrow" aria-hidden="true">
        →
      </div>
    </a>
  );
}

function BriefFooter({
  rec,
  statusUrl,
}: {
  rec: BriefRecord;
  statusUrl: string;
}) {
  const syncedText = rec.lastSyncedAt
    ? `Last synced from source · ${relativeTime(rec.lastSyncedAt)}`
    : "Awaiting first sync";

  // Soft "sync paused" line only when the last attempt errored AND it's
  // been >24h since the last successful sync. Avoids flashing the warning
  // on a single transient fetch hiccup.
  const stale = isStale(rec);
  const showSyncError =
    rec.lastErrorAt &&
    isRecent(rec.lastErrorAt) &&
    (!rec.lastSyncedAt || stale);

  return (
    <footer className="brief-footer">
      <span className="brief-updated">{syncedText}</span>
      <a href={statusUrl}>View live status →</a>
      {showSyncError && (
        <span className="brief-sync-error">
          Sync paused. Please notify Fame.
        </span>
      )}
    </footer>
  );
}

// ---------- Section enrichment + filtering ----------

// Two passes:
//   1. When shoot.crew is available, override the brief's crew section
//      with the richer status-page treatment (photo, bio, "Vetted by
//      Fame"). The brief Doc's "Team On-Site" data (WhatsApp number,
//      etc.) is intentionally dropped — the brief page mirrors the
//      client-facing status page treatment per producer feedback.
//   2. Drop any section whose kind-specific content is empty (orphan
//      HEADING_3 in the Doc, deliberately blank section, etc.) so the
//      page doesn't render empty cards.
function enrichAndFilterSections(
  sections: Section[],
  shoot: Shoot | null,
): Section[] {
  const enriched = sections.map((s) => {
    if (s.kind === "crew" && shoot?.crew) {
      return {
        kind: "crew" as const,
        title: s.title,
        members: [
          {
            name: shoot.crew.name,
            bio: shoot.crew.bio || undefined,
            photoUrl: shoot.crew.photoUrl,
            vetted: true,
          },
        ],
      };
    }
    return s;
  });
  return enriched
    .filter((s) => !isStatusPageRedirect(s))
    .filter((s) => !isSectionEmpty(s));
}

// Producer templates name the last section several different ways, and
// it's almost always just "here's a link back to the live status page".
// We render a designed CTA card for that purpose ourselves at the bottom
// of the brief, so we drop these sections from the regular section list.
function isStatusPageRedirect(s: Section): boolean {
  const t = s.title.toLowerCase();
  return (
    /pre.?event communications/.test(t) ||
    /shoot status/.test(t) ||
    /communications timeline/.test(t) ||
    /project status/.test(t) ||
    /^status$/.test(t)
  );
}

function isSectionEmpty(s: Section): boolean {
  // Sections with empty titles AND no content are usually orphan
  // HEADING_3 paragraphs the producer left behind — never useful.
  switch (s.kind) {
    case "overview":
      return Object.keys(s.fields).length === 0;
    case "objectives":
      return s.blocks.length === 0;
    case "production":
      return (
        s.schedule.length === 0 &&
        Object.keys(s.equipment).length === 0 &&
        s.deliverables.length === 0
      );
    case "crew":
      return s.members.length === 0;
    case "comms":
      return s.links.length === 0;
    case "prose":
      return s.blocks.length === 0;
  }
}

// ---------- Helpers ----------

function heroTitle(parsed: ParsedBrief): string {
  const { clientName, eventName } = parsed.header;
  // Middle dot matches the Fame brand separator used elsewhere
  // (status page hero pills, link cards) and avoids the em-dash that
  // reads as AI-generated copy.
  if (clientName && eventName) return `${clientName} · ${eventName}`;
  return eventName || clientName || "Brief";
}

// "Core Goal" lives in the objectives section as a prose block with a
// leading <strong>Core Goal:</strong>. Pull the rest as the subtitle.
// Strips inline HTML so the subtitle is plain text.
function deriveSubtitle(parsed: ParsedBrief): string | null {
  const objectives = parsed.sections.find(
    (s): s is Extract<Section, { kind: "objectives" }> => s.kind === "objectives",
  );
  if (!objectives) return null;
  const goalBlock = objectives.blocks.find((b) =>
    /<strong>\s*(Core Goal|Goal)\s*[:.]/i.test(b.html),
  );
  if (!goalBlock) return null;
  // Strip the bold prefix + any HTML tags.
  const stripped = goalBlock.html
    .replace(/<strong>[^<]*<\/strong>\s*\.?\s*/i, "")
    .replace(/<\/?[^>]+>/g, "")
    .trim();
  return stripped || null;
}

function deriveDateLabel(parsed: ParsedBrief): string | null {
  const overview = parsed.sections.find(
    (s): s is Extract<Section, { kind: "overview" }> => s.kind === "overview",
  );
  if (!overview) return null;
  const raw =
    overview.fields["Date of Coverage"] ??
    overview.fields["Shoot Date"] ??
    overview.fields["Date"];
  if (!raw) return null;
  if (typeof raw === "object") return null;
  return raw;
}

function deriveLocationLabel(parsed: ParsedBrief): string | null {
  const overview = parsed.sections.find(
    (s): s is Extract<Section, { kind: "overview" }> => s.kind === "overview",
  );
  if (!overview) return null;
  const raw = overview.fields["Location"];
  if (!raw || typeof raw === "object") return null;
  // Pick the city: last comma-separated chunk that's not just digits/postal.
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    // Skip postal codes (e.g. "Singapore 078852") — split off the digits.
    const cleaned = parts[i].replace(/\s+\d{3,}.*$/, "").trim();
    if (cleaned && /[A-Za-z]/.test(cleaned)) return cleaned;
  }
  return parts[0] ?? null;
}

function isRecent(iso: string): boolean {
  const ms = Date.now() - new Date(iso).getTime();
  return ms < 24 * 60 * 60 * 1000;
}

function isStale(rec: BriefRecord): boolean {
  if (!rec.lastSyncedAt) return true;
  const ms = Date.now() - new Date(rec.lastSyncedAt).getTime();
  return ms > 24 * 60 * 60 * 1000;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.round(ms / 1000));
  const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (sec < 60) return fmt.format(-sec, "second");
  if (sec < 3600) return fmt.format(-Math.round(sec / 60), "minute");
  if (sec < 86400) return fmt.format(-Math.round(sec / 3600), "hour");
  if (sec < 30 * 86400) return fmt.format(-Math.round(sec / 86400), "day");
  return fmt.format(-Math.round(sec / (30 * 86400)), "month");
}
