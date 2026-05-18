"use client";

// When the user arrives at /brief/<slug>?code=<hash> from the status page,
// the SSR pass already renders the full content (the page-level loader
// recognises the matching code). This client component runs after mount
// to (a) set the HttpOnly unlock cookie for future visits, (b) strip the
// `code` query param from the URL so the link the user copies is clean.

import { useEffect } from "react";

export function AutoUnlockSync({ slug, code }: { slug: string; code: string }) {
  useEffect(() => {
    // Best-effort cookie-set; if it fails the page still works for this
    // session because the SSR pass already rendered content.
    fetch(`/api/brief/${encodeURIComponent(slug)}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }).catch(() => {});

    // Drop ?code= from the visible URL. replaceState avoids a history entry.
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("code");
      window.history.replaceState(null, "", url.toString());
    } catch {
      // URL API failure is a no-op; the page still works with ?code= visible.
    }
  }, [slug, code]);

  return null;
}
