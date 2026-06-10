// Tell the crew portal that a client milestone email was SKIPPED (not sent) -
// almost always because the shoot has no client email on file. The portal logs
// a permanent `email_skipped` row on the shoot's activity so the skip is
// visible on the Activity feed instead of vanishing silently. Counterpart of
// notify-email-sent.ts.
//
// Best-effort by contract: never throws, never blocks the flush.

export async function notifyEmailSkipped(input: {
  cardId: string;
  milestone: string;
  reason: string;
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
    await fetch(`${portalBase}/api/client-event/email-skipped`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      cache: "no-store",
      body: JSON.stringify({
        cardId: input.cardId,
        milestone: input.milestone,
        reason: input.reason,
      }),
    });
  } catch (err) {
    console.warn("[notify-email-skipped] failed:", (err as Error).message);
  }
}
