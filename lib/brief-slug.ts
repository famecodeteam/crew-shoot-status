// Slug + Doc ID helpers for the brief-page feature.
//
// A shoot slug looks like "0219-demand-ai-db55c1a9" — the trailing 8-hex-
// char block is the access code; everything before it is the human, public
// brief slug. The two pieces are encoded together so the live status page
// can keep a single URL while the brief URL stays clean.

export type SplitShootSlug = { briefSlug: string; hash: string };

export function shootSlugToBriefSlug(shootSlug: string): SplitShootSlug | null {
  const m = shootSlug.match(/^(.+)-([a-f0-9]{8})$/);
  if (!m) return null;
  return { briefSlug: m[1], hash: m[2] };
}

// Extract the file ID from a Google Doc URL. Tolerant of /u/N/d/, missing
// trailing path, and assorted query strings.
//   https://docs.google.com/document/d/<id>/edit         → <id>
//   https://docs.google.com/document/u/0/d/<id>/preview  → <id>
export function extractDocId(url: string): string | null {
  const m = url.match(/\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{20,})/);
  return m?.[1] ?? null;
}
