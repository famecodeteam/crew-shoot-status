// Read the crew app's per-shoot "assets locked" flag from the shared KV.
//
// member.fame.so's internal index writes `assets-locked:<cardId>` (a bare
// `true`, deleted when unlocked) when a CPM locks a shoot whose invoice is
// unpaid. This client review surface reads the SAME key - keyed by the Trello
// cardId both repos share - and, when locked, hides every download + Drive
// affordance while still allowing playback. Same backend dispatch (Upstash
// REST or node-redis) as lib/proxies.ts.

let upstash: import("@upstash/redis").Redis | null = null;
let node: import("redis").RedisClientType | null = null;

export async function getAssetsLocked(cardId: string): Promise<boolean> {
  const key = `assets-locked:${cardId}`;
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
      return (await upstash.get<boolean>(key)) === true;
    }
    if (process.env.REDIS_URL) {
      if (!node) {
        const { createClient } = await import("redis");
        node = createClient({ url: process.env.REDIS_URL });
        node.on("error", (e) => console.error("[assets-lock] redis error:", e));
        await node.connect();
      }
      // node-redis returns the raw stored string; Upstash serialises the
      // boolean as JSON, so accept both `true` and `"true"`.
      const raw = await node.get(key);
      return raw === "true" || raw === "1";
    }
  } catch (err) {
    // Never load-bearing: a KV miss just means "not locked", so the client
    // keeps their normal download access rather than being wrongly cut off.
    console.warn("[assets-lock] read failed:", err);
  }
  return false;
}
