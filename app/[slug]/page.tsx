import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getBySlug } from "@/lib/storage";
import { getBySlug as getBriefBySlug } from "@/lib/brief-storage";
import { shootSlugToBriefSlug } from "@/lib/brief-slug";
import { getAssetsForShoot } from "@/lib/asset-storage";
import { clientVersions } from "@/lib/asset-versions";
import type { Asset, AssetVersion, Shoot } from "@/lib/types";
import { statusLabel } from "@/lib/list-mapping";
import { getDemoShoot, getJustBookedDemoShoot } from "./demo-data";
import { LiveMoments } from "./live-moments";
import { WelcomeSync } from "./welcome-sync";
import { currentStepIndex, timelineSteps } from "./status";

// Re-fetch on every request - we want ≤60s lag from a Trello move.
// (When we add Vercel KV in M5, swap to `revalidate = 30` for ISR.)
export const dynamic = "force-dynamic";

const FAME_LOGO_URL =
  "https://cdn.prod.website-files.com/65af97212977390aef05af1b/65bcbe23cfb0eb14d2ce0063_logo.svg";

// Client-facing "Questions?" contact - always the shared inbox, never an
// individual producer's personal address. Emails already do this (Reply-To
// routes to the crew@fame.so Google Group, see lib/emails/questions-cta.tsx);
// this brings the status pages in line so no personal address is exposed.
const SHARED_CREW_EMAIL = "crew@fame.so";

async function loadShoot(slug: string, justBooked = false): Promise<Shoot | null> {
  if (slug === "demo") return justBooked ? getJustBookedDemoShoot() : getDemoShoot();
  return getBySlug(slug);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const shoot = await loadShoot(slug);
  if (!shoot) return { title: "Fame Crew" };
  return { title: `Fame Crew - Shoot Status - ${shoot.shootNumber}` };
}

export default async function ShootPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { slug } = await params;
  const { welcome } = await searchParams;
  const showWelcome = welcome === "1";

  const shoot = await loadShoot(slug, showWelcome);

  // Resolved via an old/previous slug → send them to the canonical URL so the
  // address bar (and any reshare) uses the current slug.
  if (shoot && slug !== "demo" && shoot.slug !== slug) {
    redirect(`/${shoot.slug}${showWelcome ? "?welcome=1" : ""}`);
  }

  // If the shoot hasn't synced yet but the client just paid, show a
  // "Booking confirmed" holding page instead of a jarring 404. The cron
  // runs every 5 minutes so this window is short.
  if (!shoot) {
    if (showWelcome) {
      return <BookingConfirmedHolding />;
    }
    notFound();
  }

  // Assets - empty unless the editor has pushed at least one finished
  // version. Skip the lookup for the demo slug (no real cardId).
  const assets = slug === "demo" ? [] : await getAssetsForShoot(shoot.cardId);

  // Brief page link - points at /brief/<briefSlug>?code=<shoot number>
  // for one-tap auto-unlock. Hidden until the brief has actually been
  // synced (parsedJson present); otherwise the link would land the
  // client on the "Brief is being prepared" placeholder. `unready` covers
  // a synced-but-unfinished doc (producer never replaced the template's
  // "[[Project Name]]" / "#XXXX" placeholders) - in that case we hide the
  // Brief card entirely rather than exposing the raw Doc fallback below.
  const { href: briefHref, unready: briefUnready } =
    slug === "demo" ? { href: null, unready: false } : await resolveBriefStatus(slug);

  return (
    <ShootView
      shoot={shoot}
      assets={assets}
      shootSlug={slug}
      briefHref={briefHref}
      briefUnready={briefUnready}
      showWelcome={showWelcome}
    />
  );
}

const FAME_LOGO_URL_HOLDING =
  "https://cdn.prod.website-files.com/65af97212977390aef05af1b/65bcbe23cfb0eb14d2ce0063_logo.svg";

function BookingConfirmedHolding() {
  return (
    <main className="shell">
      <header className="hero">
        <div className="hero-top">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="hero-logo" src={FAME_LOGO_URL_HOLDING} alt="Fame" />
        </div>
        <h1 className="hero-title">Booking confirmed</h1>
      </header>
      <div className="welcome-banner" role="status">
        <div className="welcome-banner-title">🎉 Booking confirmed - thank you!</div>
        <p>
          Your deposit has been received and your booking is confirmed. We&apos;re now
          sourcing your crew - this page will update as things progress.
        </p>
        <p style={{ marginTop: "10px" }}>
          Your status page is being set up and will be ready in a few minutes. Bookmark
          this page and check back shortly.
        </p>
      </div>
    </main>
  );
}

// A doc counts as "unready" when its title still carries the template's
// placeholder tokens - producers duplicate the template Doc and sometimes
// never rename it away from "Brief #XXXX - Client - [[Project Name]]"
// before the sync/parse cron picks it up. A real client name/event name
// would never contain a literal "[[...]]" bracket pair or a bare "XXXX"
// brief number, so this is a safe, generic signal.
function looksLikeUnfinishedTemplate(header: {
  briefNumber: string;
  clientName: string;
  eventName: string;
}): boolean {
  const hasPlaceholderBrackets = (s: string) => /\[\[.*?\]\]/.test(s);
  return (
    hasPlaceholderBrackets(header.eventName) ||
    hasPlaceholderBrackets(header.clientName) ||
    /^x+$/i.test(header.briefNumber.trim())
  );
}

async function resolveBriefStatus(
  shootSlug: string,
): Promise<{ href: string | null; unready: boolean }> {
  const split = shootSlugToBriefSlug(shootSlug);
  if (!split) return { href: null, unready: false };
  const rec = await getBriefBySlug(split.briefSlug);
  if (!rec?.parsedJson) return { href: null, unready: false };
  if (looksLikeUnfinishedTemplate(rec.parsedJson.header)) {
    return { href: null, unready: true };
  }
  return { href: `/brief/${split.briefSlug}`, unready: false };
}

function ShootView({
  shoot,
  assets,
  shootSlug,
  briefHref,
  briefUnready,
  showWelcome,
}: {
  shoot: Shoot;
  assets: Asset[];
  shootSlug: string;
  briefHref: string | null;
  briefUnready: boolean;
  showWelcome: boolean;
}) {
  const steps = timelineSteps(shoot.hasPostProduction);
  const stepIdx = currentStepIndex(shoot.status, shoot.hasPostProduction);
  const isOnHold = shoot.status === "on-hold";
  const isDelivered = shoot.status === "delivered";
  // Footage section gate. The footageUrl alone isn't sufficient because
  // member.fame.so can pre-generate a hashed URL for the shoot folder
  // before any files are uploaded - which would surface a "Browse your
  // footage" card on shoots that haven't even happened yet. We require
  // the shoot to have at least reached "Shoot Complete" so the URL is
  // only shown once footage actually has a chance of being there.
  const footageAvailable =
    shoot.status === "shoot-complete" ||
    shoot.status === "in-editing" ||
    shoot.status === "assets-ready" ||
    shoot.status === "delivered";
  // Crew card appears once we've crossed the "Crew confirmed" milestone
  // (i.e. stepIdx is 2 or higher - booking-confirmed and searching-for-crew
  // both sit at stepIdx=1, working toward crew confirmation).
  const showCrew = stepIdx >= 2 && shoot.crew && !isOnHold;
  const countdown = formatCountdown(shoot.shootDate, isDelivered);

  // M7 feed-through: live crew status from member.fame.so taps.
  const liveBanner = pickLiveBanner(shoot, isOnHold);
  // "Shoot wrapped" supersedes the list-derived badge BETWEEN shoot day and
  // the first delivery state. Once the card moves into editing/delivered,
  // the existing badge text takes over.
  const wrappedOverridesBadge =
    shoot.crewStatus === "Wrapped" &&
    !isOnHold &&
    (shoot.status === "booking-confirmed" ||
      shoot.status === "searching-for-crew" ||
      shoot.status === "crew-confirmed" ||
      shoot.status === "ready-for-shoot" ||
      shoot.status === "shoot-complete");
  // Asset-aware hero badge: once a shoot has real (uploaded) assets, the
  // aggregate review state is the truth - it supersedes both the Trello
  // status label and the "Shoot wrapped" override. on-hold keeps its own
  // dedicated badge + styling and is never overridden.
  const assetBadge = isOnHold ? null : assetReviewBadge(assets);
  // Compute the status label fresh on every render, off shoot.status +
  // hasPostProduction - so a label-logic change (e.g. crew-only rename of
  // "In editing" -> "Delivering footage") takes effect immediately on
  // deploy without waiting for each card's next webhook event to refresh
  // the stored Shoot.statusLabel.
  const liveStatusLabel = statusLabel(
    shoot.status,
    shoot.crew?.name.split(/\s+/)[0],
    shoot.hasPostProduction,
  );
  const badgeText = assetBadge
    ? assetBadge.label
    : wrappedOverridesBadge
      ? "Shoot wrapped"
      : liveStatusLabel;

  let badgeClass = "status-badge";
  if (isOnHold) {
    badgeClass += " on-hold";
  } else if (assetBadge) {
    // "All assets approved" gets the green done-state styling; the active
    // states ("Awaiting your review" / "Changes in progress") keep the
    // default pink attention badge.
    if (assetBadge.tone === "done") badgeClass += " delivered";
  } else if (isDelivered) {
    badgeClass += " delivered";
  }

  return (
    <main className="shell">
      {showWelcome && <WelcomeSync />}
      {showWelcome && (
        <div className="welcome-banner" role="status">
          <div className="welcome-banner-title">🎉 Booking confirmed - thank you!</div>
          <p>
            Your deposit has been received and your booking is confirmed. We&apos;re now
            sourcing your crew - this page will update as things progress.
          </p>
          <p style={{ marginTop: "10px" }}>
            Bookmark this page to check back anytime.
          </p>
        </div>
      )}
      <header className="hero">
        <div className="hero-top">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="hero-logo" src={FAME_LOGO_URL} alt="Fame" />
        </div>
        <div className="hero-shoot-no">Shoot {shoot.shootNumber}</div>
        <h1 className="hero-title">{shoot.clientName}</h1>
        {/* Key facts as rounded chips, mirroring the quote page hero.
            Built from whichever parts exist so a missing date leaves no
            empty chip. */}
        <div className="hero-pills">
          {[shoot.shootType, shoot.location, formatDate(shoot.shootDate), countdown]
            .filter((part): part is string => Boolean(part))
            .map((part, i) => (
              <span key={i} className="hero-pill">
                {part}
              </span>
            ))}
        </div>
        <span className={badgeClass}>{badgeText}</span>
      </header>

      {liveBanner && (
        <div className="live-banner" role="status" aria-live="polite">
          <span className="live-dot" aria-hidden="true" />
          <span>{liveBanner}</span>
        </div>
      )}

      {isOnHold ? (
        <section className="section">
          <div className="on-hold-notice">
            This project is currently on hold. Your Fame producer will be in touch.
          </div>
        </section>
      ) : (
        <section className="section">
          <div className="card-h">Progress</div>
          <ol
            className="timeline"
            style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}
          >
            {steps.map((label, i) => {
              const stepDate = formatStepDate(shoot, i, steps.length);
              return (
                <li
                  key={label}
                  className={
                    "step " + (i < stepIdx ? "done" : i === stepIdx ? "current" : "")
                  }
                >
                  <div className="step-dot">{i < stepIdx ? "✓" : i + 1}</div>
                  <div className="step-label">{label}</div>
                  {stepDate && <div className="step-date">{stepDate}</div>}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {!isOnHold && assets.length > 0 && (
        <FinalAssetsSection assets={assets} shootSlug={shootSlug} />
      )}

      {!isOnHold && shoot.footageUrl && footageAvailable && (
        <section className="section">
          <div className="card-h">Footage</div>
          <div className="link-grid">
            <a
              className="link-card"
              href={shoot.footageUrl}
              target="_blank"
              rel="noreferrer"
            >
              <div className="link-card-tile">🎞️</div>
              <div className="link-card-body">
                <div className="link-card-label">All footage</div>
                <div className="link-card-text">Browse your raw files</div>
              </div>
              <div className="link-card-arrow">→</div>
            </a>
          </div>
        </section>
      )}

      {!isOnHold && (
        <LiveMoments slug={shoot.slug} shootDate={shoot.shootDate} />
      )}

      {showCrew && shoot.crew && (
        <section className="section">
          <div className="card-h">Your crew</div>
          <div className="card crew-card">
            <div className="crew-photo">
              {shoot.crew.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shoot.crew.photoUrl} alt={shoot.crew.name} />
              ) : (
                shoot.crew.name.charAt(0)
              )}
            </div>
            <div>
              <div className="crew-name">{shoot.crew.name}</div>
              <div className="crew-bio">{shoot.crew.bio}</div>
              <div className="crew-chips">
                <span className="crew-chip vetted">✓ Vetted by Fame</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/*
        Brief link href, with graceful fallback:
        - If a synced BriefRecord exists, link to the new /brief/[slug]
          page (briefHref is set by the page loader).
        - Otherwise, fall back to the Google Doc URL detected by
          findShootDriveLinks during the Trello webhook. The new page
          will take over automatically on the next cron tick once the
          brief is registered + synced.
        - briefUnready skips BOTH of the above - the Doc itself still has
          the template's "[[Project Name]]" / "#XXXX" placeholders (the
          producer duplicated the template but never renamed it), so the
          raw-Doc fallback would be just as broken as the parsed page.
      */}
      {/* Quick links (Documents + Payments merged into one scannable row
          with icon tiles). Each entry is added only when its link exists,
          so the grid never shows an empty slot. */}
      {(() => {
        const briefLinkHref = briefUnready
          ? null
          : (briefHref ?? shoot.briefUrl ?? null);
        const links: { key: string; icon: string; label: string; text: string; href: string }[] = [];
        if (briefLinkHref)
          links.push({ key: "brief", icon: "📄", label: "Brief", text: "View your brief", href: briefLinkHref });
        if (shoot.quoteUrl)
          links.push({ key: "quote", icon: "🧾", label: "Quote", text: "View your quote", href: shoot.quoteUrl });
        if (!isOnHold && shoot.depositReceiptUrl)
          links.push({ key: "deposit", icon: "💳", label: "Deposit", text: "View receipt", href: shoot.depositReceiptUrl });
        if (!isOnHold && shoot.balanceReceiptUrl)
          links.push({ key: "balance", icon: "💳", label: "Balance", text: "View receipt", href: shoot.balanceReceiptUrl });
        if (links.length === 0) return null;
        return (
          <section className="section">
            <div className="card-h">Quick links</div>
            <div className={`link-grid${links.length >= 3 ? " cols-3" : ""}`}>
              {links.map((l) => (
                <a
                  key={l.key}
                  className="link-card"
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  <div className="link-card-tile">{l.icon}</div>
                  <div className="link-card-body">
                    <div className="link-card-label">{l.label}</div>
                    <div className="link-card-text">{l.text}</div>
                  </div>
                  <div className="link-card-arrow">→</div>
                </a>
              ))}
            </div>
          </section>
        );
      })()}

      {/* Feedback prompt. Visible once the shoot is delivered - the
          last impactful thing the client sees on the page after
          they've browsed their deliverables. Links to /feedback/<slug>
          which is also the primary CTA on the delivered milestone
          email. */}
      {isDelivered && (
        <section className="section">
          <div className="card feedback-prompt-card">
            <div className="card-h">How did we do?</div>
            <p className="feedback-prompt-text">
              Tell us how the shoot went - 60 seconds, optional
              fields, honest answers welcome.
            </p>
            <Link
              href={`/feedback/${shoot.slug}`}
              className="feedback-prompt-btn"
            >
              Share your feedback →
            </Link>
          </div>
        </section>
      )}

      <footer className="footer">
        <div>
          Questions? Email{" "}
          <a href={`mailto:${SHARED_CREW_EMAIL}`}>{SHARED_CREW_EMAIL}</a>
          {shoot.clientWhatsappUrl && (
            <>
              {" "}or{" "}
              <a href={shoot.clientWhatsappUrl} target="_blank" rel="noreferrer">
                message us on WhatsApp
              </a>
            </>
          )}.
        </div>
        <div>Fame Crew</div>
      </footer>
    </main>
  );
}

function formatDate(iso: string): string {
  // Shoots can have no date yet (e.g. an on-hold card). Return "" rather
  // than letting `new Date("T00:00:00")` render the literal "Invalid Date".
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ---------- "Your final assets" section ----------

function FinalAssetsSection({
  assets,
  shootSlug,
}: {
  assets: Asset[];
  shootSlug: string;
}) {
  const s = summarizeAssets(assets);
  const total = assets.length;
  // "Waiting on you" = the client's own to-do: fresh videos to review plus
  // any new version that landed after their last decision. Changes-requested
  // is Fame's to-do, not theirs, so it's excluded from the nudge.
  const waiting = s.review + s.newver;
  const pct = (n: number) => (total ? (n / total) * 100 : 0);

  return (
    <section className="section">
      <div className="card-h">Your final assets</div>
      <div className="assets-summary">
        <div className="assets-summary-top">
          <div className="assets-summary-count">
            {total}{" "}
            <span>
              {total === 1 ? "video" : "videos"}
              {waiting > 0 && ` · ${waiting} waiting on you`}
            </span>
          </div>
          {waiting > 0 && (
            <span className="assets-summary-nudge">
              ▸ Review {waiting} {waiting === 1 ? "video" : "videos"}
            </span>
          )}
        </div>
        <div className="assets-progress" aria-hidden="true">
          {s.review > 0 && (
            <div className="assets-progress-bar review" style={{ width: `${pct(s.review)}%` }} />
          )}
          {s.newver > 0 && (
            <div className="assets-progress-bar newver" style={{ width: `${pct(s.newver)}%` }} />
          )}
          {s.changes > 0 && (
            <div className="assets-progress-bar changes" style={{ width: `${pct(s.changes)}%` }} />
          )}
          {s.approved > 0 && (
            <div className="assets-progress-bar approved" style={{ width: `${pct(s.approved)}%` }} />
          )}
        </div>
        <div className="assets-legend">
          {s.review > 0 && (
            <span><i style={{ background: "var(--pink)" }} />{s.review} awaiting your review</span>
          )}
          {s.newver > 0 && (
            <span><i style={{ background: "#1fb4fd" }} />{s.newver} new version ready</span>
          )}
          {s.changes > 0 && (
            <span><i style={{ background: "var(--review-accent)" }} />{s.changes} changes in progress</span>
          )}
          {s.approved > 0 && (
            <span><i style={{ background: "var(--success-accent)" }} />{s.approved} approved</span>
          )}
          {s.editing > 0 && (
            <span><i style={{ background: "var(--marker-muted)" }} />{s.editing} in editing</span>
          )}
        </div>
      </div>
      <div className="assets-list">
        {assets.map((a) => (
          <AssetCard key={a.slug} asset={a} shootSlug={shootSlug} />
        ))}
      </div>
    </section>
  );
}

function AssetCard({ asset, shootSlug }: { asset: Asset; shootSlug: string }) {
  // Publish gate (contract v2 §4): card meta reflects only versions the
  // client may see.
  const versions = clientVersions(asset);
  const latest = versions.length ? versions[versions.length - 1] : null;
  const pill = pickAssetPill(asset);
  const posterUrl = assetPosterUrl(latest);
  return (
    <Link className="asset-card" href={`/${shootSlug}/asset/${asset.slug}`}>
      <div className="asset-poster">
        {posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={posterUrl} alt="" loading="lazy" />
        ) : (
          <div className="asset-poster-glow" />
        )}
        <span className="asset-play" aria-hidden="true" />
      </div>
      <div className="asset-card-body">
        <div className="asset-card-name">{asset.name}</div>
        <div className="asset-card-meta">
          {latest
            ? `v${versions.length} · uploaded ${formatShortDateOrToday(latest.uploadedAt)}`
            : "Editing in progress"}
        </div>
        <span className={`asset-card-pill ${pill.cls}`}>{pill.label}</span>
      </div>
    </Link>
  );
}

// Cloudflare Stream still for the client-facing poster. Only when the
// version's Stream copy is `ready` (the sync-stream cron populates it after
// upload); otherwise the card shows the dark gradient fallback. Same
// customer-code + thumbnail path the review player uses.
function assetPosterUrl(v: AssetVersion | null): string | null {
  const code = process.env.CF_STREAM_CUSTOMER_CODE;
  if (!v || !code || v.streamStatus !== "ready" || !v.streamUid) return null;
  // time=3s: Cloudflare Stream's default still is time=0s, which is almost
  // always the black fade-in - every gallery card came back a dark rectangle.
  // A few seconds in lands on real footage (clamped to the last frame for
  // very short clips), so the posters actually show the video.
  //
  // Size by WIDTH, not height: a portrait 9:16 clip at height=400 is only
  // ~224px wide, so object-fit:cover stretched it across the card and it
  // looked blurry. width=900 gives both orientations enough pixels to stay
  // crisp on a retina card.
  return `https://customer-${code}.cloudflarestream.com/${v.streamUid}/thumbnails/thumbnail.jpg?time=3s&width=900`;
}

function pickAssetPill(a: Asset): { label: string; cls: string } {
  // Publish gate (contract v2 §4): an unpublished version must not move
  // the pill off "Pending upload" or surface a "new version".
  const versions = clientVersions(a);
  if (versions.length === 0) {
    // No publishable version yet - frame it as in-progress editing
    // rather than an upload-pipeline state ("Pending upload" was
    // crew-facing language; the client only cares that work is happening).
    return { label: "Editing in progress", cls: "pending" };
  }
  // Stale decision: a newer version has landed since the client's last
  // approve / request-changes decision. Surface it as "new version ready"
  // rather than the now-outdated "Approved" / "Changes requested".
  const latest = versions[versions.length - 1];
  if (a.approval && latest.n > a.approval.onVersion) {
    return { label: "New version ready", cls: "comments-open" };
  }
  switch (a.approval?.status) {
    case "approved":
      return { label: "Approved", cls: "approved" };
    case "changes_requested":
      return { label: "Changes requested", cls: "changes-requested" };
    case "comments_open":
      return { label: "Comments open", cls: "comments-open" };
    case "pending":
    default:
      // Client hasn't engaged yet - this pill is a call to action, so it
      // gets the bold "needs-review" treatment, not the muted grey of
      // "Pending upload" (which is on the editor, not the client).
      return { label: "Pending review", cls: "needs-review" };
  }
}

// Aggregate the per-asset review states into a single hero-badge signal.
// Once a shoot has real (uploaded) assets, this supersedes the Trello-list
// status label: the list reflects the project phase the PM controls, but
// the badge should tell the client the truth about where review actually
// stands - otherwise it can claim "Assets ready for review" while the
// client has already requested changes.
//
// Action-first priority (per the product call): anything that needs the
// client wins, then anything Fame is revising, then the all-approved end
// state. Returns null when the assets can't speak for the badge yet (none
// uploaded), so the caller falls back to the Trello status label.
function assetReviewBadge(
  assets: Asset[],
): { label: string; tone: "action" | "progress" | "done" } | null {
  if (assets.length === 0) return null;

  let needsClient = 0; // pending review, new version ready, or comments open
  let changesRequested = 0;
  let approved = 0;
  let pendingUpload = 0;

  for (const a of assets) {
    // Publish gate (contract v2 §4): the badge reflects only
    // client-visible versions - an unpublished cut must not flip it.
    const versions = clientVersions(a);
    if (versions.length === 0) {
      pendingUpload++;
      continue;
    }
    const latest = versions[versions.length - 1];
    if (a.approval && latest.n > a.approval.onVersion) {
      // A newer cut landed since the client's last decision - back to them.
      needsClient++;
      continue;
    }
    switch (a.approval?.status) {
      case "approved":
        approved++;
        break;
      case "changes_requested":
        changesRequested++;
        break;
      case "comments_open":
      case "pending":
      default:
        needsClient++;
        break;
    }
  }

  if (needsClient > 0) return { label: "Awaiting your review", tone: "action" };
  if (changesRequested > 0)
    return { label: "Changes in progress", tone: "progress" };
  // Nothing waiting on the client, nothing being revised. Only call it
  // "approved" when every asset is uploaded AND approved - a mix of
  // approved + not-yet-uploaded is still mid-delivery, so defer to Trello.
  if (approved > 0 && pendingUpload === 0)
    return { label: "All assets approved", tone: "done" };
  return null;
}

// Bucket every asset by the SAME rule as its card pill (pickAssetPill), so
// the summary bar + legend can never disagree with the pills below them:
//   review  - "Pending review" (client hasn't engaged with the latest version)
//   newver  - "New version ready" / "Comments open"
//   changes - "Changes requested"
//   approved
//   editing - no publishable version yet ("Editing in progress")
function summarizeAssets(assets: Asset[]) {
  const c = { review: 0, newver: 0, changes: 0, approved: 0, editing: 0 };
  for (const a of assets) {
    switch (pickAssetPill(a).cls) {
      case "approved": c.approved++; break;
      case "changes-requested": c.changes++; break;
      case "comments-open": c.newver++; break;
      case "needs-review": c.review++; break;
      default: c.editing++; break; // "pending" = editing in progress
    }
  }
  return c;
}

function formatShortDateOrToday(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) return "today";
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

// Crew-status banner copy. Returns null when no banner should render -
// includes the empty-status, on-hold, and "Wrapped" cases (Wrapped is
// surfaced via the badge override, not here).
function pickLiveBanner(shoot: Shoot, isOnHold: boolean): string | null {
  if (isOnHold) return null;
  switch (shoot.crewStatus) {
    case "On site":
      return shoot.location
        ? `Your crew is on site at ${shoot.location}`
        : "Your crew is on site";
    case "Wrapping":
      return "Your crew is wrapping up";
    case "On the way":
      // Recommended display says "pre-shoot-day shoots: hide" - only show
      // when the shoot date is today.
      return isShootDayToday(shoot.shootDate) ? "Your crew is on the way" : null;
    default:
      return null;
  }
}

function isShootDayToday(shootDate: string): boolean {
  if (!shootDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(shootDate + "T00:00:00");
  if (Number.isNaN(target.getTime())) return false;
  target.setHours(0, 0, 0, 0);
  return today.getTime() === target.getTime();
}

// Short date for the timeline ("5 May" or "5 May 2027" if cross-year).
function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

// If a projected (not actual) delivery date has already slipped into the
// past, nudge the displayed date forward to tomorrow. Done in UTC to match
// how YYYY-MM-DD strings parse. Display-only: the underlying
// projectedDeliveredDate isn't mutated, so each new day the rendered
// "Expected" date moves forward by one - keeping the timeline credible
// even when the Trello-derived projection hasn't been updated.
function nudgeExpectedDate(iso: string): string {
  const now = new Date();
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const projected = new Date(iso);
  if (projected >= todayUtc) return iso;
  const tomorrow = new Date(todayUtc);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const y = tomorrow.getUTCFullYear();
  const mo = String(tomorrow.getUTCMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

// Decide which date string (if any) sits under each timeline step.
// totalSteps differs for PP shoots (5) vs crew-only (4) - the meaning of
// each index shifts when "In editing" is absent.
function formatStepDate(shoot: Shoot, idx: number, totalSteps: number): string {
  const pp = totalSteps === 5;
  const m = shoot.milestoneDates;

  // Step 0: Booking confirmed (always)
  if (idx === 0) return m.bookingConfirmed ? formatShortDate(m.bookingConfirmed) : "";

  // Step 1: Crew confirmed (always)
  if (idx === 1) return m.crewConfirmed ? formatShortDate(m.crewConfirmed) : "";

  // Step 2: Shoot day - the shoot date custom field, past or future.
  if (idx === 2) return shoot.shootDate ? formatShortDate(shoot.shootDate) : "";

  if (pp) {
    // Step 3 (PP): In editing - past date only; no future ETA shown.
    if (idx === 3) return m.inEditing ? formatShortDate(m.inEditing) : "";
    // Step 4 (PP): Delivered - actual date if reached, else projected ETA.
    if (idx === 4) {
      if (m.delivered) return formatShortDate(m.delivered);
      if (shoot.projectedDeliveredDate)
        return `Expected ${formatShortDate(nudgeExpectedDate(shoot.projectedDeliveredDate))}`;
      return "";
    }
  } else {
    // Step 3 (non-PP): Delivered - same logic.
    if (idx === 3) {
      if (m.delivered) return formatShortDate(m.delivered);
      if (shoot.projectedDeliveredDate)
        return `Expected ${formatShortDate(nudgeExpectedDate(shoot.projectedDeliveredDate))}`;
      return "";
    }
  }
  return "";
}

function formatCountdown(iso: string, delivered: boolean): string | null {
  if (delivered) return "completed";
  // No date set yet - no countdown to show (don't render "NaN days ago").
  if (!iso) return null;
  const target = new Date(iso + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays > 1) return `in ${diffDays} days`;
  if (diffDays === -1) return "yesterday";
  return `${Math.abs(diffDays)} days ago`;
}
