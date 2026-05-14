/**
 * Drive lookup for per-shoot brief + quote URLs.
 *
 *   Brief - the client brief is named "Brief #NNNN - Client - ...", so we
 *           match on the SHOOT NUMBER, not just the word "brief". A "#NNNN"
 *           folder can hold several "brief"-named docs (editor briefs, VE
 *           briefs, ...) and the client brief sometimes lives outside the
 *           "#NNNN" folder entirely - the number is the only reliable anchor.
 *   Quote - first PDF named "...quote..." in the shoot folder. Quote PDFs
 *           carry no shoot number, so they can only be found by folder -
 *           and the shoot folder is taken from the BRIEF's parent (the real
 *           folder, even when it's mis-named: "#2019" for shoot #0219),
 *           falling back to a folder literally named "#NNNN". (The signed
 *           quote lives as a PDF - that's what clients should see.)
 *
 * This module only provides brief + quote. Finished video deliverables are
 * the per-asset video-review feature now, not a Drive link.
 */

import { google } from "googleapis";
import { googleAuth, serviceAccountEmail } from "./google-auth";

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

export type ShootDriveLinks = {
  briefUrl?: string;
  briefName?: string;
  quoteUrl?: string;
  quoteName?: string;
  shootFolderUrl?: string;
};

let driveClient: ReturnType<typeof google.drive> | null = null;

function drive() {
  if (!driveClient) {
    const auth = googleAuth(DRIVE_SCOPES);
    driveClient = google.drive({ version: "v3", auth });
  }
  return driveClient;
}

// Drive query escaping - single quotes need to be doubled.
function escapeQuery(s: string): string {
  return s.replace(/'/g, "\\'");
}

/**
 * Find a single shoot's brief + quote URLs.
 *
 * Brief lookup is anchored on the shoot NUMBER (see the module header):
 * the doc that has both the "#NNNN" token and the word "brief" in its
 * name is the client brief, wherever it lives. The quote and the
 * shoot-folder link still come from the "#NNNN" folder.
 */
export async function findShootDriveLinks(shootNumber: string): Promise<ShootDriveLinks> {
  const stripped = shootNumber.replace(/^#/, "").trim();
  if (!stripped) return {};
  const folderName = `#${stripped}`;

  const d = drive();

  // 1. Folders named exactly "#NNNN". Not a reliable anchor on their own -
  //    one can be an empty placeholder while the real shoot folder is
  //    mis-named (e.g. "#2019" for shoot #0219) - but a correctly-named,
  //    populated one is still worth scanning, and is the fallback.
  const folderResp = await d.files.list({
    q:
      `name = '${escapeQuery(folderName)}' and ` +
      `mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name, webViewLink)",
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const namedFolders = folderResp.data.files ?? [];

  // 2. BRIEF - anchored on the shoot number. The client brief is named
  //    "Brief #NNNN - ...", so a doc with BOTH the "#NNNN" token and the
  //    word "brief" is the real one - even if it lives outside any "#NNNN"
  //    folder, and regardless of how many other "brief"-named docs (editor
  //    / VE briefs) share that folder. Drive's `contains` is loose, so
  //    query by the bare number and tighten the match in code. We also
  //    keep the brief's parent: it's the real shoot folder, even when that
  //    folder's name has a typo.
  let briefUrl: string | undefined;
  let briefName: string | undefined;
  let briefParentIds: string[] = [];
  const briefResp = await d.files.list({
    q:
      `name contains '${escapeQuery(stripped)}' and ` +
      `mimeType = 'application/vnd.google-apps.document' and trashed = false`,
    fields: "files(id, name, parents, webViewLink)",
    pageSize: 50,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const briefCandidates = (briefResp.data.files ?? []).filter((f) => {
    const name = f.name ?? "";
    return name.includes(folderName) && name.toLowerCase().includes("brief");
  });
  if (briefCandidates.length) {
    const chosen =
      briefCandidates.find((f) => (f.parents ?? []).length) ?? briefCandidates[0];
    briefUrl = chosen.webViewLink ?? undefined;
    briefName = chosen.name ?? undefined;
    briefParentIds = chosen.parents ?? [];
  }

  // 3. QUOTE (+ brief fallback) - scan the shoot folder(s). Quote PDFs
  //    carry no shoot number, so they can only be found by folder. Scan
  //    the brief's parent first (the real shoot folder, even if it's
  //    mis-named), then any "#NNNN"-named folders as a fallback.
  const scanFolderIds: string[] = [];
  for (const id of [...briefParentIds, ...namedFolders.map((f) => f.id)]) {
    if (id && !scanFolderIds.includes(id)) scanFolderIds.push(id);
  }

  let quoteUrl: string | undefined;
  let quoteName: string | undefined;
  let shootFolderId: string | undefined;
  for (const folderId of scanFolderIds) {
    const filesResp = await d.files.list({
      q:
        `'${folderId}' in parents and trashed = false and (` +
        `mimeType = 'application/vnd.google-apps.document' or ` +
        `mimeType = 'application/pdf')`,
      fields: "files(id, name, mimeType, webViewLink, modifiedTime)",
      orderBy: "modifiedTime desc",
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    let matched = false;
    for (const f of filesResp.data.files ?? []) {
      const name = (f.name ?? "").toLowerCase();
      if (
        !briefUrl &&
        f.mimeType === "application/vnd.google-apps.document" &&
        name.includes("brief")
      ) {
        briefUrl = f.webViewLink ?? undefined;
        briefName = f.name ?? undefined;
        matched = true;
      }
      if (!quoteUrl && f.mimeType === "application/pdf" && name.includes("quote")) {
        quoteUrl = f.webViewLink ?? undefined;
        quoteName = f.name ?? undefined;
        matched = true;
      }
    }
    // The folder that actually held brief/quote content is the real one.
    if (matched && !shootFolderId) shootFolderId = folderId;
    if (quoteUrl) break;
  }

  const shootFolderUrl = shootFolderId
    ? `https://drive.google.com/drive/folders/${shootFolderId}`
    : (namedFolders[0]?.webViewLink ?? undefined);

  return { shootFolderUrl, briefUrl, briefName, quoteUrl, quoteName };
}

// Useful for diagnostics in the backfill log.
export function driveServiceAccount(): string {
  return serviceAccountEmail();
}
