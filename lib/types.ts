import type { ShootStatus } from "../app/[slug]/status";
import type { MilestoneDates } from "./milestone-dates";

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

// Public data model - what /[slug] reads. One blob per Trello card.
export type Shoot = {
  slug: string;
  cardId: string; // Trello card id (stable across renames)
  shootNumber: string; // "#0190"
  clientName: string; // "genOway"
  // Category-style label from Trello (e.g. "Podcast", "Conference",
  // "Event"). Sourced from the card's first non-"Post Production" label.
  shootType?: string;
  location: string;
  shootDate: string; // ISO YYYY-MM-DD or ""
  status: ShootStatus;
  statusLabel: string; // client-facing label (already mapped from Trello list)
  crew?: {
    name: string;
    bio: string;
    photoUrl?: string;
  };
  briefUrl?: string;
  quoteUrl?: string;
  finalAssetsUrl?: string;
  depositReceiptUrl?: string;
  balanceReceiptUrl?: string;
  // WhatsApp group invite URL shared with the client - set on the
  // Trello card so it can be surfaced as "where comms happens" during
  // shoot week.
  clientWhatsappUrl?: string;
  producerEmail: string;
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
