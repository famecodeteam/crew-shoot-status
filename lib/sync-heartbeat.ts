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
// Also keyed per trigger. With a 5-minute cron overwriting a single "last run"
// slot, a push is invisible within a minute of happening - which made the
// heartbeat useless for answering "did that status change reach the client?"
// and had us chasing a bug that may not have existed.
const KEY_BY_TRIGGER = (t: string) => `sync:last-run:${t}`;

export type SyncHeartbeat = {
  at: string;
  trigger: "cron" | "manual" | "push" | "unknown";
  ok: boolean;
  durationMs: number;
  fetched?: number;
  upserted?: number;
  failed?: number;
  /** Shoots whose feed timestamp matched the copy we hold - the whole point
   *  of the incremental pass. */
  unchanged?: number;
  /** True when this run reconciled every shoot rather than only changed ones. */
  fullPass?: boolean;
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
  const payload = JSON.stringify(beat);
  await Promise.all([
    c.set(KEY, payload).catch(() => {}),
    c.set(KEY_BY_TRIGGER(beat.trigger), payload).catch(() => {}),
  ]);
}

/** The most recent run of each kind, so a push stays visible after the cron
 *  has run again. */
export async function readSyncHeartbeatsByTrigger(): Promise<
  Record<string, SyncHeartbeat | null>
> {
  const c = client();
  if (!c) return {};
  const triggers = ["cron", "push", "manual"];
  const out: Record<string, SyncHeartbeat | null> = {};
  await Promise.all(
    triggers.map(async (t) => {
      const raw = (await c.get(KEY_BY_TRIGGER(t)).catch(() => null)) as
        | SyncHeartbeat
        | string
        | null;
      out[t] = !raw
        ? null
        : typeof raw === "string"
          ? (JSON.parse(raw) as SyncHeartbeat)
          : raw;
    }),
  );
  return out;
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

const FULL_KEY = "sync:last-full-pass";

/** When the last FULL reconcile ran. Incremental runs skip shoots whose
 *  shoots.updated_at hasn't moved, but the feed also joins crew_members and
 *  shoot_crew - a photo, bio or roster change doesn't bump that timestamp, so
 *  a periodic full pass is what stops those quietly never arriving. */
export async function readLastFullPass(): Promise<number | null> {
  const c = client();
  if (!c) return null;
  const raw = (await c.get(FULL_KEY).catch(() => null)) as number | string | null;
  if (raw == null) return null;
  return typeof raw === "string" ? Number(raw) : raw;
}

export async function recordFullPass(at: number): Promise<void> {
  const c = client();
  if (!c) return;
  await c.set(FULL_KEY, String(at)).catch(() => {});
}

