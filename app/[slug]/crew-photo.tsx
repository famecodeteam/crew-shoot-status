"use client";

import { useEffect, useRef, useState } from "react";

// Crew photos are often a LinkedIn-scraped URL, which carries a signed
// expiry - once it lapses, LinkedIn 403s and the bare <img> falls back
// to rendering its alt text (the crew member's name) inside the small
// circular frame, wrapping into an ugly overlapping mess.
//
// The <img> is server-rendered, so the browser starts loading it (and
// can fail) before React hydrates and attaches an onError listener - a
// pre-hydration failure never re-fires the event, so relying on
// onError alone misses it. On mount, also check whether the image
// already finished loading with no pixels (complete && naturalWidth
// === 0 is the standard signal for "already failed"), same as the
// onError handler does for any failure after hydration.
export function CrewPhoto({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) {
      setFailed(true);
    }
  }, []);

  if (failed) return <>{name.charAt(0)}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={imgRef} src={src} alt={name} onError={() => setFailed(true)} />
  );
}
