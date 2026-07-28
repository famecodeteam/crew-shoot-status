import type { Asset, AssetVersion, Shoot } from "@/lib/types";

// Hardcoded for /shoots/demo so the visual demo always works regardless
// of what's in storage. Real shoots come from lib/storage.
export function getDemoShoot(): Shoot {
  return {
    slug: "demo",
    cardId: "demo-card-id",
    shootNumber: "#0190",
    clientName: "Northwind",
    shootType: "Conference",
    location: "London, UK",
    shootDate: "2026-05-15",
    status: "crew-confirmed",
    statusLabel: "Crew confirmed - meet Alex",
    crew: {
      name: "Alex Morgan",
      bio: "Based in Berlin. 14 shoots with Fame. Specializes in conference fireside.",
      profileUrl: "https://member.fame.so/crew/alex-morgan-demo1234",
      // A drawn placeholder rather than a photograph: this crew member is
      // fictional, so a real person's face would misrepresent them.
      photoUrl: "/demo-crew-avatar.svg",
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
    crewStatus: "On site",
    milestoneDates: {
      bookingConfirmed: "2026-04-22T10:00:00.000Z",
      crewConfirmed: "2026-05-01T14:00:00.000Z",
    },
    // Demo is in "crew-confirmed" state pre-shoot; projected delivery is
    // Shoot day (2026-05-15) + 5 business days = 2026-05-22.
    projectedDeliveredDate: "2026-05-22",
    trelloListId: "demo",
    trelloListName: "Crew Booked",
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
// fame.so/portfolio (the source these were meant to come from) turned out to
// be YouTube embeds, not fetchable files, and Stream's ingest API needs a
// direct URL it can pull from - so these are ingested instead from the same
// real, Tom-approved raw shoot footage used for member.fame.so/footage/demo
// (see that repo's demo-data.ts for the source and full explanation). A
// raw, unedited clip is arguably a better fit for a review-tool demo than a
// finished case study anyway. Ingested via lib/stream.ts's copyFromUrl,
// tagged meta.app: "crew-shoot-status" per that file's orphan-prune
// convention. durationSeconds/sizeBytes below are Stream's own reported
// values for the ingested copy, not invented.
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
      slug: "conference-sizzle-reel",
      name: "Conference Sizzle Reel",
      notes: "Highlight cut for the post-event campaign.",
      versions: [
        version(1, "v1.mp4", "2026-05-18T09:00:00.000Z", "83a1c57c629920c689fc46d520efb17a", 25.5, 469913272),
        version(2, "v2.mp4", "2026-05-21T11:30:00.000Z", "ac17a0466faaf40bbfe04bb808fa349e", 12, 268582478),
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
      name: "Keynote - Full Session",
      notes: "Keynote pull, colour graded, captions burned in.",
      versions: [
        version(1, "v1.mp4", "2026-05-19T08:15:00.000Z", "813eb808bbb36dbe0a7c247cd03f4d0d", 10.5, 201473154),
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
        version(1, "v1.mp4", "2026-05-22T10:00:00.000Z", "39920a88d5630753278e597ea274ccea", 8, 201472312),
      ],
      approval: null,
      lifecycle: "awaiting_client_review",
    },
  ];
}
