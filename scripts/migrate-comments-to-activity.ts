// Migrate legacy comments into the shared activity stream
// (shared-KV contract v2 §9 step b).
//
//   comments:<assetSlug>:v<N>  ->  comment_client entries appended to
//   activity:<cardId>:<assetSlug>, in createdAt order, each tagged
//   meta.fromComment = <old id>; the author token + audit fields move
//   into comment-auth:<activityId>.
//
// Idempotent: a comment already represented in the activity stream (an
// entry whose meta.fromComment is the old id) is skipped - so this is
// safe to re-run, and safe to run before or after the route deploy (the
// route read path merges either way).
//
// Dry-run by default; pass --write to apply.
//   pnpm tsx --env-file=<env-file> scripts/migrate-comments-to-activity.ts
//   pnpm tsx --env-file=<env-file> scripts/migrate-comments-to-activity.ts --write

import { listAll as listShoots } from "../lib/storage";
import { getAssetsForShoot, listComments } from "../lib/asset-storage";
import {
  appendActivity,
  listActivity,
  setCommentAuth,
} from "../lib/activity-storage";
import { newActivityId } from "../lib/comment-id";
import type { AssetActivity, Comment } from "../lib/types";

type Candidate = {
  cardId: string;
  assetSlug: string;
  version: number;
  comment: Comment;
};

async function main() {
  const doWrite = process.argv.includes("--write");
  let scanned = 0;
  let migrated = 0;
  let skipped = 0;

  for (const shoot of await listShoots()) {
    for (const asset of await getAssetsForShoot(shoot.cardId)) {
      // Old comment ids already represented in this asset's activity list.
      const activity = await listActivity(shoot.cardId, asset.slug);
      const already = new Set(
        activity
          .map((a) =>
            typeof a.meta?.fromComment === "string" ? a.meta.fromComment : null,
          )
          .filter((x): x is string => x !== null),
      );

      // Gather every version's legacy comments, then order by createdAt
      // across the whole asset (contract §9b).
      const candidates: Candidate[] = [];
      for (const v of asset.versions) {
        for (const c of await listComments(asset.slug, v.n)) {
          candidates.push({
            cardId: shoot.cardId,
            assetSlug: asset.slug,
            version: v.n,
            comment: c,
          });
        }
      }
      candidates.sort((a, b) =>
        a.comment.createdAt.localeCompare(b.comment.createdAt),
      );

      for (const cand of candidates) {
        scanned++;
        const c = cand.comment;
        if (already.has(c.id)) {
          skipped++;
          continue;
        }
        const entry: AssetActivity = {
          id: newActivityId(),
          type: "comment_client",
          actorName: c.authorName,
          actorRole: "client",
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          body: c.text,
          targetVersionN: cand.version,
          timestampSeconds: c.timestampSeconds,
          resolved: c.resolved,
          parentId: null,
          meta: { fromComment: c.id },
        };
        console.log(
          `  ${doWrite ? "migrate" : "would  "}  ${cand.assetSlug} v${cand.version}  ${c.id} -> ${entry.id}  "${c.text.slice(0, 48).replace(/\s+/g, " ")}"`,
        );
        if (doWrite) {
          await appendActivity(cand.cardId, cand.assetSlug, entry);
          await setCommentAuth(entry.id, {
            authorToken: c.authorToken,
            authorIp: c.authorIp,
            authorUa: c.authorUa,
          });
          already.add(c.id);
        }
        migrated++;
      }
    }
  }

  console.log(
    `\nscanned ${scanned} legacy comment(s); ${doWrite ? "migrated" : "would migrate"} ${migrated}, skipped ${skipped} (already migrated).`,
  );
  if (!doWrite) {
    console.log("\n(dry-run) re-run with --write to apply.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.stack ?? e?.message ?? e);
    process.exit(1);
  });
