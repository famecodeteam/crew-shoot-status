/**
 * Drive lookup for per-shoot brief + quote URLs.
 *
 *   Brief - the client brief is named "Brief #NNNN - Client - ...", so we
 *           match on the SHOOT NUMBER, not just the word "brief". A "#NNNN"
 *           folder can hold several "brief"-named docs (editor briefs, VE
 *           briefs, ...) and the client brief sometimes lives outside the
 *           "#NNNN" folder entirely - the number is the only reliable anchor.
 *   Quote - first PDF named "...quote..." inside the "#NNNN" folder. Quote
 *           PDFs aren't named with the shoot number, so they can only be
 *           found by folder. (The signed quote lives as a PDF - that's what
 *           clients should see.)
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

  // 1. Find all folders named exactly "#NNNN". Used for the quote PDF
  //    (whose filename carries no shoot number) and the shoot-folder link.
  const folderResp = await d.files.list({
    q:
      `name = '${escapeQuery(folderName)}' and ` +
      `mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name, webViewLink)",
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const folders = folderResp.data.files ?? [];
  const folderIds = new Set(
    folders.map((f) => f.id).filter((id): id is string => Boolean(id)),
  );

  // 2. BRIEF - anchored on the shoot number. The client brief is named
  //    "Brief #NNNN - ...", so a doc with BOTH the "#NNNN" token and the
  //    word "brief" is the real one - even if it lives outside the "#NNNN"
  //    folder, and regardless of how many other "brief"-named docs (editor
  //    / VE briefs) share that folder. Drive's `contains` is loose, so
  //    query by the bare number and tighten the match in code.
  let briefUrl: string | undefined;
  let briefName: string | undefined;
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
    // If several match, prefer one that sits inside the "#NNNN" folder.
    const inFolder = briefCandidates.find((f) =>
      (f.parents ?? []).some((p) => folderIds.has(p)),
    );
    const chosen = inFolder ?? briefCandidates[0];
    briefUrl = chosen.webViewLink ?? undefined;
    briefName = chosen.name ?? undefined;
  }

  // 3. QUOTE (+ brief fallback) - scan the "#NNNN" folder(s). Multiple
  //    folders named "#NNNN" can exist (an empty placeholder + the real
  //    one); the one carrying the quote PDF is the real one. If the
  //    number-anchored brief search above came up empty, fall back to the
  //    first "brief"-named doc in the folder.
  let quoteUrl: string | undefined;
  let quoteName: string | undefined;
  for (const folder of folders) {
    if (!folder.id) continue;
    const filesResp = await d.files.list({
      q:
        `'${folder.id}' in parents and trashed = false and (` +
        `mimeType = 'application/vnd.google-apps.document' or ` +
        `mimeType = 'application/pdf')`,
      fields: "files(id, name, mimeType, webViewLink, modifiedTime)",
      orderBy: "modifiedTime desc",
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const files = filesResp.data.files ?? [];
    for (const f of files) {
      const name = (f.name ?? "").toLowerCase();
      if (
        !briefUrl &&
        f.mimeType === "application/vnd.google-apps.document" &&
        name.includes("brief")
      ) {
        briefUrl = f.webViewLink ?? undefined;
        briefName = f.name ?? undefined;
      }
      if (!quoteUrl && f.mimeType === "application/pdf" && name.includes("quote")) {
        quoteUrl = f.webViewLink ?? undefined;
        quoteName = f.name ?? undefined;
      }
    }
    // A folder that yielded the quote PDF is the real one - stop here.
    if (quoteUrl) break;
  }

  return {
    shootFolderUrl: folders[0]?.webViewLink ?? undefined,
    briefUrl,
    briefName,
    quoteUrl,
    quoteName,
  };
}

// Useful for diagnostics in the backfill log.
export function driveServiceAccount(): string {
  return serviceAccountEmail();
}
