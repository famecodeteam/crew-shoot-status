// Local dev: one JSON file per asset's activity list, one per
// comment-auth record, under .data/. The dev file store is single-process
// and not shared, so read-rebuild-write is fine here (unlike the Redis
// impls, which back a list shared with member.fame.so).

import { promises as fs } from "node:fs";
import path from "node:path";
import type { AssetActivity, CommentAuth } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const ACTIVITY_DIR = path.join(DATA_DIR, "activity");
const AUTH_DIR = path.join(DATA_DIR, "comment-auth");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function activityFile(cardId: string, assetSlug: string): string {
  return path.join(ACTIVITY_DIR, `${cardId}-${assetSlug}.json`);
}

function authFile(activityId: string): string {
  return path.join(AUTH_DIR, `${activityId}.json`);
}

export async function appendActivity(
  cardId: string,
  assetSlug: string,
  entry: AssetActivity,
): Promise<void> {
  const file = activityFile(cardId, assetSlug);
  const list = await readJson<AssetActivity[]>(file, []);
  list.push(entry);
  await writeJson(file, list);
}

export async function listActivity(
  cardId: string,
  assetSlug: string,
): Promise<AssetActivity[]> {
  return readJson<AssetActivity[]>(activityFile(cardId, assetSlug), []);
}

export async function replaceActivity(
  cardId: string,
  assetSlug: string,
  entry: AssetActivity,
): Promise<boolean> {
  const file = activityFile(cardId, assetSlug);
  const list = await readJson<AssetActivity[]>(file, []);
  const idx = list.findIndex((e) => e.id === entry.id);
  if (idx === -1) return false;
  list[idx] = entry;
  await writeJson(file, list);
  return true;
}

export async function removeActivity(
  cardId: string,
  assetSlug: string,
  id: string,
): Promise<boolean> {
  const file = activityFile(cardId, assetSlug);
  const list = await readJson<AssetActivity[]>(file, []);
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  await writeJson(file, list);
  return true;
}

export async function getCommentAuth(
  activityId: string,
): Promise<CommentAuth | null> {
  return readJson<CommentAuth | null>(authFile(activityId), null);
}

export async function setCommentAuth(
  activityId: string,
  auth: CommentAuth,
): Promise<void> {
  await writeJson(authFile(activityId), auth);
}

export async function deleteCommentAuth(activityId: string): Promise<void> {
  await fs.rm(authFile(activityId), { force: true });
}
