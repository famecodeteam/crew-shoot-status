// Tell the crew portal that a client has requested a revision - whether via
// the "Request changes" popup or by leaving review comments (which flip the
// asset to changes-requested). The portal resolves the shoot's CPM, drops a
// comment on the shoot card, and fires the in-app mention bell asking them to
// confirm chargeability with the client.
//
// Best-effort by contract: callers must wrap nothing - this never throws and
// never blocks the client's action.

export async function notifyCpmRevision(input: {
  cardId: string;
  assetName: string;
  version: number;
  clientName: string;
  changeText: string | null;
  reviewUrl: string;
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
    await fetch(`${portalBase}/api/client-event/revision`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      cache: "no-store",
      body: JSON.stringify({
        cardId: input.cardId,
        assetName: input.assetName,
        version: input.version,
        clientName: input.clientName,
        changeText: input.changeText,
        reviewUrl: input.reviewUrl,
      }),
    });
  } catch (err) {
    console.warn("[notify-cpm-revision] failed:", (err as Error).message);
  }
}
