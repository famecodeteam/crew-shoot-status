"use client";

// Fame-branded HTML5 video player. Renders the latest version by default;
// supports switching versions via a small selector. Streams from the
// production proxy at /api/video/<asset-slug>/v<n>.
//
// Future commits add: scrub-bar comment markers, "Add comment at [00:42]"
// button below the player, and the approve / request-changes action bar.

import { useEffect, useRef, useState } from "react";
import type { Asset } from "@/lib/types";

export function AssetPlayer({
  asset,
  initialVersion,
}: {
  asset: Asset;
  initialVersion: number;
}) {
  const [version, setVersion] = useState<number>(initialVersion);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // When the user switches versions, reload the source.
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.load();
  }, [version]);

  const src = `/api/video/${encodeURIComponent(asset.slug)}/v${version}`;
  const showSelector = asset.versions.length > 1;

  return (
    <section className="section asset-player-section">
      <div className="asset-player">
        <video
          ref={videoRef}
          src={src}
          controls
          playsInline
          preload="metadata"
          className="asset-video"
        />
      </div>
      {showSelector && (
        <div className="asset-versions">
          <span className="asset-versions-label">Version</span>
          {asset.versions.map((v) => (
            <button
              key={v.n}
              type="button"
              className={
                "asset-version-pill" + (v.n === version ? " is-active" : "")
              }
              onClick={() => setVersion(v.n)}
            >
              v{v.n}
              {v.n === asset.versions[asset.versions.length - 1].n && (
                <span className="asset-version-latest"> · latest</span>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
