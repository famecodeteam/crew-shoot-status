import type { NextConfig } from "next";

const config: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.prod.website-files.com" },
      { protocol: "https", hostname: "trello.com" },
      { protocol: "https", hostname: "trello-attachments.s3.amazonaws.com" },
    ],
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
    ];
  },
};

export default config;
