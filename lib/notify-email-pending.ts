// Tell the crew portal that a client milestone email has just ENTERED the
// 15-minute send window (the pending buffer), so the portal posts a heads-up
// to #crew and anyone can review + cancel it from the Activity tab before it
// sends. Counterpart of notify-email-sent.ts (which fires when it actually
// goes out).
//
// Best-effort by contract: never throws, never blocks scheduling.

export async function notifyEmailPending(input: {
  cardId: string;
  milestone: string;
  shootSlug: string;
  firesAt: string;
}): Promise<void> {
  try {
    const secret = process.env.SYNC_API_SECRET?.trim();
    if (!secret) return;
    const portalBase = (() => {
      try {
        return new URL(
          process.env.CREW_FEED_URL ?? "https://delivery.fame.so/api/sync/shoots",
        ).origin;
      } catch {
        return "https://delivery.fame.so";
      }
    })();
    await fetch(`${portalBase}/api/client-event/email-pending`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      cache: "no-store",
      body: JSON.stringify({
        cardId: input.cardId,
        milestone: input.milestone,
        shootSlug: input.shootSlug,
        firesAt: input.firesAt,
      }),
    });
  } catch (err) {
    console.warn("[notify-email-pending] failed:", (err as Error).message);
  }
}
