import type { NextConfig } from "next";

const config: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.prod.website-files.com" },
      { protocol: "https", hostname: "trello.com" },
      { protocol: "https", hostname: "trello-attachments.s3.amazonaws.com" },
    ],
  },
  async headers() {
    // Belt-and-braces noindex on every response — applies to HTML, API
    // routes, redirects, and any future content type. Stronger than the
    // <meta name="robots"> alone because it covers non-HTML responses
    // and is unambiguously honoured by Googlebot, Bing, and other major
    // crawlers regardless of how they fetched the URL.
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow, noarchive, noimageindex",
          },
        ],
      },
    ];
  },
  async redirects() {
    // Old URLs (/shoots/<slug>) permanently redirect to the new flat layout.
    // Cheap insurance — anyone who got an early link still lands correctly.
    return [
      {
        source: "/shoots/:slug",
        destination: "/:slug",
        permanent: true,
      },
      // Status-page slugs that were minted from a client email instead of
      // the company name, then renamed - keep the old links resolving.
      {
        source: "/0230-exodusfilms-hushmail-com-577089e6",
        destination: "/0230-fusion-productions-limited-577089e6",
        permanent: true,
      },
    ];
  },
};

export default config;
