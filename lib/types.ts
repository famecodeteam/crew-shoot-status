import type { ShootStatus } from "../app/[slug]/status";
import type { MilestoneDates } from "./milestone-dates";
import type { ParsedBrief } from "./parse-brief";

// Options on the Trello "Crew Status" single-select list field. Crew tap
// these via member.fame.so; the client page reads them via the same
// Trello card the rest of the pipeline reads from.
export type CrewStatus =
  | "Confirmed"
  | "On the way"
  | "On site"
  | "Wrapping"
  | "Wrapped";

// ---------- Asset model (client video review + editor handoff) ----------
// The asset model is shared with the member.fame.so codebase. Both repos
// read and write the same KV keys. The hand-off doc spells out the
// contract; the types here are the canonical source.

export type AssetVersion = {
  n: number; // 1-indexed
  driveFileId: string;
  uploadedAt: string; // ISO
  uploadedBy: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  filename: string | null; // e.g. "v2.mp4"
  // Publish gate (shared-KV contract v2 §4). member.fame.so writes these
  // via the CPM "approve for client" toggle - READ-ONLY on this side,
  // never write them here. A version is invisible to the client until
  // isPublishedToClient is true; absent ⇒ treated as published (legacy +
  // interim records). The filter lives in lib/asset-versions.ts.
  isPublishedToClient?: boolean;
  publishedToClientAt?: string | null;
  publishedBy?: string | null;
  internalStatus?:
    | "awaiting_cpm_review"
    | "changes_requested"
    | "approved_internal"
    | "published";
  // Cloudflare Stream delivery copy (lib/stream.ts). Populated by the
  // sync-stream cron - NOT at upload time - so all three are optional and
  // the member.fame.so writer can leave them unset.
  streamUid?: string | null; // Cloudflare Stream video UID
  streamStatus?: "pending" | "ready" | "error" | null;
  streamError?: string | null; // last ingest/transcode failure reason
};

export type AssetApprovalStatus =
  | "pending" // no client interaction yet
  | "comments_open" // at least one comment, no decision
  | "approved"
  | "changes_requested";

export type AssetApproval = {
  status: AssetApprovalStatus;
  onVersion: number; // version that this status applies to
  authorName: string | null; // captured on approve / request-changes
  decidedAt: string | null; // ISO
  changeRequestText: string | null;
};

export type Asset = {
  slug: string;
  name: string;
  notes: string | null;
  shootCardId: string;
  // Raw file bundle (from editor handoff). May be empty if the asset was
  // created by a flow that doesn't bundle raw files.
  rawFileIds: string[];
  // Finished video versions (the client-review side of the asset).
  // Newest version = versions[versions.length - 1]. Empty = no upload yet.
  versions: AssetVersion[];
  // Current approval state, applies to the latest version unless the
  // client switches in the version selector. Null until the client
  // interacts (comments / approves / requests changes).
  approval: AssetApproval | null;
  // Member.fame.so-owned lifecycle stage (single writer: member; we never
  // write it). Mirrored read-only. We act on ONE value here: "on_hold" - a
  // CPM has paused this specific asset, so the sync-stream cron tears down
  // its Cloudflare Stream copies (see syncStreamOnce). Every other value is
  // informational on this side. Optional: older records predate the field.
  lifecycle?:
    | "awaiting_brief"
    | "awaiting_clip_selection"
    | "ready_for_editor"
    | "in_edit"
    | "internal_review"
    | "awaiting_client_review"
    | "revisions_requested"
    | "approved"
    | "delivered"
    | "on_hold"
    | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
};

export type Comment = {
  id: string; // "cmt_<short>"
  authorName: string;
  authorToken: string; // server-issued; stored client-side in localStorage
  authorIp: string | null;
  authorUa: string | null;
  text: string;
  timestampSeconds: number; // position in the video
  createdAt: string;
  updatedAt: string;
  resolved: boolean;
};

// ---------- Activity stream (shared unified timeline) ----------
// One Redis list per asset, keyed activity:<cardId>:<assetSlug>. The
// post-production rebuild's single timeline - it replaces the per-version
// comments:<assetSlug>:v<N> store (shared-KV contract v2 §5). Both repos
// read the whole list; member.fame.so writes comment_internal + every
// system_* entry, and THIS repo writes ONLY comment_client.
export type AssetActivityType =
  | "comment_internal"
  | "comment_client"
  | "system_version_uploaded"
  | "system_version_published"
  | "system_version_unpublished"
  | "system_version_changes_requested"
  | "system_lifecycle_changed"
  | "system_clips_selected"
  | "system_brief_drafted";

export type AssetActivity = {
  id: string; // "act_<hex8>"
  type: AssetActivityType;
  actorName: string | null;
  actorRole: "cpm" | "editor" | "client" | "system";
  createdAt: string; // ISO
  updatedAt: string; // ISO
  body: string | null; // comment text; null on system_* entries
  targetVersionN: number | null; // version a comment / event refers to
  timestampSeconds: number | null; // playhead position, client comments
  resolved: boolean;
  parentId: string | null; // reply threading
  meta: Record<string, unknown>; // e.g. { fromComment } or { kind }
};

// Edit/delete capability + audit fields for a client comment, keyed
// comment-auth:<activityId>. Kept OFF the shared activity entry: the
// activity list is partly client-readable, so the author token must
// never ride on it (shared-KV contract v2 §5, §8). shoots.fame.so-only.
export type CommentAuth = {
  authorToken: string; // server-issued; client stores it in localStorage
  authorIp: string | null;
  authorUa: string | null;
};

// Public data model - what /[slug] reads. One blob per Trello card.
export type Shoot = {
  slug: string;
  /** Slugs this shoot used previously (e.g. a provisional "card-..." before a
   *  number landed). getBySlug also matches these, and the status page 302s
   *  them to the current slug - so already-shared/emailed links keep working. */
  previousSlugs?: string[];
  cardId: string; // Trello card id (stable across renames)
  shootNumber: string; // "#0190"
  clientName: string; // "genOway"
  // Category-style label from Trello (e.g. "Podcast", "Conference",
  // "Event"). Sourced from the card's first non-"Post Production" label.
  shootType?: string;
  location: string;
  shootDate: string; // ISO YYYY-MM-DD or ""
  /** Client-required shots, synced from member.fame.so. Rendered as a
   *  "Must-have shots" section on the brief page. */
  mustHaveShots?: string[];
  status: ShootStatus;
  statusLabel: string; // client-facing label (already mapped from Trello list)
  /** The lead crew member (back-compat: single "your crew" card). Prefer
   *  `crewMembers` - `crew` stays as the lead so older code keeps working. */
  crew?: {
    name: string;
    bio: string;
    photoUrl?: string;
    /** Crew member's public profile page (member.fame.so/crew/<slug>). */
    profileUrl?: string;
  };
  /** The FULL booked-crew roster (a shoot can have several people), lead first.
   *  Falls back to a single-element array built from `crew` for shoots synced
   *  before the feed carried the array. */
  crewMembers?: Array<{
    name: string;
    bio: string;
    photoUrl?: string;
    profileUrl?: string;
  }>;
  briefUrl?: string;
  quoteUrl?: string;
  // Per-shoot footage index page on member.fame.so - the client browses
  // their raw footage there. Set from the "Client Footage URL" Trello
  // custom field, which member.fame.so writes back when the index is
  // generated. Surfaced in the Footage section.
  footageUrl?: string;
  // Asset count on the footage index, to be written back by member.fame.so
  // once a Trello custom field exists for it. Currently unused by the page
  // (the Footage section is gated on footageUrl + list position alone) -
  // the field is left in the type so the plumbing is ready if we later
  // need to distinguish a generated-but-empty index from a populated one.
  footageAssetCount?: number;
  depositReceiptUrl?: string;
  balanceReceiptUrl?: string;
  // WhatsApp group invite URL shared with the client - set on the
  // Trello card so it can be surfaced as "where comms happens" during
  // shoot week.
  clientWhatsappUrl?: string;
  producerEmail: string;
  // First name of the CPM assigned to the card (Zandro / Tom / Clay
  // currently - see lib/producer.ts). Used in the email sign-off
  // ("Thanks so much, Clay") so the message reads as personal even
  // though it's automated. Always set by transformCard via the
  // PRODUCERS table; falls back to the default producer when no
  // member is assigned on Trello.
  producerFirstName: string;
  // Client-side recipient(s) for milestone emails. Source: "Client Email"
  // Trello custom field. The field accepts a comma-separated list so a
  // client with multiple stakeholders (booker + day-of contact) gets all
  // of them on every milestone email. Empty array = no email plumbed
  // yet; milestone-email enqueue logs a warning + skips the send.
  clientEmails: string[];
  // Personal name of the client contact (e.g. "Andy Zoltan"), used as
  // the first-name greeting in milestone emails ("Hi Andy,"). Source:
  // "Client Contact Name" Trello custom field. Separate from
  // `clientName` (which is the business / show name displayed in the
  // hero block). Optional - emails fall back to a generic greeting
  // when this is unset.
  clientContactName?: string;
  // Whether Fame is doing post-production. Drives whether the timeline
  // includes the "In editing" step. Source: "Post Production" Trello label.
  hasPostProduction: boolean;
  // Live crew status set via the "Crew Status" list custom field on the
  // Trello card (M7 feed-through from the separate crew page at
  // member.fame.so). One of: "Confirmed" | "On the way" | "On site" |
  // "Wrapping" | "Wrapped" | undefined when unset.
  crewStatus?: CrewStatus;
  // Dates each milestone was reached, derived from Trello action history.
  // Missing entries = not yet reached (or card skipped that list).
  milestoneDates: MilestoneDates;
  // Projected Delivered date (Shoot day + 5 business days for PP shoots,
  // +1 calendar day for crew-only). Only used when delivered hasn't been
  // reached yet - the UI prefers the actual milestoneDates.delivered.
  projectedDeliveredDate?: string; // YYYY-MM-DD
  // Bookkeeping
  trelloListId: string;
  trelloListName: string;
  updatedAt: string; // ISO timestamp of last write
};

// ---------- Brief (doc-synced shoot brief page) ----------
// One per shoot that has a brief Doc registered. The brief slug is the
// shoot slug with its trailing 8-hex-char hash stripped - the hash is
// preserved here as the unguessable suffix of the status-page URL. The
// brief unlock code is the shoot number (see briefAccessCode).
//
// Storage: keyed by brief slug in `briefs:store` (Upstash) or .data/briefs.json
// (local dev). See lib/brief-storage*.ts.
export type BriefRecord = {
  slug: string;            // short brief slug, e.g. "0219-demand-ai"
  hash: string;            // 8-hex-char unguessable suffix of the status-page slug
  docId: string;           // Google Doc ID backing this brief
  cardId: string;          // Trello card id (so the webhook can find this)
  shootNumber?: string;    // "#0219" — convenience for logs / observability
  lastSyncedAt: string | null;     // ISO of last sync attempt that succeeded
  lastContentHash: string | null;  // SHA-256 of the structural Docs API response
  parsedJson: ParsedBrief | null;  // last successfully parsed model
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};
