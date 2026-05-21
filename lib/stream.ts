// Cloudflare Stream API client - the video-delivery layer.
//
// Thin wrapper over the Stream REST API: ingest a video by URL, poll its
// transcode status, delete it, and build a playback URL. The editor's
// upload still lands in Drive (the master); Stream is a derived,
// CDN-cached, transcoded delivery copy.
//
// Env (see .env.example):
//   CF_ACCOUNT_ID            - Cloudflare account id
//   CF_STREAM_TOKEN          - API token with Account · Stream · Edit
//   CF_STREAM_CUSTOMER_CODE  - the "customer-<code>" playback subdomain

const API_BASE = "https://api.cloudflare.com/client/v4";

function creds(): { accountId: string; token: string } {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_STREAM_TOKEN;
  if (!accountId || !token) {
    throw new Error(
      "CF_ACCOUNT_ID and CF_STREAM_TOKEN must be set. See .env.example.",
    );
  }
  return { accountId, token };
}

// The Cloudflare API success envelope.
type CfEnvelope<T> = {
  success: boolean;
  errors: { code: number; message: string }[];
  messages: unknown[];
  result: T;
};

// The slice of the Stream video object we use. `status.state` walks
// pendingupload/downloading/queued/inprogress → ready (or error).
export type StreamVideo = {
  uid: string;
  readyToStream: boolean;
  status: {
    state: string;
    pctComplete?: string;
    errorReasonCode?: string;
    errorReasonText?: string;
  };
  duration?: number;
  thumbnail?: string;
  playback?: { hls?: string; dash?: string };
  meta?: Record<string, string>;
};

async function cfJson<T>(path: string, init: RequestInit): Promise<T> {
  const { accountId, token } = creds();
  const resp = await fetch(`${API_BASE}/accounts/${accountId}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const json = (await resp
    .json()
    .catch(() => null)) as CfEnvelope<T> | null;
  if (!resp.ok || !json?.success) {
    const detail =
      json?.errors?.map((e) => `${e.code} ${e.message}`).join("; ") ||
      `HTTP ${resp.status}`;
    throw new Error(`Cloudflare Stream ${path} failed: ${detail}`);
  }
  return json.result;
}

// Ingest a video by pulling it from a publicly-fetchable URL. Cloudflare
// downloads + transcodes server-side and returns immediately with a uid;
// transcoding runs async (poll getVideo until readyToStream).
export function copyFromUrl(url: string, name?: string): Promise<StreamVideo> {
  return cfJson<StreamVideo>("/stream/copy", {
    method: "POST",
    body: JSON.stringify({ url, ...(name ? { meta: { name } } : {}) }),
  });
}

// Current state of a Stream video - used to poll a copy to readiness.
export function getVideo(uid: string): Promise<StreamVideo> {
  return cfJson<StreamVideo>(`/stream/${encodeURIComponent(uid)}`, {
    method: "GET",
  });
}

// Every Stream video on the account. Not paginated - the default
// response covers up to 1000 videos, ample here. Used by the
// orphan-prune script to find videos no AssetVersion references.
export function listVideos(): Promise<StreamVideo[]> {
  return cfJson<StreamVideo[]>("/stream", { method: "GET" });
}

// Remove a Stream video (M5 lifecycle - superseded / deleted versions).
export async function deleteVideo(uid: string): Promise<void> {
  const { accountId, token } = creds();
  const resp = await fetch(
    `${API_BASE}/accounts/${accountId}/stream/${encodeURIComponent(uid)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(
      `Cloudflare Stream delete ${uid} failed: HTTP ${resp.status} ${body.slice(0, 200)}`,
    );
  }
}

// HLS manifest URL for a Stream video, built from the customer subdomain.
// (getVideo().playback.hls returns the same URL, but this avoids an API
// round-trip when all we have stored is the uid.)
export function streamHlsUrl(uid: string): string {
  const code = process.env.CF_STREAM_CUSTOMER_CODE;
  if (!code) throw new Error("CF_STREAM_CUSTOMER_CODE must be set.");
  return `https://customer-${code}.cloudflarestream.com/${uid}/manifest/video.m3u8`;
}
