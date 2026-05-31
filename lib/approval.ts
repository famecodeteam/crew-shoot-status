// Approval workflow helpers.
//
// Approve / request-changes / reset share most of their behaviour: write
// the approval to the asset record, post a Trello comment, and refresh
// the shoot's `Assets Status` summary custom field.
//
// What's intentionally NOT here:
//   - Auto-card-movement: disabled per Tom's request. More assets may be
//     added to a shoot after the first round is approved, so moving the
//     card to "Assets Approved By Client" stays a manual step. (Git
//     history has the move logic if it's ever wanted back.)
//   - The per-asset "Asset URLs" custom field: dropped. Neither this repo
//     nor member.fame.so read it for any functional purpose - it was a
//     PM convenience field nobody actually consumed. Removing it saves
//     two Trello round-trips per approval.
//
// Best-effort: a Trello failure doesn't roll back the KV write - the
// approval + comments survive even if the field update fails.

import { getBoardCustomFields, setCustomFieldText } from "./trello";
import { getAsset, getAssetsForShoot, upsertAsset } from "./asset-storage";
import { deleteVideo } from "./stream";
import type { Asset, AssetApproval } from "./types";

// Reflect the shoot-level summary string the brief specifies:
//   "5 assets · 3 approved · 1 changes requested · 1 pending"
function summarizeAssetsForField(assets: Asset[]): string {
  const total = assets.length;
  let approved = 0;
  let changes = 0;
  let pending = 0;
  for (const a of assets) {
    const s = a.approval?.status;
    if (s === "approved") approved++;
    else if (s === "changes_requested") changes++;
    else pending++;
  }
  const parts: string[] = [`${total} ${total === 1 ? "asset" : "assets"}`];
  if (approved) parts.push(`${approved} approved`);
  if (changes) parts.push(`${changes} ${changes === 1 ? "change" : "changes"} requested`);
  if (pending) parts.push(`${pending} pending`);
  return parts.join(" · ");
}

export type SyncTrelloOptions = {
  cardId: string;
};

// After an asset's approval state changes, refresh the shoot-level
// "Assets Status" summary custom field on the Trello card. If the field
// has been removed from the board, this is a graceful no-op.
export async function syncTrelloForShoot(
  opts: SyncTrelloOptions,
): Promise<void> {
  const { cardId } = opts;

  const boardId = process.env.TRELLO_BOARD_ID;
  if (!boardId) {
    console.warn("[approval] TRELLO_BOARD_ID unset - skipping Trello sync");
    return;
  }

  const fields = await getBoardCustomFields(boardId);
  const statusField = fields.find(
    (f) => f.name.trim().toLowerCase() === "assets status",
  );
  if (!statusField) return; // field removed from board - nothing to sync

  const assets = await getAssetsForShoot(cardId);
  try {
    await setCustomFieldText(
      cardId,
      statusField.id,
      summarizeAssetsForField(assets),
    );
  } catch (err) {
    console.warn(
      "[approval] Assets Status field write failed:",
      (err as Error).message,
    );
  }
}

// Build an AssetApproval object from a client decision.
export function makeApproval(args: {
  status: AssetApproval["status"];
  onVersion: number;
  authorName: string;
  changeRequestText?: string | null;
}): AssetApproval {
  return {
    status: args.status,
    onVersion: args.onVersion,
    authorName: args.authorName,
    decidedAt: new Date().toISOString(),
    changeRequestText: args.changeRequestText ?? null,
  };
}

// Apply an approval to the asset record and return the updated record.
export async function applyApprovalToAsset(args: {
  cardId: string;
  assetSlug: string;
  approval: AssetApproval;
}): Promise<Asset> {
  return upsertAsset(args.cardId, args.assetSlug, (existing) => {
    if (!existing) {
      throw new Error("approval target asset not found");
    }
    return {
      ...existing,
      approval: args.approval,
      updatedAt: new Date().toISOString(),
    };
  });
}

// On client approval, release the asset's Cloudflare Stream delivery
// copies. The decision's been made, so there's no reason to keep paying
// for Stream storage - the review player falls back to the (slower) Drive
// proxy automatically when a version has no ready streamUid.
//
// Deletes EVERY version's Stream video (all versions' copies are wasted
// storage once the asset is signed off, not just the approved one) and
// clears streamUid/streamStatus/streamError so the fallback kicks in even
// if the Cloudflare delete fails. Best-effort + idempotent: a failed
// delete leaves an orphan the prune script reaps, and never blocks the
// approval write.
//
// The sync-stream cron skips approved assets, so it won't re-ingest these.
// If the client later un-approves (reset-approval / request-changes), the
// status changes and the cron re-creates the copies on its next tick.
export async function releaseStreamCopiesForAsset(
  cardId: string,
  assetSlug: string,
): Promise<{ deleted: number; failed: number }> {
  const asset = await getAsset(cardId, assetSlug);
  if (!asset) return { deleted: 0, failed: 0 };

  let deleted = 0;
  let failed = 0;
  let touchedAny = false;
  for (const v of asset.versions) {
    if (!v.streamUid) continue;
    touchedAny = true;
    try {
      await deleteVideo(v.streamUid);
      deleted++;
    } catch (err) {
      failed++;
      console.warn(
        `[approval] deleteVideo(${v.streamUid}) for ${assetSlug} failed:`,
        (err as Error).message,
      );
    }
  }

  // Clear the stream fields on every version regardless of delete success -
  // a stale streamUid would make the player try a now-deleted Stream copy
  // instead of falling back to Drive.
  if (touchedAny) {
    await upsertAsset(cardId, assetSlug, (existing) => {
      if (!existing) throw new Error(`asset ${assetSlug} vanished mid-release`);
      return {
        ...existing,
        versions: existing.versions.map((ver) => ({
          ...ver,
          streamUid: null,
          streamStatus: null,
          streamError: null,
        })),
        updatedAt: new Date().toISOString(),
      };
    });
  }
  return { deleted, failed };
}
