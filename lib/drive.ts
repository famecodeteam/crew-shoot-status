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
 * Stream a Drive file's bytes via the service account (which always has
 * access), plus its metadata. Used by the asset-download proxy so client
 * downloads never depend on the file being shared "anyone with link" -
 * the proxy/transcode pipeline grants then REVOKES that sharing, which is
 * why direct drive.google.com/uc?export=download links kept failing for
 * clients. Returns null if the file is missing / inaccessible.
 *
 * Robustness for large finished cuts:
 *   - Honours the client's `Range` header: passes it straight to Drive and
 *     reports back the 206 status + Content-Range so the route can serve a
 *     partial response. This is the key reliability lever - browsers and
 *     download managers resume a dropped transfer (and can parallelise it)
 *     instead of restarting a multi-GB file from zero, and no single request
 *     has to survive the whole serverless time budget.
 *   - Retries the open on transient (5xx / 429 / network) failures; fails
 *     fast on 4xx (missing / no access won't get better).
 */
export async function getDriveDownload(
  fileId: string,
  opts?: { range?: string | null },
): Promise<{
  stream: NodeJS.ReadableStream;
  name: string;
  mimeType: string;
  size: number | null;
  /** 206 when Drive honoured a Range request, else 200. */
  status: number;
  /** "bytes start-end/total" when partial, else null. */
  contentRange: string | null;
  /** Bytes in THIS response (the slice for a 206), if Drive reported it. */
  contentLength: number | null;
} | null> {
  const d = drive();
  const range = opts?.range?.trim() || undefined;
  try {
    const meta = await withDriveRetry(() =>
      d.files.get({
        fileId,
        fields: "name, mimeType, size",
        supportsAllDrives: true,
      }),
    );
    const res = await withDriveRetry(() =>
      d.files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        {
          responseType: "stream",
          ...(range ? { headers: { Range: range } } : {}),
        },
      ),
    );
    const headers = res.headers as Record<string, string | undefined>;
    const cl = headers["content-length"];
    return {
      stream: res.data as unknown as NodeJS.ReadableStream,
      name: meta.data.name ?? "download",
      mimeType: meta.data.mimeType ?? "application/octet-stream",
      size: meta.data.size ? Number(meta.data.size) : null,
      status: res.status ?? 200,
      contentRange: headers["content-range"] ?? null,
      contentLength: cl != null ? Number(cl) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Retry a Drive call on transient failures. 5xx / 429 / network blips get a
 * short backoff; 4xx (404 missing, 403 no access) throw immediately since a
 * retry can't fix them.
 */
async function withDriveRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status =
        (err as { code?: number })?.code ??
        (err as { response?: { status?: number } })?.response?.status;
      const transient =
        typeof status !== "number" || status >= 500 || status === 429;
      if (!transient || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
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
  const raw = shootNumber.replace(/^#/, "").trim();
  if (!raw) return {};
  // Sub-shoots carry a trailing letter (#0225a / #0225b - a Trello-card
  // split for multi-leg or split-day bookings) but share ONE
  // base-numbered Drive folder (#0225); the suffix is never part of the
  // Drive naming. Resolve brief + quote against the base number.
  const stripped = raw.replace(/[a-z]$/i, "");
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
    // Prefer a brief whose name has no unfilled "[[...]]" template
    // placeholder - a half-edited template copy must not beat the real
    // brief when several "#NNNN ... brief" docs share the folder.
    const chosen =
      briefCandidates.find(
        (f) => (f.parents ?? []).length && !(f.name ?? "").includes("[["),
      ) ??
      briefCandidates.find((f) => (f.parents ?? []).length) ??
      briefCandidates[0];
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
