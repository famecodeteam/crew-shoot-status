"use client";

import { useState } from "react";

// Crew photos are often a LinkedIn-scraped URL, which carries a signed
// expiry - once it lapses, LinkedIn 403s and the bare <img> falls back
// to rendering its alt text (the crew member's name) inside the small
// circular frame, wrapping into an ugly overlapping mess. Client-side
// onError lets us catch that and fall back to the same initial-letter
// avatar the server already renders when there's no photoUrl at all.
export function CrewPhoto({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{name.charAt(0)}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={name} onError={() => setFailed(true)} />
  );
}
