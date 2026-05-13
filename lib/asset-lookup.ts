// Helper used by API routes that key off an asset slug rather than a
// shoot slug: walk every shoot's assets map until we hit a match. Asset
// slugs are globally unique by design (random hash suffix), so there's
// no ambiguity. With our volume of shoots * assets this is cheap; if it
// grows we can add a slug→cardId secondary index.

import { listAll } from "./storage";
import { getAssetsForShoot } from "./asset-storage";
import type { Asset, Shoot } from "./types";

export type AssetLookup = {
  shoot: Shoot;
  asset: Asset;
};

export async function findAssetBySlug(
  slug: string,
): Promise<AssetLookup | null> {
  const shoots = await listAll();
  for (const shoot of shoots) {
    const assets = await getAssetsForShoot(shoot.cardId);
    const a = assets.find((x) => x.slug === slug);
    if (a) return { shoot, asset: a };
  }
  return null;
}
