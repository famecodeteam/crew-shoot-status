"use client";

// Client-side shell around the branded player. Owns:
//   - current video version
//   - currentTime (read from the <video> ref so we can prefill the
//     comment composer's timestamp)
//   - comments list (fetched on mount + on version change)
//   - composer / per-comment edit / approval modal state
//
// Each piece is small enough to keep co-located.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset, AssetApprovalStatus, AssetVersion } from "@/lib/types";

// Client view of a comment - server strips the author secrets before
// returning to readers.
type ClientComment = {
  id: string;
  authorName: string;
  text: string;
  timestampSeconds: number;
  createdAt: string;
  updatedAt: string;
  resolved: boolean;
};

const NAME_KEY = "csk:reviewerName";
function commentKey(id: string): string {
  return `csk:cmtTok:${id}`;
}

// ---------- Top-level shell ----------

export function ReviewShell({
  asset,
  streamCustomerCode,
}: {
  asset: Asset;
  streamCustomerCode: string | null;
}) {
  // `asset.versions` arrives already publish-gated: the server component
  // (page.tsx) filters it through clientVersions() before this prop is
  // serialised into the public browser payload. Every versions read
  // below is therefore client-safe - do NOT pass an unfiltered asset in
  // here (contract v2 §4).
  const latest = asset.versions[asset.versions.length - 1];
  const [version, setVersion] = useState<number>(latest.n);
  const [comments, setComments] = useState<ClientComment[]>([]);
  const [approval, setApproval] = useState(asset.approval);
  const [currentTime, setCurrentTime] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerSeconds, setComposerSeconds] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Fetch comments whenever the version changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resp = await fetch(
        `/api/asset/${encodeURIComponent(asset.slug)}/v${version}/comments`,
      );
      if (!resp.ok || cancelled) return;
      const data = await resp.json();
      if (!cancelled) setComments(data.comments ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [asset.slug, version]);

  // Track playback time so the composer auto-fills the timestamp.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [version]);

  const seekTo = useCallback((seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, seconds);
    v.play().catch(() => {});
  }, []);

  const onAddCommentClick = useCallback(() => {
    setComposerSeconds(currentTime);
    setComposerOpen(true);
  }, [currentTime]);

  const onCommentPosted = useCallback((c: ClientComment) => {
    setComments((prev) => [...prev, c]);
    setComposerOpen(false);
  }, []);

  // Approval bar is visible when there's no decision yet, OR when the
  // current decision is stale (a newer version has landed than the one
  // the decision was made against) AND the user is viewing that latest
  // version.
  const decisionIsStale =
    !!latest && !!approval && latest.n > approval.onVersion;
  const showApprovalBar =
    !!latest &&
    (!approval ||
      (decisionIsStale && version === latest.n));

  const onApprovalCleared = useCallback(() => setApproval(null), []);

  // Client-facing number for the version currently being viewed - used for
  // every number the client reads (modal titles, the "may be chargeable"
  // heads-up). The chargeability rule is "3rd revision onward" as the CLIENT
  // counts them, so it keys off this, not the internal version number.
  const clientVersion = clientVersionLabel(asset.versions, version);

  return (
    <>
      <Player
        asset={asset}
        version={version}
        onVersionChange={setVersion}
        videoRef={videoRef}
        comments={comments}
        onSeek={seekTo}
        streamCustomerCode={streamCustomerCode}
      />
      <VersionDownloadBar asset={asset} version={version} />
      <CommentBar
        currentTime={currentTime}
        onAdd={onAddCommentClick}
      />
      <ApprovalState
        approval={approval}
        version={version}
        latestVersionN={latest.n}
        versions={asset.versions}
        assetSlug={asset.slug}
        onCleared={onApprovalCleared}
      />
      <CommentThread
        comments={comments}
        onSeek={seekTo}
        onUpdate={(updated) =>
          setComments((prev) =>
            prev.map((c) => (c.id === updated.id ? updated : c)),
          )
        }
        onDelete={(id) =>
          setComments((prev) => prev.filter((c) => c.id !== id))
        }
        assetSlug={asset.slug}
        version={version}
      />
      {composerOpen && (
        <ComposerModal
          assetSlug={asset.slug}
          version={version}
          clientVersion={clientVersion}
          initialSeconds={composerSeconds}
          onPosted={onCommentPosted}
          onClose={() => setComposerOpen(false)}
        />
      )}
      {showApprovalBar && (
        <ApprovalBar
          assetSlug={asset.slug}
          assetName={asset.name}
          version={version}
          clientVersion={clientVersion}
          onApproved={(a) => setApproval(a)}
          onChangesRequested={(a) => setApproval(a)}
        />
      )}
    </>
  );
}

// ---------- Player + scrub markers ----------

function Player({
  asset,
  version,
  onVersionChange,
  videoRef,
  comments,
  onSeek,
  streamCustomerCode,
}: {
  asset: Asset;
  version: number;
  onVersionChange: (n: number) => void;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  comments: ClientComment[];
  onSeek: (seconds: number) => void;
  streamCustomerCode: string | null;
}) {
  // We get the video duration so we can position comment markers
  // proportionally. HLS-via-MSE sources (Cloudflare Stream) frequently
  // settle their duration on a `durationchange` event *after* the initial
  // `loadedmetadata`, and sometimes only report a finite duration once
  // playback has actually started - so we listen to all three and also
  // read the current value on mount, so the comment timeline doesn't stay
  // hidden waiting for an event that already fired.
  const [duration, setDuration] = useState(0);
  // The clip's intrinsic aspect ratio (width / height), learned once the
  // video reports its dimensions. Lets a vertical (9:16) clip drive a
  // portrait player instead of being letterboxed in the 16:9 box.
  const [aspect, setAspect] = useState<number | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const sync = () => {
      setDuration(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0);
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        setAspect(v.videoWidth / v.videoHeight);
      }
    };
    sync();
    v.addEventListener("loadedmetadata", sync);
    v.addEventListener("durationchange", sync);
    v.addEventListener("loadeddata", sync);
    return () => {
      v.removeEventListener("loadedmetadata", sync);
      v.removeEventListener("durationchange", sync);
      v.removeEventListener("loadeddata", sync);
    };
  }, [videoRef, version]);

  // Resolve the video source for the selected version. Cloudflare Stream
  // (transcoded, adaptive, CDN-cached HLS) once the version has been
  // ingested and is "ready"; otherwise the Drive proxy as the fallback,
  // so a not-yet-ingested version still plays - just not as fast.
  const fileUrl = `/api/video/${encodeURIComponent(asset.slug)}/v${version}`;
  const cv = asset.versions.find((v) => v.n === version);
  const streamUid =
    cv?.streamStatus === "ready" && cv.streamUid ? cv.streamUid : null;
  const hlsUrl =
    streamCustomerCode && streamUid
      ? `https://customer-${streamCustomerCode}.cloudflarestream.com/${streamUid}/manifest/video.m3u8`
      : null;
  const posterUrl =
    streamCustomerCode && streamUid
      ? `https://customer-${streamCustomerCode}.cloudflarestream.com/${streamUid}/thumbnails/thumbnail.jpg`
      : undefined;

  // Learn the clip's aspect ratio from the Stream poster - a native-ratio
  // thumbnail that loads immediately, so a vertical clip gets a portrait
  // player BEFORE playback. (HLS reports videoWidth=0 until it decodes a
  // frame, so the `sync` listener above only catches dimensions once the
  // posterless Drive-proxy fallback plays.)
  useEffect(() => {
    if (!posterUrl) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled && img.naturalWidth > 0 && img.naturalHeight > 0) {
        setAspect(img.naturalWidth / img.naturalHeight);
      }
    };
    img.src = posterUrl;
    return () => {
      cancelled = true;
    };
  }, [posterUrl]);

  // Wire the source onto the <video>. HLS plays natively on Safari and
  // via hls.js (MSE) on Chrome/Firefox/Edge; the Drive-proxy fallback is
  // a plain MP4. Re-runs on version change, which reloads the element.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: { destroy(): void } | null = null;
    let cancelled = false;

    if (!hlsUrl) {
      // Not ingested into Stream yet - Drive proxy fallback.
      video.src = fileUrl;
      video.load();
    } else {
      // Ingested - play the Stream HLS. Prefer hls.js (MSE) whenever it's
      // supported: the reliable, consistent path on Chrome / Firefox /
      // Edge. Only Safari / iOS (no hls.js support) fall back to native
      // HLS - some browsers report HLS as natively playable ("maybe")
      // yet hls.js is still the better choice, so isSupported() must be
      // checked first. Dynamic-import so hls.js is code-split and never
      // SSR-evaluated.
      void import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return;
        if (Hls.isSupported()) {
          video.removeAttribute("src");
          const inst = new Hls();
          inst.loadSource(hlsUrl);
          inst.attachMedia(video);
          hls = inst;
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          // Safari / iOS - native HLS.
          video.src = hlsUrl;
          video.load();
        } else {
          // No HLS support at all - fall back to the Drive-proxy MP4.
          video.src = fileUrl;
          video.load();
        }
      });
    }

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
    };
  }, [hlsUrl, fileUrl, videoRef]);

  const showSelector = asset.versions.length > 1;

  return (
    <section className="section asset-player-section">
      <div
        className={`asset-player${aspect !== null && aspect < 1 ? " is-vertical" : ""}`}
      >
        <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          poster={posterUrl}
          className="asset-video"
          // Once known, the clip's real ratio overrides the 16/9 default so
          // non-16:9 clips (esp. vertical) aren't letterboxed.
          style={aspect !== null ? { aspectRatio: String(aspect) } : undefined}
        />
      </div>
      {duration > 0 && comments.length > 0 && (
        <CommentTimeline
          comments={comments}
          duration={duration}
          onSeek={onSeek}
        />
      )}
      {showSelector && (
        <VersionSelector
          versions={asset.versions}
          current={version}
          onChange={onVersionChange}
        />
      )}
    </section>
  );
}

// A dedicated comment timeline strip rendered *below* the video rather
// than overlaid on the native control bar. Overlaying meant the browser's
// own scrubber fought the markers for hover/click events (and auto-hid
// them), so neither the tooltip nor seek-on-click worked reliably. This
// strip owns its own space: hovering a pin shows the full comment in a
// popover, clicking it seeks the player to that timestamp.
function CommentTimeline({
  comments,
  duration,
  onSeek,
}: {
  comments: ClientComment[];
  duration: number;
  onSeek: (s: number) => void;
}) {
  return (
    <div className="comment-timeline">
      <div className="comment-timeline-track" aria-hidden="true" />
      {comments.map((c) => {
        const pct = Math.min(
          100,
          Math.max(0, (c.timestampSeconds / duration) * 100),
        );
        // Pin tooltips near the edges would clip; nudge their popover
        // anchor inward so the bubble stays on-screen.
        const edge = pct < 12 ? "is-left" : pct > 88 ? "is-right" : "";
        return (
          <button
            key={c.id}
            type="button"
            className={
              "comment-pin" +
              (c.resolved ? " resolved" : "") +
              (edge ? " " + edge : "")
            }
            style={{ left: `${pct}%` }}
            onClick={() => onSeek(c.timestampSeconds)}
            aria-label={`Jump to comment by ${c.authorName} at ${formatMmSs(
              c.timestampSeconds,
            )}: ${c.text}`}
          >
            <span className="comment-pin-pop" role="tooltip">
              <span className="comment-pin-head">
                {c.authorName} · {formatMmSs(c.timestampSeconds)}
              </span>
              <span className="comment-pin-text">{c.text}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function VersionSelector({
  versions,
  current,
  onChange,
}: {
  versions: AssetVersion[];
  current: number;
  onChange: (n: number) => void;
}) {
  // Label by position (contiguous v1, v2, v3 the client can see); switch by
  // internal `n` so comments / video / approval all stay keyed correctly.
  const lastIndex = versions.length - 1;
  return (
    <div className="asset-versions">
      <span className="asset-versions-label">Version</span>
      {versions.map((v, i) => (
        <button
          key={v.n}
          type="button"
          className={"asset-version-pill" + (v.n === current ? " is-active" : "")}
          onClick={() => onChange(v.n)}
        >
          v{i + 1}
          {i === lastIndex && <span className="asset-version-latest"> · latest</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- Composer trigger ----------

function CommentBar({
  currentTime,
  onAdd,
}: {
  currentTime: number;
  onAdd: () => void;
}) {
  return (
    <div className="comment-bar">
      <button type="button" className="comment-add" onClick={onAdd}>
        + Add comment at <strong>{formatMmSs(currentTime)}</strong>
      </button>
    </div>
  );
}

// ---------- Per-version download ----------
//
// Drive's `uc?export=download` endpoint serves the file with
// Content-Disposition: attachment, so the browser drops it straight into
// the user's downloads tray rather than trying to render it in-tab. The
// same pattern is used by the Live Moments card grid - we keep the
// styling intentionally lightweight so it doesn't compete with the
// primary Approve / Request changes call-to-action below.
// Video extensions - videos route their Download to Google Drive (see below).
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|mpg|mpeg|wmv)$/i;

function VersionDownloadBar({
  asset,
  version,
}: {
  asset: Asset;
  version: number;
}) {
  const cv = asset.versions.find((v) => v.n === version);
  if (!cv?.driveFileId) return null;
  const label = clientVersionLabel(asset.versions, version);
  const base = `/api/asset/${encodeURIComponent(asset.slug)}/v${version}`;

  // Videos can outrun the serverless time budget streaming through the proxy,
  // so their Download opens the file in Google Drive (shared just-in-time by
  // the drive-link route). Every other asset type is small enough to download
  // directly through the proxy (which streams via the service account, so it
  // doesn't depend on the file being publicly shared).
  const isVideo = VIDEO_EXT.test(cv.filename ?? "") || !!cv.streamUid;
  const href = isVideo ? `${base}/drive-link` : `${base}/download`;

  return (
    <div className="version-download-bar">
      <a
        className="version-download"
        href={href}
        {...(isVideo
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {})}
        aria-label={`Download ${asset.name} v${label}`}
      >
        <DownloadIcon />
        <span>Download v{label}</span>
      </a>
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

// ---------- Composer modal ----------

function ComposerModal({
  assetSlug,
  version,
  clientVersion,
  initialSeconds,
  onPosted,
  onClose,
}: {
  assetSlug: string;
  version: number;
  clientVersion: number;
  initialSeconds: number;
  onPosted: (c: ClientComment) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(NAME_KEY) ?? "";
  });
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const n = name.trim();
    const t = text.trim();
    if (!n || !t) {
      setErr("Name and comment text are both required");
      return;
    }
    setPosting(true);
    setErr(null);
    try {
      const resp = await fetch(
        `/api/asset/${encodeURIComponent(assetSlug)}/v${version}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            authorName: n,
            text: t,
            timestampSeconds: initialSeconds,
          }),
        },
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      // Persist name + per-comment token for later edit/delete.
      window.localStorage.setItem(NAME_KEY, n);
      window.localStorage.setItem(commentKey(data.comment.id), data.authorToken);
      onPosted(data.comment);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Leave a comment at {formatMmSs(initialSeconds)}</h2>
        {clientVersion >= 3 && (
          <p className="modal-help">
            Heads up: comments asking for changes count as a revision, which
            <strong> may be chargeable</strong> - we will always confirm with
            you before any charge.
          </p>
        )}
        <label className="modal-label">
          Your name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoFocus={!name}
            placeholder="e.g. Sarah Chen"
          />
        </label>
        <label className="modal-label">
          Comment
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="What would you like to flag?"
            autoFocus={!!name}
          />
        </label>
        {err && <p className="modal-error">{err}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="btn-primary"
            disabled={posting}
          >
            {posting ? "Posting…" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Comment thread ----------

function CommentThread({
  comments,
  onSeek,
  onUpdate,
  onDelete,
  assetSlug,
  version,
}: {
  comments: ClientComment[];
  onSeek: (s: number) => void;
  onUpdate: (c: ClientComment) => void;
  onDelete: (id: string) => void;
  assetSlug: string;
  version: number;
}) {
  const sorted = [...comments].sort(
    (a, b) => a.timestampSeconds - b.timestampSeconds,
  );

  return (
    <section className="section">
      <div className="card-h">Comments {comments.length > 0 && `(${comments.length})`}</div>
      {sorted.length === 0 ? (
        <div className="comment-empty">
          Have feedback on this version? Leave a comment - your editor will see it.
        </div>
      ) : (
        <ul className="comment-list">
          {sorted.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              onSeek={onSeek}
              onUpdate={onUpdate}
              onDelete={onDelete}
              assetSlug={assetSlug}
              version={version}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

const EDIT_WINDOW_MS = 10 * 60 * 1000;
function withinEditWindow(iso: string): boolean {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= EDIT_WINDOW_MS;
}

function CommentItem({
  comment,
  onSeek,
  onUpdate,
  onDelete,
  assetSlug,
  version,
}: {
  comment: ClientComment;
  onSeek: (s: number) => void;
  onUpdate: (c: ClientComment) => void;
  onDelete: (id: string) => void;
  assetSlug: string;
  version: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.text);
  const [busy, setBusy] = useState(false);

  // Author-only edit/delete: we have the token in localStorage.
  const [myToken, setMyToken] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setMyToken(window.localStorage.getItem(commentKey(comment.id)));
  }, [comment.id]);

  const canEdit = !!myToken && withinEditWindow(comment.createdAt);
  const wasEdited = comment.updatedAt !== comment.createdAt;

  async function callPatch(payload: object) {
    const resp = await fetch(
      `/api/asset/${encodeURIComponent(assetSlug)}/v${version}/comments/${comment.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${resp.status}`);
    }
    return (await resp.json()).comment as ClientComment;
  }

  async function saveEdit() {
    setBusy(true);
    try {
      const updated = await callPatch({ text: draft.trim(), authorToken: myToken });
      onUpdate(updated);
      setEditing(false);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleResolved() {
    setBusy(true);
    try {
      const updated = await callPatch({ resolved: !comment.resolved });
      onUpdate(updated);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!myToken) return;
    if (!confirm("Delete this comment?")) return;
    setBusy(true);
    try {
      const resp = await fetch(
        `/api/asset/${encodeURIComponent(assetSlug)}/v${version}/comments/${comment.id}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authorToken: myToken }),
        },
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }
      window.localStorage.removeItem(commentKey(comment.id));
      onDelete(comment.id);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={"comment-item" + (comment.resolved ? " resolved" : "")}>
      <div className="comment-meta-row">
        <button
          type="button"
          className="comment-time"
          onClick={() => onSeek(comment.timestampSeconds)}
        >
          {formatMmSs(comment.timestampSeconds)}
        </button>
        <span className="comment-author">{comment.authorName}</span>
        <span className="comment-posted">{relativePostedAt(comment.createdAt)}</span>
        {wasEdited && <span className="comment-edited">(edited)</span>}
      </div>
      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={2000}
            rows={3}
            className="comment-edit-textarea"
          />
          <div className="comment-edit-actions">
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={saveEdit}
            >
              Save
            </button>
          </div>
        </>
      ) : (
        <p className="comment-text">{comment.text}</p>
      )}
      <div className="comment-actions-row">
        <button
          type="button"
          className="comment-action-link"
          onClick={toggleResolved}
          disabled={busy}
        >
          {comment.resolved ? "Mark unresolved" : "Mark resolved"}
        </button>
        {canEdit && !editing && (
          <>
            <button
              type="button"
              className="comment-action-link"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <button
              type="button"
              className="comment-action-link danger"
              onClick={doDelete}
              disabled={busy}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </li>
  );
}

// ---------- Approval bar + state ----------

function ApprovalState({
  approval,
  version,
  latestVersionN,
  versions,
  assetSlug,
  onCleared,
}: {
  approval: Asset["approval"];
  version: number;
  latestVersionN: number;
  versions: AssetVersion[];
  assetSlug: string;
  onCleared: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function reset() {
    const name =
      window.localStorage.getItem(NAME_KEY) ?? prompt("Your name (for the audit log):");
    if (!name || !name.trim()) return;
    if (!confirm("Change your decision? Your editor will be notified.")) return;
    setBusy(true);
    try {
      const resp = await fetch(
        `/api/asset/${encodeURIComponent(assetSlug)}/reset-approval`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authorName: name.trim() }),
        },
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }
      window.localStorage.setItem(NAME_KEY, name.trim());
      onCleared();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!approval) return null;

  // Stale decision - a newer version has landed than the one the
  // decision was made against. Only show the new-version banner when
  // we're actually viewing that latest version; otherwise (viewing the
  // version the decision applied to) show the normal approved /
  // changes-requested state below.
  const isStale = latestVersionN > approval.onVersion;
  if (isStale && version === latestVersionN) {
    return (
      <div className="approval-state new-version">
        Here is your new version.
        {approval.changeRequestText && (
          <div className="approval-quote">“{approval.changeRequestText}”</div>
        )}
        <div className="approval-state-cta">Ready to approve below.</div>
      </div>
    );
  }

  if (approval.status === "approved") {
    return (
      <div className="approval-state approved">
        Approved on{" "}
        {new Date(approval.decidedAt ?? Date.now()).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
        {approval.authorName && ` by ${approval.authorName}`}
        {approval.onVersion !== version &&
          ` (on v${clientVersionLabel(versions, approval.onVersion)})`}
        <button
          type="button"
          className="approval-state-undo"
          onClick={reset}
          disabled={busy}
        >
          {busy ? "Updating…" : "Change my decision"}
        </button>
      </div>
    );
  }
  if (approval.status === "changes_requested") {
    return (
      <div className="approval-state changes-requested">
        Changes requested. Your editor will be in touch with a new version shortly.
        {approval.changeRequestText && (
          <div className="approval-quote">“{approval.changeRequestText}”</div>
        )}
        <button
          type="button"
          className="approval-state-undo"
          onClick={reset}
          disabled={busy}
        >
          {busy ? "Updating…" : "Change my decision"}
        </button>
      </div>
    );
  }
  return null;
}

function ApprovalBar({
  assetSlug,
  assetName,
  version,
  clientVersion,
  onApproved,
  onChangesRequested,
}: {
  assetSlug: string;
  assetName: string;
  version: number;
  clientVersion: number;
  onApproved: (a: NonNullable<Asset["approval"]>) => void;
  onChangesRequested: (a: NonNullable<Asset["approval"]>) => void;
}) {
  const [mode, setMode] = useState<null | "approve" | "changes">(null);
  return (
    <>
      <div className="approval-bar">
        <button
          type="button"
          className="btn-primary"
          onClick={() => setMode("approve")}
        >
          Approve this version
        </button>
        <button
          type="button"
          className="btn-outline"
          onClick={() => setMode("changes")}
        >
          Request changes
        </button>
      </div>
      {mode === "approve" && (
        <ApproveModal
          assetSlug={assetSlug}
          assetName={assetName}
          version={version}
          clientVersion={clientVersion}
          onDone={(a) => {
            setMode(null);
            onApproved(a);
          }}
          onClose={() => setMode(null)}
        />
      )}
      {mode === "changes" && (
        <ChangesModal
          assetSlug={assetSlug}
          assetName={assetName}
          version={version}
          clientVersion={clientVersion}
          onDone={(a) => {
            setMode(null);
            onChangesRequested(a);
          }}
          onClose={() => setMode(null)}
        />
      )}
    </>
  );
}

function ApproveModal({
  assetSlug,
  assetName,
  version,
  clientVersion,
  onDone,
  onClose,
}: {
  assetSlug: string;
  assetName: string;
  version: number;
  clientVersion: number;
  onDone: (a: NonNullable<Asset["approval"]>) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(NAME_KEY) ?? "";
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const n = name.trim();
    if (!n) {
      setErr("Name is required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const resp = await fetch(
        `/api/asset/${encodeURIComponent(assetSlug)}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authorName: n, onVersion: version }),
        },
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }
      window.localStorage.setItem(NAME_KEY, n);
      const data = await resp.json();
      onDone(data.asset.approval);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Approve {assetName} (v{clientVersion})</h2>
        <label className="modal-label">
          Your name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoFocus={!name}
          />
        </label>
        {err && <p className="modal-error">{err}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Approving…" : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChangesModal({
  assetSlug,
  assetName,
  version,
  clientVersion,
  onDone,
  onClose,
}: {
  assetSlug: string;
  assetName: string;
  version: number;
  clientVersion: number;
  onDone: (a: NonNullable<Asset["approval"]>) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(NAME_KEY) ?? "";
  });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const n = name.trim();
    const t = text.trim();
    if (!n) {
      setErr("Name is required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const resp = await fetch(
        `/api/asset/${encodeURIComponent(assetSlug)}/request-changes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authorName: n, text: t, onVersion: version }),
        },
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }
      window.localStorage.setItem(NAME_KEY, n);
      const data = await resp.json();
      onDone(data.asset.approval);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Request changes on {assetName} (v{clientVersion})</h2>
        <p className="modal-help">
          Use timestamped comments above for specifics - this note is just an
          overall direction for the editor.
        </p>
        {clientVersion >= 3 && (
          <p className="modal-help">
            Heads up: <strong>this revision may be chargeable</strong> - we
            will always confirm with you before any charge.
          </p>
        )}
        <label className="modal-label">
          Your name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoFocus={!name}
          />
        </label>
        <label className="modal-label">
          Overall direction <span className="modal-optional">(optional)</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="e.g. tighten the intro, swap the b-roll at the end"
            autoFocus={!!name}
          />
        </label>
        {err && <p className="modal-error">{err}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Sending…" : "Request changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Helpers ----------

// Client-facing version label for an internal version number `n`. `versions`
// here is always the publish-gated, client-visible list (page.tsx filters it
// through clientVersions() before it reaches this shell), so the label the
// client should see is simply that version's 1-based position in the list -
// a contiguous v1, v2, v3 with no gaps from internal-only cuts. The internal
// `n` is still what every API call uses; this is display only. Falls back to
// `n` if the version isn't in the visible list (shouldn't happen).
function clientVersionLabel(versions: AssetVersion[], n: number): number {
  const i = versions.findIndex((v) => v.n === n);
  return i === -1 ? n : i + 1;
}

function formatMmSs(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function relativePostedAt(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

// Silence unused-import for the AssetApprovalStatus type - referenced
// indirectly via Asset["approval"]["status"] in the children.
export type _Unused = AssetApprovalStatus;
