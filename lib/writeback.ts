// Trello write-back: keeps the card's "Status Page URL" custom field in
// sync with the public URL the page is actually served at.
//
// Idempotent. Reads the current field value first; only PUTs if it differs.
// That makes this safe to call on every webhook event — when our own write
// triggers another webhook, the next pass sees the field already correct
// and short-circuits, so we don't loop.

import type { TrelloCard } from "./trello";
import { setCustomFieldText } from "./trello";
import type { TransformContext } from "./transform";

export type WriteBackResult = "wrote" | "skipped-up-to-date" | "skipped-no-field" | "skipped-no-base-url";

export function publicUrlFor(slug: string): string | null {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/${slug}`;
}

export async function writeBackStatusUrl(
  card: TrelloCard,
  ctx: TransformContext,
  slug: string,
): Promise<WriteBackResult> {
  const fieldId = ctx.fieldId.statusPageUrl;
  if (!fieldId) return "skipped-no-field";

  const url = publicUrlFor(slug);
  if (!url) return "skipped-no-base-url";

  const existing = card.customFieldItems?.find(
    (i) => i.idCustomField === fieldId,
  )?.value?.text;

  if (existing === url) return "skipped-up-to-date";

  await setCustomFieldText(card.id, fieldId, url);
  return "wrote";
}
