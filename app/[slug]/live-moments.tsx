"use client";

// "Live from your shoot" — polls the read-only API on member.fame.so for
// photo/video moments captured by the crew during the shoot. Hides the
// whole section until at least one moment exists (no empty-state tease).
//
// Polling cadence (per the hand-off spec):
//   - 30s while foreground AND crewStatus ∈ {On the way, On site, Wrapping}
//   - 5 min once crewStatus is Wrapped
//   - paused entirely when the tab is hidden (Page Visibility API)
//   - immediate catch-up fetch on visibility-resume
//
// CORS allowlist on the member side includes https://shoots.fame.so; the
// fetch is a plain cross-origin GET. Failures (CORS, network, 404) hide
// the section silently rather than render anything broken.

import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = "https://member.fame.so/api/shoots";
const POLL_ACTIVE_MS = 30_000;
const POLL_WRAPPED_MS = 5 * 60_000;

type LiveMoment = {
  driveFileId: string;
  type: "photo" | "video";
  caption: string | null;
  capturedAt: string;
  crewName: string | null;
  thumbnailUrl: string;
  hasThumbnail: boolean;
  durationMs: number | null;
  mimeType: string;
  driveWebViewLink: string;
};

type ApiResponse = {
  moments: LiveMoment[];
  lastUpdated: string;
  crewStatus: string | null;
};

function pollInterval(crewStatus: string | null): number {
  return crewStatus === "Wrapped" ? POLL_WRAPPED_MS : POLL_ACTIVE_MS;
}

export function LiveMoments({
  slug,
  shootDate,
}: {
  slug: string;
  shootDate: string;
}) {
  const [moments, setMoments] = useState<LiveMoment[]>([]);
  const [crewStatus, setCrewStatus] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<LiveMoment | null>(null);
  // Hidden-on-error: any failed fetch (CORS, network, non-200/404) hides
  // the section rather than render a broken state.
  const [errored, setErrored] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMoments = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/${encodeURIComponent(slug)}/live-moments`);
      if (resp.status === 404) {
        // Slug unknown to the member side — render nothing.
        setMoments([]);
        setErrored(false);
        return;
      }
      if (!resp.ok) {
        setErrored(true);
        return;
      }
      const data: ApiResponse = await resp.json();
      setMoments(data.moments ?? []);
      setCrewStatus(data.crewStatus ?? null);
      setErrored(false);
    } catch {
      setErrored(true);
    }
  }, [slug]);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    const armTimer = () => {
      clearTimer();
      const ms = pollInterval(crewStatus);
      timerRef.current = setInterval(() => {
        if (document.visibilityState === "visible") {
          fetchMoments();
        }
      }, ms);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Catch up to whatever was captured while we were hidden, THEN
        // re-arm the interval (so the next tick lands a full cadence later).
        fetchMoments();
        armTimer();
      } else {
        clearTimer();
      }
    };

    fetchMoments();
    armTimer();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchMoments, crewStatus]);

  if (errored || moments.length === 0) return null;

  const header = isShootDayToday(shootDate)
    ? "Live from your shoot — happening now"
    : "Moments from the shoot";

  return (
    <section className="section">
      <div className="card-h">{header}</div>
      <div className="moments-grid">
        {moments.map((m) => (
          <MomentCard
            key={m.driveFileId}
            moment={m}
            onOpen={() => setLightbox(m)}
          />
        ))}
      </div>
      {lightbox && (
        <Lightbox moment={lightbox} onClose={() => setLightbox(null)} />
      )}
    </section>
  );
}

function MomentCard({
  moment,
  onOpen,
}: {
  moment: LiveMoment;
  onOpen: () => void;
}) {
  // <a download> nested inside <button> is invalid HTML, so the outer
  // container is a div with role=button.
  return (
    <div
      className="moment-card"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="moment-thumb-wrap">
        {moment.hasThumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="moment-thumb"
            src={publicThumbUrl(moment, 600)}
            alt={moment.caption ?? "Moment"}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="moment-placeholder" aria-hidden="true">
            {moment.type === "video" ? "🎥" : "📸"}
          </div>
        )}
        {moment.type === "video" && (
          <>
            <div className="moment-play" aria-hidden="true">
              ▶
            </div>
            {moment.durationMs != null && (
              <div className="moment-duration">{mmss(moment.durationMs)}</div>
            )}
          </>
        )}
        <a
          className="moment-download"
          href={downloadUrl(moment)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Download ${moment.type}`}
          title="Download"
        >
          <DownloadIcon />
        </a>
      </div>
      {moment.caption && <div className="moment-caption">{moment.caption}</div>}
      <div className="moment-meta">
        {firstName(moment.crewName)}
        {moment.crewName && " · "}
        {relativeTime(moment.capturedAt)}
      </div>
    </div>
  );
}

function Lightbox({
  moment,
  onClose,
}: {
  moment: LiveMoment;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="lightbox-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="lightbox-close"
        onClick={onClose}
        aria-label="Close"
      >
        ×
      </button>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        {moment.type === "video" ? (
          // Drive's own preview handles streaming + auth-free playback
          // inside the iframe.
          <iframe
            src={`https://drive.google.com/file/d/${moment.driveFileId}/preview`}
            title={moment.caption ?? "Video"}
            allow="autoplay"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={publicThumbUrl(moment, 2000)}
            alt={moment.caption ?? "Photo"}
            referrerPolicy="no-referrer"
          />
        )}
        {moment.caption && (
          <div className="lightbox-caption">{moment.caption}</div>
        )}
        <a
          className="lightbox-download"
          href={downloadUrl(moment)}
          onClick={(e) => e.stopPropagation()}
        >
          <DownloadIcon />
          <span>Download</span>
        </a>
      </div>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

// ---------- Formatters ----------

function isShootDayToday(shootDate: string): boolean {
  if (!shootDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(shootDate + "T00:00:00");
  if (Number.isNaN(target.getTime())) return false;
  target.setHours(0, 0, 0, 0);
  return today.getTime() === target.getTime();
}

function firstName(full: string | null): string {
  if (!full) return "";
  return full.split(/\s+/)[0];
}

function mmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function relativeTime(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const now = new Date();
  const diffSec = Math.round((now.getTime() - then.getTime()) / 1000);

  if (diffSec < 30) return "just now";
  if (diffSec < 60) return `${diffSec} sec ago`;
  if (diffSec < 60 * 60) {
    const min = Math.round(diffSec / 60);
    return `${min} min ago`;
  }

  const fmtTime = then.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const today = new Date();
  if (sameDate(then, today)) return fmtTime;

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDate(then, yesterday)) return `yesterday at ${fmtTime}`;

  const fmtDate = then.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return `${fmtDate} at ${fmtTime}`;
}

function sameDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Drive's /thumbnail endpoint requires session cookies, which mobile
// Safari + Chrome (Intelligent Tracking Prevention) block by default.
// lh3.googleusercontent.com is the public CDN equivalent — no auth, no
// cookie required, works cross-origin on mobile. We construct it from
// driveFileId rather than parsing the API's thumbnailUrl, so the size
// is exactly what we want for each surface (card vs lightbox).
function publicThumbUrl(m: LiveMoment, size: number): string {
  return `https://lh3.googleusercontent.com/d/${encodeURIComponent(m.driveFileId)}=w${size}`;
}

// Drive's "force download" URL — Content-Disposition: attachment lands
// the file in the browser's download tray rather than opening a viewer.
// Files >100MB show Drive's virus-scan confirmation page once; clients
// click through. Files under that size download silently.
function downloadUrl(m: LiveMoment): string {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(m.driveFileId)}`;
}
