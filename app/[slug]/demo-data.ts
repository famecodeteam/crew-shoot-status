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
// only be described, never demonstrated. Cloudflare Stream fields are left
// unset: there is no real video behind these, and the poster falls back to a
// placeholder rather than pretending a file exists.
export function getDemoAssets(): Asset[] {
  const base = {
    shootCardId: "demo-card-id",
    rawFileIds: [],
    createdAt: "2026-05-18T09:00:00.000Z",
    updatedAt: "2026-05-22T16:20:00.000Z",
    createdBy: null,
  };
  const version = (n: number, filename: string, uploadedAt: string): AssetVersion => ({
    n,
    driveFileId: `demo-file-${filename}`,
    uploadedAt,
    uploadedBy: "Fame editor",
    sizeBytes: 148 * 1024 * 1024,
    durationSeconds: 96,
    filename,
    isPublishedToClient: true,
    publishedToClientAt: uploadedAt,
    publishedBy: "Fame",
    internalStatus: "published",
  });

  return [
    {
      ...base,
      slug: "conference-sizzle-reel",
      name: "Conference Sizzle Reel",
      notes: "90-second highlight cut for the post-event campaign.",
      versions: [
        version(1, "v1.mp4", "2026-05-18T09:00:00.000Z"),
        version(2, "v2.mp4", "2026-05-21T11:30:00.000Z"),
      ],
      approval: {
        status: "changes_requested",
        onVersion: 1,
        authorName: "Priya Raman",
        decidedAt: "2026-05-20T14:05:00.000Z",
        changeRequestText: "Can we cut the wide at 00:42 and hold on the keynote line instead?",
      },
      lifecycle: "awaiting_client_review",
    },
    {
      ...base,
      slug: "keynote-full-session",
      name: "Keynote - Full Session",
      notes: "Full 24-minute keynote, colour graded, captions burned in.",
      versions: [version(1, "v1.mp4", "2026-05-19T08:15:00.000Z")],
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
      versions: [version(1, "v1.mp4", "2026-05-22T10:00:00.000Z")],
      approval: null,
      lifecycle: "awaiting_client_review",
    },
  ];
}
