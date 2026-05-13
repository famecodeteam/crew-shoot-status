// Local dev: one JSON file per shoot for assets, one JSON file per
// (asset, version) for comments. Easier to inspect by hand than a single
// blob.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Asset, Comment } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const ASSETS_DIR = path.join(DATA_DIR, "assets");
const COMMENTS_DIR = path.join(DATA_DIR, "comments");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function getAssetsByCardId(
  cardId: string,
): Promise<Record<string, Asset>> {
  return readJson(path.join(ASSETS_DIR, `${cardId}.json`), {});
}

export async function setAssetsByCardId(
  cardId: string,
  all: Record<string, Asset>,
): Promise<void> {
  await writeJson(path.join(ASSETS_DIR, `${cardId}.json`), all);
}

export async function getCommentsByVersion(
  slug: string,
  version: number,
): Promise<Comment[]> {
  return readJson(path.join(COMMENTS_DIR, `${slug}-v${version}.json`), []);
}

export async function setCommentsByVersion(
  slug: string,
  version: number,
  list: Comment[],
): Promise<void> {
  await writeJson(path.join(COMMENTS_DIR, `${slug}-v${version}.json`), list);
}
