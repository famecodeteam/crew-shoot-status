// GET /api/asset/<asset-slug>/v<n>/download
//
// Server-side download proxy for a finished asset version. Streams the
// Drive file through the service account instead of handing the client a
// drive.google.com/uc?export=download link. Direct Drive links require the
// file to be shared "anyone with link", but the proxy/transcode pipeline
// grants then REVOKES that sharing - so those links kept failing for
// clients ("You need access"). Streaming via the service account, which
// always has access, makes downloads work regardless of sharing state, and
// keeps the file private (only the unguessable review URL reaches it).
//
// Security: only versions a client may see (isPublishedToClient !== false)
// are downloadable, and the asset slug is unguessable - the same model as
// the rest of the client review surface. We never accept a raw fileId.

import type { NextRequest } from "next/server";
import { Readable } from "node:stream";
import { findAssetBySlug } from "@/lib/asset-lookup";
import { clientVersions } from "@/lib/asset-versions";
import { getDriveDownload } from "@/lib/drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Large finished cuts can take a while to stream through.
export const maxDuration = 300;

function parseVersion(raw: string): number | null {
  const n = Number(raw.replace(/^v/, ""));
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ asset: string; version: string }> },
): Promise<Response> {
  const { asset: slug, version: vRaw } = await ctx.params;
  const n = parseVersion(vRaw);
  if (!n) return new Response("bad version", { status: 400 });

  const lookup = await findAssetBySlug(slug);
  if (!lookup) return new Response("unknown asset", { status: 404 });

  // Only client-visible (published) versions are downloadable.
  const version = clientVersions(lookup.asset).find((v) => v.n === n);
  if (!version?.driveFileId) {
    return new Response("version not available", { status: 404 });
  }

  // Pass the client's Range through to Drive so large downloads resume /
  // chunk instead of restarting from zero on a dropped connection.
  const range = req.headers.get("range");
  const file = await getDriveDownload(version.driveFileId, { range });
  if (!file) return new Response("file unavailable", { status: 502 });

  const filename = sanitizeFilename(
    version.filename || `${lookup.asset.name} v${n}.mp4`,
  );
  const headers: Record<string, string> = {
    "Content-Type": file.mimeType,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
    // Advertise range support so download managers / browsers resume + chunk.
    "Accept-Ranges": "bytes",
  };

  // Drive honoured the Range → serve a 206 with the slice's Content-Range +
  // Content-Length. Otherwise a normal 200 with the full size.
  const isPartial = file.status === 206 && !!file.contentRange;
  if (isPartial) {
    headers["Content-Range"] = file.contentRange!;
    if (file.contentLength != null) {
      headers["Content-Length"] = String(file.contentLength);
    }
  } else if (file.size != null) {
    headers["Content-Length"] = String(file.size);
  }

  // Node Readable -> web ReadableStream for the Response body. A mid-stream
  // Drive blip propagates and aborts the response; the client retries the
  // failed range rather than the whole file.
  const body = Readable.toWeb(
    file.stream as Readable,
  ) as unknown as ReadableStream;
  return new Response(body, { status: isPartial ? 206 : 200, headers });
}

/** Strip characters that would break the Content-Disposition header. */
function sanitizeFilename(name: string): string {
  return name.replace(/["\\\r\n]/g, "").trim() || "download.mp4";
}
