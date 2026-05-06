import type { MetadataRoute } from "next";

// Disallow everything. shoots.fame.so is per-client by design — the URLs
// are unguessable but the content shouldn't surface in search anyway.
// Stacked with the X-Robots-Tag header in next.config.ts and the
// <meta name="robots"> in app/layout.tsx for belt-and-braces coverage.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
