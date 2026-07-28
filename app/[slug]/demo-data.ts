import type { Asset, AssetVersion, Shoot } from "@/lib/types";

// Hardcoded for /shoots/demo so the visual demo always works regardless
// of what's in storage. Real shoots come from lib/storage.
//
// The crew member is a REAL, currently-listed Fame Crew member (Damian G,
// London) - not the earlier fictional "Alex Morgan". Their name, bio and
// profileUrl below are copied verbatim from their own live, public profile
// (member.fame.so/crew/damian-g-d0196f85, linked from fame.so/crew-location/
// london), so nothing here says anything about a real person beyond what
// they already show publicly. Their profile - like most Fame-sourced crew
// records - has no photo on file (the box is empty on their real page too),
// so photoUrl is a stock photo rather than a fabricated likeness: it fills
// the same empty slot the real product already has, it doesn't invent one.
// Location is London to match the shoot's own location below - a real crew
// member shot in a city other than their own would read as a mismatch.
export function getDemoShoot(): Shoot {
  return {
    slug: "demo",
    cardId: "demo-card-id",
    shootNumber: "#0190",
    clientName: "Northwind",
    shootType: "Conference",
    location: "London, UK",
    shootDate: "2026-05-15",
    status: "in-editing",
    statusLabel: "In editing",
    // Raw footage handed off and assets are being reviewed simultaneously -
    // see getDemoAssets() - which only happens once editing has actually
    // started, hence "in-editing" rather than the earlier pre-shoot state.
    footageUrl: "https://member.fame.so/footage/demo",
    crew: {
      name: "Damian G",
      bio: "A skilled videographer based in London, bringing a sharp eye and professional dedication to every project across the city.",
      profileUrl: "https://member.fame.so/crew/damian-g-d0196f85",
      photoUrl:
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?fm=jpg&q=80&w=600&h=600&fit=crop&crop=faces",
    },
    briefUrl: "https://docs.google.com/document/d/example-brief",
    quoteUrl: "https://app.betterproposals.io/example-quote",
    depositReceiptUrl: "https://pay.stripe.com/receipts/example-deposit",
    // balanceReceiptUrl deliberately unset - demonstrates partial-payment state.
    clientWhatsappUrl: "https://chat.whatsapp.com/example-group-invite",
    producerEmail: "zandro@fame.so",
    producerFirstName: "Zandro",
    clientEmails: [],
    hasPostProduction: true,
    // Crew has wrapped and handed off, not still "On site" - that banner
    // would contradict a shoot that's already in editing.
    crewStatus: "Wrapped",
    milestoneDates: {
      bookingConfirmed: "2026-04-22T10:00:00.000Z",
      crewConfirmed: "2026-05-01T14:00:00.000Z",
      inEditing: "2026-05-17T09:00:00.000Z",
    },
    // Shoot day (2026-05-15) + 5 business days = 2026-05-22.
    projectedDeliveredDate: "2026-05-22",
    trelloListId: "demo",
    trelloListName: "Assets In Production",
    updatedAt: new Date().toISOString(),
  };
}

// The just-booked state: what a client sees the moment they land on the page
// after paying their deposit - status "booking-confirmed", no crew sourced yet.
// Used for /demo?welcome=1 so the thank-you page previews realistically
// (welcome banner + step 1, no mid-shoot data like an assigned crew member).
export function getJustBookedDemoShoot(): Shoot {
  return {
    ...getDemoShoot(),
    status: "booking-confirmed",
    statusLabel: "Booking confirmed",
    crew: undefined,
    crewStatus: undefined,
    briefUrl: undefined,
    milestoneDates: {
      bookingConfirmed: "2026-04-22T10:00:00.000Z",
    },
    trelloListName: "Won",
  };
}

// Demo assets for /demo, so the client-review side of the tool has something
// to show. Previously the demo shoot returned no assets at all, which meant
// the review tool - the part of Fame OS a prospect most wants to see - could
// only be described, never demonstrated.
//
// The video IS real, not faked: review-shell.tsx only ever builds a player
// from a Cloudflare Stream HLS manifest (customer-<code>.cloudflarestream.com/
// <uid>/manifest/video.m3u8) - there's no plain-<video src> fallback to lean
// on - so a placeholder streamUid would just show a broken player, which is
// worse than the placeholder poster this replaces.
//
// fame.so/portfolio turned out to be YouTube embeds, not fetchable files, so
// an earlier version of this ingested real RAW shoot footage instead (the
// same source as member.fame.so/footage/demo). Raw dailies are the wrong
// thing to show as "final assets" though - this section is meant to
// demonstrate polished, delivered work - so these are now real FINISHED
// clips from fame.so/content's own public "Clips" section instead
// (/videos/content/*.mp4, directly fetchable, no YouTube involved).
//
// Deliberately NOT the "Gary V" clip that same page also has: it's
// immediately recognisable as Gary Vaynerchuk, and showing it as a
// fictional client's ("Northwind") commissioned deliverable would misuse a
// real, identifiable person's likeness - a worse problem than the one this
// is fixing. The 4 below are generic B2B podcast/interview snippets with no
// individually-recognisable public figure.
//
// Ingested via lib/stream.ts's copyFromUrl, tagged meta.app:
// "crew-shoot-status" per that file's orphan-prune convention.
// durationSeconds/sizeBytes below are Stream's own reported values for the
// ingested copy, not invented.
export function getDemoAssets(): Asset[] {
  const base = {
    shootCardId: "demo-card-id",
    rawFileIds: [],
    createdAt: "2026-05-18T09:00:00.000Z",
    updatedAt: "2026-05-22T16:20:00.000Z",
    createdBy: null,
  };
  const version = (
    n: number,
    filename: string,
    uploadedAt: string,
    streamUid: string,
    durationSeconds: number,
    sizeBytes: number,
  ): AssetVersion => ({
    n,
    driveFileId: `demo-file-${filename}`,
    uploadedAt,
    uploadedBy: "Fame editor",
    sizeBytes,
    durationSeconds,
    filename,
    isPublishedToClient: true,
    publishedToClientAt: uploadedAt,
    publishedBy: "Fame",
    internalStatus: "published",
    streamUid,
    streamStatus: "ready",
  });

  return [
    {
      ...base,
      // Slug stays exactly "conference-sizzle-reel" - it's hardcoded into
      // fame-website's CREW_FAME_OS content, linked from all 1,616 crew
      // location/service pages.
      slug: "conference-sizzle-reel",
      name: "Conference Sizzle Reel",
      notes: "Vertical highlight cut for the event's social channels.",
      versions: [
        version(1, "v1.mp4", "2026-05-18T09:00:00.000Z", "1e13df86dd55ea8bd5a0c6d5dc10a38f", 48.7, 5486236),
        version(2, "v2.mp4", "2026-05-21T11:30:00.000Z", "3904c742b8a7c0d489ac0e078f5c18a0", 51.6, 5328588),
      ],
      approval: {
        status: "changes_requested",
        onVersion: 1,
        authorName: "Priya Raman",
        decidedAt: "2026-05-20T14:05:00.000Z",
        changeRequestText: "Can we hold on the walk-on a beat longer before cutting wide?",
      },
      lifecycle: "awaiting_client_review",
    },
    {
      ...base,
      slug: "keynote-full-session",
      name: "Keynote Highlight (Vertical)",
      notes: "Vertical pull from the keynote, colour graded, captions burned in.",
      versions: [
        version(1, "v1.mp4", "2026-05-19T08:15:00.000Z", "d3a43db6bb2857133639741a82d24606", 18, 1677386),
      ],
      approval: {
        status: "approved",
        onVersion: 1,
        authorName: "Priya Raman",
        decidedAt: "2026-05-22T16:20:00.000Z",
        changeRequestText: null,
      },
      lifecycle: "approved",
    },
    {
      ...base,
      slug: "speaker-clip-vertical",
      name: "Speaker Clip (Vertical)",
      notes: "9:16 cut for LinkedIn and Shorts.",
      versions: [
        version(1, "v1.mp4", "2026-05-22T10:00:00.000Z", "6ada9b0e3580f567359e3f5ca220b5dc", 32.3, 2814393),
      ],
      approval: null,
      lifecycle: "awaiting_client_review",
    },
  ];
}
