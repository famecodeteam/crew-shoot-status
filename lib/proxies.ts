// Read the crew app's Mux proxy states (shared KV: `proxies:<cardId>`, keyed by
// Drive file id) so the client-facing asset poster can use the Mux thumbnail.
//
// Why this is the reliable poster source, not a best-effort one: the crew app
// (member.fame.so) generates a Mux proxy for every reviewed asset version -
// including the multi-GB masters Drive refuses to thumbnail and Cloudflare
// Stream may not have ingested yet - and asset QA already runs against it. The
// resulting `image.mux.com/<playbackId>/thumbnail.jpg` is a public, no-auth
// still, so a card gets a real frame the moment the proxy is ready, regardless
// of Stream. We read the same `proxies:<cardId>` blob the crew app writes
// (this repo shares its Redis), joining on the version's Drive file id.
//
// Only the ready `playbackId` is needed here; the full ProxyState union lives
// in the crew repo. Same backend dispatch (Upstash REST or node-redis) as
// asset-storage, so it follows whichever store this deployment uses.

type ProxyState = { status?: string; playbackId?: string };

let upstash: import("@upstash/redis").Redis | null = null;
let node: import("redis").RedisClientType | null = null;

// Returns Drive-file-id -> Mux playback id for every version whose proxy is
// ready. Absent keys (still generating, failed, or never enqueued) simply fall
// through to the next poster source at the call site.
export async function getProxyPlaybackIds(
  cardId: string,
): Promise<Record<string, string>> {
  const states = await readProxyStates(cardId);
  const out: Record<string, string> = {};
  for (const [driveFileId, st] of Object.entries(states)) {
    if (st?.status === "ready" && st.playbackId) {
      out[driveFileId] = st.playbackId;
    }
  }
  return out;
}

async function readProxyStates(
  cardId: string,
): Promise<Record<string, ProxyState>> {
  const key = `proxies:${cardId}`;
  try {
    if (
      process.env.UPSTASH_KV_REST_API_URL &&
      process.env.UPSTASH_KV_REST_API_TOKEN
    ) {
      if (!upstash) {
        const { Redis } = await import("@upstash/redis");
        upstash = new Redis({
          url: process.env.UPSTASH_KV_REST_API_URL,
          token: process.env.UPSTASH_KV_REST_API_TOKEN,
        });
      }
      return (await upstash.get<Record<string, ProxyState>>(key)) ?? {};
    }
    if (process.env.REDIS_URL) {
      if (!node) {
        const { createClient } = await import("redis");
        node = createClient({ url: process.env.REDIS_URL });
        node.on("error", (e) => console.error("[proxies] redis error:", e));
        await node.connect();
      }
      const raw = await node.get(key);
      return raw ? (JSON.parse(raw) as Record<string, ProxyState>) : {};
    }
  } catch (err) {
    // A poster enhancement, never load-bearing: a KV miss just means the card
    // falls back to the Drive thumbnail / gradient, so swallow and move on.
    console.warn("[proxies] read failed:", err);
  }
  return {};
}
