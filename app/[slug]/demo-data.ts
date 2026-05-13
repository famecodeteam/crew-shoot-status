import type { Shoot } from "@/lib/types";

// Hardcoded for /shoots/demo so the visual demo always works regardless
// of what's in storage. Real shoots come from lib/storage.
export function getDemoShoot(): Shoot {
  return {
    slug: "demo",
    cardId: "demo-card-id",
    shootNumber: "#0190",
    clientName: "genOway",
    shootType: "Conference",
    location: "London, UK",
    shootDate: "2026-05-15",
    status: "crew-confirmed",
    statusLabel: "Crew confirmed - meet Alex",
    crew: {
      name: "Alex Morgan",
      bio: "Based in Berlin. 14 shoots with Fame. Specializes in conference fireside.",
    },
    briefUrl: "https://docs.google.com/document/d/example-brief",
    quoteUrl: "https://app.betterproposals.io/example-quote",
    depositReceiptUrl: "https://pay.stripe.com/receipts/example-deposit",
    // balanceReceiptUrl deliberately unset - demonstrates partial-payment state.
    // No finalAssetsUrl yet - section should hide silently to demo graceful empty state.
    clientWhatsappUrl: "https://chat.whatsapp.com/example-group-invite",
    producerEmail: "zandro@fame.so",
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
