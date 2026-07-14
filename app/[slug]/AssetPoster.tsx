"use client";

// The poster image inside an asset card. Renders the given poster URL, and
// drops to the dark gradient if there's no URL or the image fails to load
// (e.g. a Drive thumbnail that isn't generated yet) - so a missing poster
// never shows a broken-image icon.

import { useState } from "react";

export function AssetPoster({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className="asset-poster-glow" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
  );
}
