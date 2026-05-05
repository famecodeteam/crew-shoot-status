import type { ShootStatus } from "./status";

export type Shoot = {
  slug: string;
  shootNumber: string;
  clientName: string;
  location: string;
  shootDate: string; // ISO YYYY-MM-DD
  status: ShootStatus;
  statusLabel: string;
  crew?: {
    name: string;
    bio: string;
    photoUrl?: string;
  };
  briefUrl?: string;
  quoteUrl?: string;
  finalAssetsUrl?: string;
  producerEmail: string;
};

// Hardcoded for M0. Replaced by KV lookup in M2.
export function getDemoShoot(): Shoot {
  return {
    slug: "demo",
    shootNumber: "#0190",
    clientName: "genOway",
    location: "London, UK",
    shootDate: "2026-05-15",
    status: "crew-confirmed",
    statusLabel: "Crew confirmed — meet Alex",
    crew: {
      name: "Alex Morgan",
      bio: "Based in Berlin. 14 shoots with Fame. Specializes in conference fireside.",
    },
    briefUrl: "https://docs.google.com/document/d/example-brief",
    quoteUrl: "https://app.betterproposals.io/example-quote",
    // No finalAssetsUrl yet — section should hide silently to demo graceful empty state.
    producerEmail: "hello@fame.so",
  };
}
