"use client";

import { useEffect } from "react";

// The booking-confirmed email links the client to <status page>?welcome=1,
// which triggers the one-time "thank you" welcome banner. Once the page has
// rendered we strip ?welcome=1 from the URL (history.replaceState, no
// reload) so the banner shows on that first landing but NOT on a later
// bookmark or refresh. Mirrors the ?code= strip the brief page used to do.
export function WelcomeSync() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("welcome")) {
      url.searchParams.delete("welcome");
      window.history.replaceState(
        null,
        "",
        url.pathname + url.search + url.hash,
      );
    }
  }, []);
  return null;
}
