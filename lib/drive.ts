/**
 * Drive lookup for per-shoot brief + quote URLs.
 * Mirrors fame_crew_scout-v0.6.9.gs scoutFindShootDrive_:
 *   1. Find the folder titled exactly "#NNNN".
 *   2. Brief = first Google Doc in that folder whose name contains "brief".
 *   3. Quote = first PDF in that folder whose name contains "quote".
 *      (The signed quote lives as PDF; the raw quote lives as a Google Doc.
 *       Crew Scout returns the signed PDF - that's what clients should see.)
 *
 * Final assets URL is NOT sourced from Drive - it comes from the
 * "Final Asset URL" Trello custom field. This module only provides
 * brief + quote.
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
 * Returns an empty object if the folder isn't found or files are missing.
 *
 * Multiple folders named "#NNNN" can exist in the SA's view (e.g. an empty
 * placeholder under the client folder + the real one elsewhere). We list
 * the children of each candidate and return the first folder whose
 * contents actually match the brief/quote criteria. If none of the
 * candidates have matching files, we fall through to the first folder's
 * URL so we at least surface *a* shoot folder link.
 */
export async function findShootDriveLinks(shootNumber: string): Promise<ShootDriveLinks> {
  const stripped = shootNumber.replace(/^#/, "").trim();
  if (!stripped) return {};
  const folderName = `#${stripped}`;

  const d = drive();

  // 1. Find all folders matching the name.
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
  if (folders.length === 0) return {};

  // 2. For each candidate folder, list children and look for brief / quote.
  //    Return as soon as we find one that has at least one matching file.
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

    let briefUrl: string | undefined;
    let briefName: string | undefined;
    let quoteUrl: string | undefined;
    let quoteName: string | undefined;
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
      if (briefUrl && quoteUrl) break;
    }

    if (briefUrl || quoteUrl) {
      return {
        shootFolderUrl: folder.webViewLink ?? undefined,
        briefUrl,
        briefName,
        quoteUrl,
        quoteName,
      };
    }
  }

  // No candidate had a matching brief or quote. Still surface the first
  // folder's URL so we link to *something* sensible.
  return { shootFolderUrl: folders[0].webViewLink ?? undefined };
}

// Useful for diagnostics in the backfill log.
export function driveServiceAccount(): string {
  return serviceAccountEmail();
}
