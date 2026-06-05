// Tell the crew portal that a client milestone email has actually been sent,
// so it logs a permanent `email_sent` row on the shoot's activity. Without
// this the email only ever shows as the transient 15-min countdown in the
// portal feed and disappears the moment it sends.
//
// Best-effort by contract: never throws, never blocks the send.

export async function notifyEmailSent(input: {
  cardId: string;
  milestone: string;
  recipient: string | null;
  messageId?: string;
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
    await fetch(`${portalBase}/api/client-event/email-sent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      cache: "no-store",
      body: JSON.stringify({
        cardId: input.cardId,
        milestone: input.milestone,
        recipient: input.recipient,
        messageId: input.messageId,
      }),
    });
  } catch (err) {
    console.warn("[notify-email-sent] failed:", (err as Error).message);
  }
}
