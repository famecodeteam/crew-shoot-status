/**
 * Drive lookup for per-shoot brief + quote URLs.
 * Mirrors fame_crew_scout-v0.6.9.gs scoutFindShootDrive_:
 *   1. Find the folder titled exactly "#NNNN".
 *   2. Brief = first Google Doc in that folder whose name contains "brief".
 *   3. Quote = first PDF in that folder whose name contains "quote".
 *      (The signed quote lives as PDF; the raw quote lives as a Google Doc.
 *       Crew Scout returns the signed PDF — that's what clients should see.)
 *
 * Final assets URL is NOT sourced from Drive — it comes from the
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

// Drive query escaping — single quotes need to be doubled.
function escapeQuery(s: string): string {
  return s.replace(/'/g, "\\'");
}

/**
 * Find a single shoot's brief + quote URLs.
 * Returns an empty object if the folder isn't found or files are missing.
 */
export async function findShootDriveLinks(shootNumber: string): Promise<ShootDriveLinks> {
  const stripped = shootNumber.replace(/^#/, "").trim();
  if (!stripped) return {};
  const folderName = `#${stripped}`;

  const d = drive();

  // 1. Find the folder. Search across all drives the SA has access to,
  //    so this works whether the folder lives in a shared drive or not.
  const folderResp = await d.files.list({
    q:
      `name = '${escapeQuery(folderName)}' and ` +
      `mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name, webViewLink)",
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const folder = folderResp.data.files?.[0];
  if (!folder?.id) return {};

  const out: ShootDriveLinks = {
    shootFolderUrl: folder.webViewLink ?? undefined,
  };

  // 2. List children: Google Docs (for brief) + PDFs (for quote).
  //    One query for both — saves a round trip.
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
      !out.briefUrl &&
      f.mimeType === "application/vnd.google-apps.document" &&
      name.includes("brief")
    ) {
      out.briefUrl = f.webViewLink ?? undefined;
      out.briefName = f.name ?? undefined;
    }
    if (!out.quoteUrl && f.mimeType === "application/pdf" && name.includes("quote")) {
      out.quoteUrl = f.webViewLink ?? undefined;
      out.quoteName = f.name ?? undefined;
    }
    if (out.briefUrl && out.quoteUrl) break;
  }

  return out;
}

// Useful for diagnostics in the backfill log.
export function driveServiceAccount(): string {
  return serviceAccountEmail();
}
