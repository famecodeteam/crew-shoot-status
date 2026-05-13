// STEP 0 POC — proxies a Google Drive video to an HTML5 <video> tag.
// Authenticates with the shared service account, forwards the incoming
// Range header to Drive's `/files/FILE_ID?alt=media` endpoint, streams
// the byte range back as 206 Partial Content.
//
// Once the POC clears (Chrome desktop + iOS Safari + Android Chrome +
// scrubbing + >200MB file), this same shape becomes the production
// /api/video/[asset]/v[n] route.

import { google } from "googleapis";
import type { NextRequest } from "next/server";
import { googleAuth } from "@/lib/google-auth";

// Force Node runtime (googleapis pulls Node-only deps; Edge would fail).
export const runtime = "nodejs";
// Don't pre-render this route.
export const dynamic = "force-dynamic";
// Cap how long we keep the connection open; large videos can stream for a while.
export const maxDuration = 60;

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

let cachedClient: Awaited<ReturnType<typeof getAuthClient>> | null = null;

async function getAuthClient() {
  const auth = googleAuth(DRIVE_SCOPES);
  return auth.getClient();
}

async function getAccessToken(): Promise<string> {
  if (!cachedClient) cachedClient = await getAuthClient();
  const tok = await cachedClient.getAccessToken();
  // The OAuth2Client returns either { token: string } or a string depending
  // on the path. Normalize.
  if (typeof tok === "string") return tok;
  if (tok?.token) return tok.token;
  throw new Error("No Google access token returned");
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id || !/^[A-Za-z0-9_-]{20,}$/.test(id)) {
    return new Response("Bad or missing `id`", { status: 400 });
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("[test-video] auth failed:", err);
    return new Response("Auth failed", { status: 500 });
  }

  const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`;
  const range = req.headers.get("range") ?? undefined;

  const upstream = await fetch(driveUrl, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(range ? { range } : {}),
    },
    // Disable Next's data cache for the response stream — we proxy 1:1.
    cache: "no-store",
  });

  if (!upstream.ok && upstream.status !== 206) {
    const body = await upstream.text().catch(() => "");
    console.error(
      `[test-video] drive ${upstream.status}: ${body.slice(0, 200)}`,
    );
    return new Response(`Drive upstream ${upstream.status}`, {
      status: upstream.status,
    });
  }

  // Forward the bytes + the headers that <video> cares about.
  const out = new Headers();
  out.set("content-type", upstream.headers.get("content-type") ?? "video/mp4");
  out.set("accept-ranges", "bytes");
  const len = upstream.headers.get("content-length");
  if (len) out.set("content-length", len);
  const cr = upstream.headers.get("content-range");
  if (cr) out.set("content-range", cr);

  // Cache at the Vercel edge so subsequent viewers don't re-hit Drive.
  // Vary on Range so partial ranges are cached separately. (Note: Vercel's
  // edge currently has limited Range-aware caching; treat this as a hint
  // rather than guaranteed.)
  out.set("cache-control", "public, max-age=86400, s-maxage=86400");
  out.set("vary", "range");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: out,
  });
}
