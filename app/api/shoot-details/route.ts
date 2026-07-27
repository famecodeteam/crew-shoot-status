// POST /api/shoot-details  { slug, shootDate?, shootLocation? }
//
// The client answering "when/where is your shoot?" from their status page.
// The browser only ever sends the slug it's already on - this route resolves
// that to the shoot, then forwards to the delivery app with the shared secret,
// so SYNC_API_SECRET never reaches the client.
//
// Only fills a blank: if the shoot already has the field, we don't forward it
// (the delivery side enforces the same rule, this just saves a round trip).

import { getBySlug } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DELIVERY_BASE =
  process.env.DELIVERY_API_BASE_URL?.trim() ?? "https://delivery.fame.so";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.SYNC_API_SECRET?.trim();
  if (!secret) {
    return Response.json({ ok: false, error: "not configured" }, { status: 500 });
  }

  let body: { slug?: string; shootDate?: string | null; shootLocation?: string | null };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid request" }, { status: 400 });
  }

  const slug = (body.slug ?? "").trim();
  if (!slug) return Response.json({ ok: false, error: "missing shoot" }, { status: 400 });

  const shoot = await getBySlug(slug);
  if (!shoot) return Response.json({ ok: false, error: "shoot not found" }, { status: 404 });

  // Ignore anything for a field that's already known - a stale tab shouldn't be
  // able to overwrite a date ops has since set.
  const shootDate = !shoot.shootDate ? (body.shootDate ?? null) : null;
  const shootLocation = !shoot.location ? (body.shootLocation ?? null) : null;
  if (!shootDate && !shootLocation) {
    return Response.json({ ok: true, note: "already set" });
  }

  try {
    const res = await fetch(`${DELIVERY_BASE}/api/intake/client-shoot-details`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ cardId: shoot.cardId, shootDate, shootLocation }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      console.error("[shoot-details] delivery rejected:", res.status, json.error);
      return Response.json(
        { ok: false, error: json.error ?? "Couldn't save that - please try again." },
        { status: 502 },
      );
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[shoot-details] delivery unreachable:", err);
    return Response.json(
      { ok: false, error: "Couldn't save that - please try again." },
      { status: 502 },
    );
  }
}
