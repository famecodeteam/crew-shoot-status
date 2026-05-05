import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDemoShoot, type Shoot } from "./demo-data";
import { TIMELINE_STEPS, currentStepIndex } from "./status";

const FAME_LOGO_URL =
  "https://cdn.prod.website-files.com/65af97212977390aef05af1b/65bcbe23cfb0eb14d2ce0063_logo.svg";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const shoot = slug === "demo" ? getDemoShoot() : null;
  if (!shoot) return { title: "Fame Crew" };
  return { title: `Fame Crew - Shoot Status - ${shoot.shootNumber}` };
}

export default async function ShootPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // M0: only the static `demo` slug is wired up. Real lookups arrive in M2.
  const shoot = slug === "demo" ? getDemoShoot() : null;
  if (!shoot) notFound();

  return <ShootView shoot={shoot} />;
}

function ShootView({ shoot }: { shoot: Shoot }) {
  const stepIdx = currentStepIndex(shoot.status);
  const isOnHold = shoot.status === "on-hold";
  const isDelivered = shoot.status === "delivered";
  const showCrew = stepIdx >= 1 && shoot.crew && !isOnHold;
  const showAssets = stepIdx >= 4 && shoot.finalAssetsUrl && !isOnHold;
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
          <span>{shoot.location}</span>
          <span className="hero-meta-sep">·</span>
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
          <ol className="timeline">
            {TIMELINE_STEPS.map((label, i) => (
              <li
                key={label}
                className={
                  "step " + (i < stepIdx ? "done" : i === stepIdx ? "current" : "")
                }
              >
                <div className="step-dot">{i < stepIdx ? "✓" : i + 1}</div>
                <div className="step-label">{label}</div>
              </li>
            ))}
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
