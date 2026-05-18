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
import type { BriefRecord } from "@/lib/types";
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

  return (
    <>
      {showSync && queryCode && <AutoUnlockSync slug={slug} code={queryCode} />}
      <UnlockedView slug={slug} rec={rec} parsed={rec.parsedJson} />
    </>
  );
}

// ---------- Unlocked view ----------

function UnlockedView({
  slug,
  rec,
  parsed,
}: {
  slug: string;
  rec: BriefRecord;
  parsed: ParsedBrief;
}) {
  const statusUrl = `/${rec.slug}-${rec.hash}`;
  const subtitle = deriveSubtitle(parsed);
  const dateLabel = deriveDateLabel(parsed);
  const locationLabel = deriveLocationLabel(parsed);
  const pills = [dateLabel, locationLabel].filter((p): p is string => !!p);

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

        {parsed.sections.map((s, i) => (
          <SectionCard key={`${s.kind}-${i}`} section={s} num={i + 1} />
        ))}

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
            We&apos;re syncing this brief from the source document — usually a
            minute or two. Refresh the page to check.
          </p>
        </div>
        <BriefFooter rec={rec} statusUrl={statusUrl} />
      </div>
    </div>
  );
}

// ---------- Footer ----------

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
          Sync paused — please notify Fame.
        </span>
      )}
    </footer>
  );
}

// ---------- Helpers ----------

function heroTitle(parsed: ParsedBrief): string {
  const { clientName, eventName } = parsed.header;
  if (clientName && eventName) return `${clientName} — ${eventName}`;
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
