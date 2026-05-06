import type { Shoot } from "@/lib/types";

// Hardcoded for /shoots/demo so the visual demo always works regardless
// of what's in storage. Real shoots come from lib/storage.
export function getDemoShoot(): Shoot {
  return {
    slug: "demo",
    cardId: "demo-card-id",
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
    depositReceiptUrl: "https://pay.stripe.com/receipts/example-deposit",
    // balanceReceiptUrl deliberately unset — demonstrates partial-payment state.
    // No finalAssetsUrl yet — section should hide silently to demo graceful empty state.
    producerEmail: "zandro@fame.so",
    hasPostProduction: true,
    trelloListId: "demo",
    trelloListName: "Crew Booked",
    updatedAt: new Date().toISOString(),
  };
}
