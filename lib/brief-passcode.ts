// Cookie name for the brief unlock soft-gate. Pulled out of the route
// handler because Next.js rejects extra named exports from route.ts.
//
// Cookie names are restricted to [a-zA-Z0-9_-]; brief slugs are already
// in [a-z0-9-] so we can embed them directly.

export function briefUnlockCookieName(slug: string): string {
  return `brief_unlock_${slug}`;
}
