// Domain helpers for the activity stream (shared-KV contract v2 §5/§9).
//
// The activity stream is an internal storage change, NOT an API change:
// the comment routes still return the same client-facing shape, so
// review-shell.tsx is untouched. These helpers build comment_client
// entries and merge the activity list with the legacy comments: store
// through the §9 cutover.

import { newActivityId } from "./comment-id";
import { listActivity } from "./activity-storage";
import { listComments } from "./asset-storage";
import type { AssetActivity, Comment } from "./types";

// The client-facing comment shape the review page consumes. Identical to
// the pre-activity API response - keep it stable.
export type ClientComment = {
  id: string;
  authorName: string;
  text: string;
  timestampSeconds: number;
  createdAt: string;
  updatedAt: string;
  resolved: boolean;
};

// A scrub comment a client left at a specific playhead position.
export function newClientComment(args: {
  authorName: string;
  text: string;
  version: number;
  timestampSeconds: number;
}): AssetActivity {
  const now = new Date().toISOString();
  return {
    id: newActivityId(),
    type: "comment_client",
    actorName: args.authorName,
    actorRole: "client",
    createdAt: now,
    updatedAt: now,
    body: args.text,
    targetVersionN: args.version,
    timestampSeconds: args.timestampSeconds,
    resolved: false,
    parentId: null,
    meta: {},
  };
}

// The note a client leaves with an approve / request-changes decision
// (contract §6). Also a comment_client entry, so it lands in the member
// timeline - but meta.kind tags it as a decision note so the
// shoots.fame.so review thread skips it (the approval bar shows it
// already, and it has no playhead position).
export function newDecisionNote(args: {
  authorName: string;
  text: string;
  version: number;
  decision: "approved" | "changes_requested";
}): AssetActivity {
  const now = new Date().toISOString();
  return {
    id: newActivityId(),
    type: "comment_client",
    actorName: args.authorName,
    actorRole: "client",
    createdAt: now,
    updatedAt: now,
    body: args.text,
    targetVersionN: args.version,
    timestampSeconds: null,
    resolved: false,
    parentId: null,
    meta: { kind: "decision_note", decision: args.decision },
  };
}

// A comment_client activity entry -> the client-facing comment shape.
export function toClientComment(a: AssetActivity): ClientComment {
  return {
    id: a.id,
    authorName: a.actorName ?? "",
    text: a.body ?? "",
    timestampSeconds: a.timestampSeconds ?? 0,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    resolved: a.resolved,
  };
}

// A legacy comments: entry -> the client-facing shape (cutover fallback).
function legacyToClientComment(c: Comment): ClientComment {
  return {
    id: c.id,
    authorName: c.authorName,
    text: c.text,
    timestampSeconds: c.timestampSeconds,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    resolved: c.resolved,
  };
}

// Is this entry a client scrub comment that belongs in the review
// thread? (comment_client, the right version, and NOT a decision note.)
function isThreadComment(a: AssetActivity, version: number): boolean {
  return (
    a.type === "comment_client" &&
    a.targetVersionN === version &&
    a.meta?.kind !== "decision_note"
  );
}

// The client review comments for one (asset, version): comment_client
// entries from the shared activity stream, UNION the legacy comments:
// entries not yet migrated (deduped by meta.fromComment). Correct in
// every migration state - the comments: arm is dropped at §9 step (c).
export async function readClientComments(
  cardId: string,
  assetSlug: string,
  version: number,
): Promise<ClientComment[]> {
  const activity = await listActivity(cardId, assetSlug);
  const fromActivity = activity.filter((a) => isThreadComment(a, version));
  const migratedIds = new Set(
    activity
      .map((a) =>
        typeof a.meta?.fromComment === "string" ? a.meta.fromComment : null,
      )
      .filter((x): x is string => x !== null),
  );
  const legacy = await listComments(assetSlug, version);
  const unmigrated = legacy.filter((c) => !migratedIds.has(c.id));
  const merged = [
    ...fromActivity.map(toClientComment),
    ...unmigrated.map(legacyToClientComment),
  ];
  merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return merged;
}
