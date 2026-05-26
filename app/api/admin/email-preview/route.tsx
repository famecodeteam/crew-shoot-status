// One-shot admin endpoint to render and send a milestone email for a
// specific shoot, via the same code path the webhook handler uses.
// Built so the dryrun can be triggered without local terminal access
// while we sort out Phase 1 setup.
//
// Auth strategy: gated by the EMAIL_DRYRUN_TO env var being set. While
// EMAIL_DRYRUN_TO is set on the production Vercel project, the send
// wrapper forces every recipient to that address regardless of the
// `to` field - so the worst-case "abuse" outcome is unwanted emails
// to the Fame-internal dryrun inbox. After Phase 1 ships and
// EMAIL_DRYRUN_TO is removed, this endpoint stops accepting requests.
//
// This endpoint also BYPASSES the milestone-email idempotency claim,
// so re-running it doesn't get blocked by a previous send having
// already been recorded. Useful for previewing templates during
// rollout.

import { NextResponse, type NextRequest } from "next/server";
import { getBySlug } from "@/lib/storage";
import { renderEmail } from "@/lib/emails/render";
import { send } from "@/lib/emails/send";
import { CrewConfirmedEmail } from "@/lib/emails/templates/crew-confirmed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!process.env.EMAIL_DRYRUN_TO) {
    return NextResponse.json(
      {
        error:
          "EMAIL_DRYRUN_TO not set. This endpoint only operates when dryrun mode is active.",
      },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  const milestone = searchParams.get("milestone");
  // ?preview=true skips the send and returns the rendered HTML so the
  // browser can display it directly. Useful for tone-checking templates
  // without triggering any actual delivery.
  const previewOnly = searchParams.get("preview") === "true";

  if (!slug) {
    return NextResponse.json({ error: "missing slug param" }, { status: 400 });
  }
  if (!milestone) {
    return NextResponse.json(
      { error: "missing milestone param (try: crew-confirmed)" },
      { status: 400 },
    );
  }

  const shoot = await getBySlug(slug);
  if (!shoot) {
    return NextResponse.json(
      { error: `no shoot found for slug: ${slug}` },
      { status: 404 },
    );
  }

  const publicBase = (
    process.env.PUBLIC_BASE_URL || "https://shoots.fame.so"
  ).replace(/\/$/, "");
  const statusPageUrl = `${publicBase}/${shoot.slug}`;
  const clientFirstName =
    (shoot.clientName || "").trim().split(/\s+/)[0] || "";
  const producerFirstName =
    (shoot.producerEmail || "").split("@")[0].split(/[.\-_]/)[0] ||
    "the team";

  let rendered: { subject: string; html: string; text: string } | null = null;

  switch (milestone) {
    case "crew-confirmed": {
      const crewFirst = shoot.crew?.name.split(/\s+/)[0];
      const subject = crewFirst
        ? `Meet your crew - ${shoot.shootNumber}`
        : `Your crew is confirmed - ${shoot.shootNumber}`;
      const { html, text } = await renderEmail(
        <CrewConfirmedEmail
          shoot={shoot}
          producerFirstName={producerFirstName}
          producerEmail={shoot.producerEmail}
          statusPageUrl={statusPageUrl}
          clientFirstName={clientFirstName}
        />,
      );
      rendered = { subject, html, text };
      break;
    }
    default:
      return NextResponse.json(
        { error: `unknown milestone: ${milestone} (try: crew-confirmed)` },
        { status: 400 },
      );
  }

  if (previewOnly) {
    // Browser-renderable HTML preview. Returns the email's HTML body
    // verbatim so Tom can review tone + layout at the URL.
    return new Response(rendered.html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // No-cache so iterations show up on refresh.
        "Cache-Control": "no-store, max-age=0",
      },
    });
  }

  const result = await send({
    to: (shoot.clientEmails ?? []).length
      ? (shoot.clientEmails ?? [])
      : ["placeholder@fame.so"],
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    tags: [
      { name: "milestone", value: milestone },
      { name: "card", value: shoot.cardId },
      { name: "mode", value: "admin-preview" },
    ],
  });

  return NextResponse.json({
    shoot: {
      shootNumber: shoot.shootNumber,
      clientName: shoot.clientName,
      slug: shoot.slug,
      clientEmailsOnCard: shoot.clientEmails ?? [],
    },
    rendered: { subject: rendered.subject },
    send: result,
    dryrunTo: process.env.EMAIL_DRYRUN_TO,
  });
}
