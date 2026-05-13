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

// Client view of a comment — server strips the author secrets before
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

export function ReviewShell({ asset }: { asset: Asset }) {
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

  return (
    <>
      <Player
        asset={asset}
        version={version}
        onVersionChange={setVersion}
        videoRef={videoRef}
        comments={comments}
        onSeek={seekTo}
      />
      <CommentBar
        currentTime={currentTime}
        onAdd={onAddCommentClick}
      />
      <ApprovalState
        approval={approval}
        version={version}
        latestVersionN={latest.n}
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
}: {
  asset: Asset;
  version: number;
  onVersionChange: (n: number) => void;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  comments: ClientComment[];
  onSeek: (seconds: number) => void;
}) {
  // We get the video duration once metadata loads so we can position
  // comment markers proportionally.
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onMeta = () => setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    v.addEventListener("loadedmetadata", onMeta);
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [videoRef, version]);

  // Reload on version change.
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.load();
  }, [version, videoRef]);

  const src = `/api/video/${encodeURIComponent(asset.slug)}/v${version}`;
  const showSelector = asset.versions.length > 1;

  return (
    <section className="section asset-player-section">
      <div className="asset-player">
        <video
          ref={videoRef}
          src={src}
          controls
          playsInline
          preload="metadata"
          className="asset-video"
        />
        {duration > 0 && comments.length > 0 && (
          <CommentScrubMarkers
            comments={comments}
            duration={duration}
            onSeek={onSeek}
          />
        )}
      </div>
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

function CommentScrubMarkers({
  comments,
  duration,
  onSeek,
}: {
  comments: ClientComment[];
  duration: number;
  onSeek: (s: number) => void;
}) {
  return (
    <div className="comment-markers" aria-hidden="true">
      {comments.map((c) => {
        const pct = Math.min(100, Math.max(0, (c.timestampSeconds / duration) * 100));
        return (
          <button
            key={c.id}
            type="button"
            className={"comment-marker" + (c.resolved ? " resolved" : "")}
            style={{ left: `${pct}%` }}
            onClick={() => onSeek(c.timestampSeconds)}
            title={`${c.authorName} · ${formatMmSs(c.timestampSeconds)}`}
          />
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
  const latestN = versions[versions.length - 1].n;
  return (
    <div className="asset-versions">
      <span className="asset-versions-label">Version</span>
      {versions.map((v) => (
        <button
          key={v.n}
          type="button"
          className={"asset-version-pill" + (v.n === current ? " is-active" : "")}
          onClick={() => onChange(v.n)}
        >
          v{v.n}
          {v.n === latestN && <span className="asset-version-latest"> · latest</span>}
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

// ---------- Composer modal ----------

function ComposerModal({
  assetSlug,
  version,
  initialSeconds,
  onPosted,
  onClose,
}: {
  assetSlug: string;
  version: number;
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
          Have feedback on this version? Leave a comment — your editor will see it.
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
  assetSlug,
  onCleared,
}: {
  approval: Asset["approval"];
  version: number;
  latestVersionN: number;
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

  // Stale decision — a newer version has landed than the one the
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
        {approval.onVersion !== version && ` (on v${approval.onVersion})`}
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
  onApproved,
  onChangesRequested,
}: {
  assetSlug: string;
  assetName: string;
  version: number;
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
  onDone,
  onClose,
}: {
  assetSlug: string;
  assetName: string;
  version: number;
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
        <h2>Approve {assetName} (v{version})</h2>
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
  onDone,
  onClose,
}: {
  assetSlug: string;
  assetName: string;
  version: number;
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
        <h2>Request changes on {assetName} (v{version})</h2>
        <p className="modal-help">
          Use timestamped comments above for specifics — this note is just an
          overall direction for the editor.
        </p>
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

// Silence unused-import for the AssetApprovalStatus type — referenced
// indirectly via Asset["approval"]["status"] in the children.
export type _Unused = AssetApprovalStatus;
