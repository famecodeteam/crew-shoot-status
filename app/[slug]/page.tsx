import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBySlug } from "@/lib/storage";
import type { Shoot } from "@/lib/types";
import { getDemoShoot } from "./demo-data";
import { currentStepIndex, timelineSteps } from "./status";

// Re-fetch on every request — we want ≤60s lag from a Trello move.
// (When we add Vercel KV in M5, swap to `revalidate = 30` for ISR.)
export const dynamic = "force-dynamic";

const FAME_LOGO_URL =
  "https://cdn.prod.website-files.com/65af97212977390aef05af1b/65bcbe23cfb0eb14d2ce0063_logo.svg";

async function loadShoot(slug: string): Promise<Shoot | null> {
  if (slug === "demo") return getDemoShoot();
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

export default async function ShootPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shoot = await loadShoot(slug);
  if (!shoot) notFound();

  return <ShootView shoot={shoot} />;
}

function ShootView({ shoot }: { shoot: Shoot }) {
  const steps = timelineSteps(shoot.hasPostProduction);
  const stepIdx = currentStepIndex(shoot.status, shoot.hasPostProduction);
  const isOnHold = shoot.status === "on-hold";
  const isDelivered = shoot.status === "delivered";
  // Crew card appears once we've crossed the "Crew confirmed" milestone
  // (i.e. stepIdx is 2 or higher — booking-confirmed and searching-for-crew
  // both sit at stepIdx=1, working toward crew confirmation).
  const showCrew = stepIdx >= 2 && shoot.crew && !isOnHold;
  // Final assets render at the last step. Index varies by timeline length.
  const finalStepIdx = steps.length - 1;
  const showAssets = stepIdx >= finalStepIdx && shoot.finalAssetsUrl && !isOnHold;
  const countdown = formatCountdown(shoot.shootDate, isDelivered);

  return (
    <main className="shell">
      <header className="hero">
        <div className="hero-top">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="hero-logo" src={FAME_LOGO_URL} alt="Fame" />
        </div>
        <div className="hero-shoot-no">Shoot {shoot.shootNumber}</div>
        <h1 className="hero-title">{shoot.clientName}</h1>
        <div className="hero-meta">
          {shoot.shootType && (
            <>
              <span>{shoot.shootType}</span>
              <span className="hero-meta-sep">·</span>
            </>
          )}
          {shoot.location && (
            <>
              <span>{shoot.location}</span>
              <span className="hero-meta-sep">·</span>
            </>
          )}
          <span>{formatDate(shoot.shootDate)}</span>
          {countdown && (
            <>
              <span className="hero-meta-sep">·</span>
              <span>{countdown}</span>
            </>
          )}
        </div>
        <span
          className={
            "status-badge" + (isDelivered ? " delivered" : isOnHold ? " on-hold" : "")
          }
        >
          {shoot.statusLabel}
        </span>
      </header>

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
              <div className="crew-trust">Vetted by Fame</div>
            </div>
          </div>
        </section>
      )}

      {(shoot.briefUrl || shoot.quoteUrl) && (
        <section className="section">
          <div className="card-h">Documents</div>
          <div className="link-grid">
            {shoot.briefUrl && (
              <a className="link-card" href={shoot.briefUrl} target="_blank" rel="noreferrer">
                <div>
                  <div className="link-card-label">Brief</div>
                  <div className="link-card-text">View your brief</div>
                </div>
                <div className="link-card-arrow">→</div>
              </a>
            )}
            {shoot.quoteUrl && (
              <a className="link-card" href={shoot.quoteUrl} target="_blank" rel="noreferrer">
                <div>
                  <div className="link-card-label">Quote</div>
                  <div className="link-card-text">View your quote</div>
                </div>
                <div className="link-card-arrow">→</div>
              </a>
            )}
          </div>
        </section>
      )}

      {(shoot.depositReceiptUrl || shoot.balanceReceiptUrl) && !isOnHold && (
        <section className="section">
          <div className="card-h">Payments</div>
          <div className="link-grid">
            {shoot.depositReceiptUrl && (
              <a
                className="link-card"
                href={shoot.depositReceiptUrl}
                target="_blank"
                rel="noreferrer"
              >
                <div>
                  <div className="link-card-label">Deposit</div>
                  <div className="link-card-text">View receipt</div>
                </div>
                <div className="link-card-arrow">→</div>
              </a>
            )}
            {shoot.balanceReceiptUrl && (
              <a
                className="link-card"
                href={shoot.balanceReceiptUrl}
                target="_blank"
                rel="noreferrer"
              >
                <div>
                  <div className="link-card-label">Balance</div>
                  <div className="link-card-text">View receipt</div>
                </div>
                <div className="link-card-arrow">→</div>
              </a>
            )}
          </div>
        </section>
      )}

      {showAssets && shoot.finalAssetsUrl && (
        <section className="section">
          <div className="card-h">Delivery</div>
          <a className="assets-cta" href={shoot.finalAssetsUrl} target="_blank" rel="noreferrer">
            <div>
              <div className="assets-cta-title">Your assets are ready</div>
              <div className="assets-cta-sub">Open your final video files</div>
            </div>
            <div className="assets-cta-arrow">→</div>
          </a>
        </section>
      )}

      <footer className="footer">
        <div>
          Questions? Email{" "}
          <a href={`mailto:${shoot.producerEmail}`}>{shoot.producerEmail}</a>.
        </div>
        <div>Fame Crew</div>
      </footer>
    </main>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
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

// Decide which date string (if any) sits under each timeline step.
// totalSteps differs for PP shoots (5) vs crew-only (4) — the meaning of
// each index shifts when "In editing" is absent.
function formatStepDate(shoot: Shoot, idx: number, totalSteps: number): string {
  const pp = totalSteps === 5;
  const m = shoot.milestoneDates;

  // Step 0: Booking confirmed (always)
  if (idx === 0) return m.bookingConfirmed ? formatShortDate(m.bookingConfirmed) : "";

  // Step 1: Crew confirmed (always)
  if (idx === 1) return m.crewConfirmed ? formatShortDate(m.crewConfirmed) : "";

  // Step 2: Shoot day — the shoot date custom field, past or future.
  if (idx === 2) return shoot.shootDate ? formatShortDate(shoot.shootDate) : "";

  if (pp) {
    // Step 3 (PP): In editing — past date only; no future ETA shown.
    if (idx === 3) return m.inEditing ? formatShortDate(m.inEditing) : "";
    // Step 4 (PP): Delivered — actual date if reached, else projected ETA.
    if (idx === 4) {
      if (m.delivered) return formatShortDate(m.delivered);
      if (shoot.projectedDeliveredDate)
        return `Expected ${formatShortDate(shoot.projectedDeliveredDate)}`;
      return "";
    }
  } else {
    // Step 3 (non-PP): Delivered — same logic.
    if (idx === 3) {
      if (m.delivered) return formatShortDate(m.delivered);
      if (shoot.projectedDeliveredDate)
        return `Expected ${formatShortDate(shoot.projectedDeliveredDate)}`;
      return "";
    }
  }
  return "";
}

function formatCountdown(iso: string, delivered: boolean): string | null {
  if (delivered) return "completed";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso + "T00:00:00");
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays > 1) return `in ${diffDays} days`;
  if (diffDays === -1) return "yesterday";
  return `${Math.abs(diffDays)} days ago`;
}
