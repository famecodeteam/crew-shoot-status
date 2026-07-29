// Records when the shoot sync last ran, and how it went.
//
// Client status pages have gone stale three times now - a shoot's status not
// reaching the client until someone pressed "Sync to client page" by hand -
// and each time the 5-minute cron was suspected but nobody could tell whether
// it had actually run. Vercel's runtime logs aren't reachable from the CLI or
// API on this plan, so without a stored heartbeat the question is unanswerable
// and the guess just gets repeated.
//
// Written on every run including failures, so "ran and errored" is
// distinguishable from "never ran" - those need opposite fixes.

import { Redis } from "@upstash/redis";

const KEY = "sync:last-run";

export type SyncHeartbeat = {
  at: string;
  trigger: "cron" | "manual" | "unknown";
  ok: boolean;
  durationMs: number;
  fetched?: number;
  upserted?: number;
  failed?: number;
  error?: string;
};

let cached: Redis | null = null;
function client(): Redis | null {
  if (cached) return cached;
  const url = process.env.UPSTASH_KV_REST_API_URL;
  const token = process.env.UPSTASH_KV_REST_API_TOKEN;
  if (!url || !token) return null;
  cached = new Redis({ url, token });
  return cached;
}

export async function recordSyncRun(beat: SyncHeartbeat): Promise<void> {
  const c = client();
  if (!c) return;
  await c.set(KEY, JSON.stringify(beat)).catch(() => {});
}

export async function readSyncHeartbeat(): Promise<SyncHeartbeat | null> {
  const c = client();
  if (!c) return null;
  const raw = (await c.get(KEY).catch(() => null)) as
    | SyncHeartbeat
    | string
    | null;
  if (!raw) return null;
  return typeof raw === "string" ? (JSON.parse(raw) as SyncHeartbeat) : raw;
}
