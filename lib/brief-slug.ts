// Slug + Doc ID helpers for the brief-page feature.
//
// A shoot slug looks like "0219-demand-ai-db55c1a9" - the trailing 8-hex-
// char block is the unguessable suffix of the status-page URL; everything
// before it is the human, public brief slug. The brief access code is the
// shoot number (see briefAccessCode), not the hash.

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

// The brief access code - what a client types (or arrives with via the
// ?code= one-tap link) to unlock the brief page. It's the shoot number:
// the leading "NNNN" of the slug ("0219-demand-ai" -> "0219"). A 4-digit
// number is far easier for a PM to read out to a client than the old
// 8-hex hash. Falls back to the hash for any brief whose slug has no
// leading number, so a brief is never left un-unlockable.
export function briefAccessCode(slug: string, hash: string): string {
  const m = slug.match(/^(\d{3,5}[a-z]?)-/);
  return m ? m[1] : hash;
}
