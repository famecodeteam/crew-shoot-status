// Approval workflow helpers.
//
// Approve / request-changes share most of their behaviour: write the
// approval to the asset record, post a Trello comment, recompute the
// shoot's `Assets Status` summary field, and decide whether to
// auto-move the Trello card.
//
// Card movement (per the brief):
//   - All assets on the shoot approved →
//       move "Assets Shared With Client" → "Assets Approved By Client"
//   - Any asset regresses (pending / changes_requested / new version
//     uploaded triggering a new approval round) →
//       move back to "Assets Shared With Client"
//
// We re-fetch lists at decision time to keep the logic resilient to
// list-name typo fixes on the board. Best-effort: a Trello failure
// doesn't roll back the KV write - comments and status survive.

import {
  addCardComment,
  getBoardCustomFields,
  getBoardLists,
  moveCardToList,
  setCustomFieldText,
} from "./trello";
import { getAssetsForShoot, upsertAsset } from "./asset-storage";
import type { Asset, AssetApproval } from "./types";

const SHARED_WITH_CLIENT = "assets shared with client";
const APPROVED_BY_CLIENT = "assets approved by client";

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

// Mutates the Asset URLs Trello field so each asset's row carries the
// client URL part. Tolerant of the old single-URL format from the
// editor-handoff feature (rows that read "[Name] - [URL]" without an
// "Editor:" / "Client:" prefix); those are preserved with the client
// URL appended on the right.
function asUrlRow(name: string, editorUrl: string | null, clientUrl: string): string {
  const left = editorUrl ? `Editor: ${editorUrl}` : null;
  const right = `Client: ${clientUrl}`;
  return left ? `${name} - ${left} · ${right}` : `${name} - ${right}`;
}

// Parse one row, return { name, editorUrl, clientUrl }. Tolerant of:
//   "Name - Editor: X · Client: Y"     (new)
//   "Name - Editor: X"                 (partial)
//   "Name - Client: Y"                 (partial)
//   "Name - X"                         (old single-URL editor format)
function parseUrlRow(row: string): {
  name: string;
  editorUrl: string | null;
  clientUrl: string | null;
} {
  const m = row.match(/^(.*?)\s+-\s+(.*)$/);
  if (!m) return { name: row.trim(), editorUrl: null, clientUrl: null };
  const name = m[1].trim();
  const rest = m[2];
  const editor = rest.match(/Editor:\s*(\S+)/i);
  const client = rest.match(/Client:\s*(\S+)/i);
  if (editor || client) {
    return {
      name,
      editorUrl: editor ? editor[1] : null,
      clientUrl: client ? client[1] : null,
    };
  }
  // Old single-URL row - treat the bare URL as editor URL (since the
  // legacy feature only wrote editor URLs).
  const urlMatch = rest.match(/(\S+)/);
  return {
    name,
    editorUrl: urlMatch ? urlMatch[1] : null,
    clientUrl: null,
  };
}

export type SyncTrelloOptions = {
  cardId: string;
  // The asset whose state just changed. Used to add/update its row in
  // the Asset URLs field and (if approved) maybe trigger card move.
  changedAssetSlug?: string;
  // Public URL clients use to view the changed asset (the URL we own).
  clientUrlForChangedAsset?: string;
};

// After an asset's approval state changes, sync the Trello-side data:
//   - Asset URLs custom field (per-asset row)
//   - Assets Status custom field (shoot-level summary)
//   - Move card to "Approved By Client" / "Shared With Client" as needed
export async function syncTrelloForShoot(
  opts: SyncTrelloOptions,
): Promise<void> {
  const { cardId, changedAssetSlug, clientUrlForChangedAsset } = opts;

  const assets = await getAssetsForShoot(cardId);
  const boardId = process.env.TRELLO_BOARD_ID;
  if (!boardId) {
    console.warn("[approval] TRELLO_BOARD_ID unset - skipping Trello sync");
    return;
  }

  const [fields, lists] = await Promise.all([
    getBoardCustomFields(boardId),
    getBoardLists(boardId),
  ]);

  // ---- Assets Status field ----
  const statusField = fields.find(
    (f) => f.name.trim().toLowerCase() === "assets status",
  );
  if (statusField) {
    try {
      await setCustomFieldText(cardId, statusField.id, summarizeAssetsForField(assets));
    } catch (err) {
      console.warn("[approval] Assets Status field write failed:", (err as Error).message);
    }
  }

  // ---- Asset URLs field (renamed from Editor Asset URLs) ----
  const urlsField = fields.find((f) => {
    const n = f.name.trim().toLowerCase();
    return n === "asset urls" || n === "editor asset urls";
  });
  if (urlsField && changedAssetSlug && clientUrlForChangedAsset) {
    // We need the existing field value to splice in our updates without
    // clobbering editor URLs we don't know. Fetch the card's custom field
    // items to read the current text.
    // For brevity we re-fetch via the board lookup the caller already
    // ran is overkill here - accept one extra Trello round-trip per
    // approval. Approvals are infrequent.
    const existing = await readCardCustomFieldText(cardId, urlsField.id);
    const rewritten = rewriteAssetUrlsField(existing, assets, {
      changedAssetSlug,
      clientUrlForChangedAsset,
    });
    if (rewritten !== existing) {
      try {
        await setCustomFieldText(cardId, urlsField.id, rewritten);
      } catch (err) {
        console.warn("[approval] Asset URLs field write failed:", (err as Error).message);
      }
    }
  }

  // ---- Auto-card-movement (disabled per Tom's request) ----
  // The forward move (all approved → Assets Approved By Client) used to
  // run automatically here. Tom disabled it because more assets may
  // still be added to a shoot after the initial round is approved, and
  // moving the card prematurely creates noise. Card placement stays
  // manual; this function still updates the comment + custom fields.
  //
  // The revert is also disabled - without the forward move there's
  // nothing for it to revert from in normal flow, and a blanket
  // "move to Shared" on every regression risks pulling the card out
  // of whatever list the PM has placed it in manually.
  //
  // If you want the revert back when a card sits in Approved-By-Client
  // and an asset regresses, re-enable selectively:
  //   const card = await getCard(cardId);
  //   if (card.idList === approvedList?.id && !allApproved && sharedList) {
  //     await moveCardToList(cardId, sharedList.id);
  //   }
  void SHARED_WITH_CLIENT;
  void APPROVED_BY_CLIENT;
  void lists;
}

async function readCardCustomFieldText(
  cardId: string,
  fieldId: string,
): Promise<string> {
  // Minimal Trello call to read just the items for a card; uses the same
  // public REST endpoint as the rest of lib/trello.ts. Keeping the helper
  // local avoids growing the public Trello API surface for one consumer.
  const key = process.env.TRELLO_KEY ?? "";
  const token = process.env.TRELLO_TOKEN ?? "";
  if (!key || !token) return "";
  const url = `https://api.trello.com/1/cards/${encodeURIComponent(cardId)}/customFieldItems?key=${key}&token=${token}`;
  const resp = await fetch(url);
  if (!resp.ok) return "";
  const items = (await resp.json()) as Array<{
    idCustomField: string;
    value?: { text?: string };
  }>;
  const item = items.find((i) => i.idCustomField === fieldId);
  return item?.value?.text?.trim() ?? "";
}

// Re-emit the field so the changed asset's row reflects the new client
// URL while preserving other rows untouched (e.g. an editor row that
// was written by the editor session and we shouldn't overwrite).
function rewriteAssetUrlsField(
  existing: string,
  assets: Asset[],
  changed: {
    changedAssetSlug: string;
    clientUrlForChangedAsset: string;
  },
): string {
  // Index existing rows by asset name (the only field both sides see).
  // If an asset isn't named, we treat that row as opaque and keep it as-is.
  const existingRows = existing.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const byName = new Map<string, { editorUrl: string | null; clientUrl: string | null }>();
  for (const row of existingRows) {
    const { name, editorUrl, clientUrl } = parseUrlRow(row);
    if (name) byName.set(name, { editorUrl, clientUrl });
  }

  // Splice in the changed asset's new client URL.
  const changedAsset = assets.find((a) => a.slug === changed.changedAssetSlug);
  if (changedAsset) {
    const prev = byName.get(changedAsset.name) ?? { editorUrl: null, clientUrl: null };
    byName.set(changedAsset.name, {
      editorUrl: prev.editorUrl,
      clientUrl: changed.clientUrlForChangedAsset,
    });
  }

  // Emit rows in current-assets order, then any "orphaned" rows from the
  // existing field that don't correspond to a known asset (so we don't
  // delete rows we don't understand).
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of assets) {
    const entry = byName.get(a.name);
    if (!entry) continue;
    out.push(asUrlRow(a.name, entry.editorUrl, entry.clientUrl ?? ""));
    seen.add(a.name);
  }
  for (const [name, entry] of byName) {
    if (seen.has(name)) continue;
    if (entry.editorUrl || entry.clientUrl) {
      out.push(asUrlRow(name, entry.editorUrl, entry.clientUrl ?? ""));
    }
  }
  return out.join("\n");
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
