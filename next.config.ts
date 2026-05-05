import type { NextConfig } from "next";

const config: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.prod.website-files.com" },
      { protocol: "https", hostname: "trello.com" },
      { protocol: "https", hostname: "trello-attachments.s3.amazonaws.com" },
    ],
  },
};

export default config;
