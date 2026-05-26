// One-shot dry-run sender for milestone emails. Renders against a real
// shoot record + sends to EMAIL_DRYRUN_TO (which the send wrapper
// forces in front of all other recipients), so Tom can preview the
// real rendered output before pointing at real clients.
//
// Usage:
//   pnpm email-dryrun <slug> <milestone>
//
//   # e.g. send the crew-confirmed email for 0225a (Little Owl) to
//   # the dryrun address configured in EMAIL_DRYRUN_TO:
//   pnpm email-dryrun 0225-little-owl-entertainment-0e40da45 crew-confirmed
//
// The script reuses the exact same render + send code path as the
// webhook handler, so what you see is what a real client would see.

import { getBySlug } from "../lib/storage";
import { renderEmail } from "../lib/emails/render";
import { send } from "../lib/emails/send";
import { CrewConfirmedEmail } from "../lib/emails/templates/crew-confirmed";

async function main() {
  const [, , slug, milestone] = process.argv;
  if (!slug || !milestone) {
    console.error("Usage: pnpm email-dryrun <slug> <milestone>");
    console.error("  milestones: crew-confirmed (Phase 1)");
    process.exit(1);
  }

  const shoot = await getBySlug(slug);
  if (!shoot) {
    console.error(`No shoot found for slug: ${slug}`);
    process.exit(1);
  }

  const publicBase = (process.env.PUBLIC_BASE_URL || "https://shoots.fame.so").replace(
    /\/$/,
    "",
  );
  const statusPageUrl = `${publicBase}/${shoot.slug}`;
  const clientFirstName =
    (shoot.clientContactName || "").trim().split(/\s+/)[0] || "";

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
          statusPageUrl={statusPageUrl}
          clientFirstName={clientFirstName}
        />,
      );
      rendered = { subject, html, text };
      break;
    }
    default:
      console.error(`Unknown milestone: ${milestone} (try: crew-confirmed)`);
      process.exit(1);
  }

  if (!rendered) {
    console.error("No rendered output - aborting.");
    process.exit(1);
  }

  console.log(`[dryrun] shoot=${shoot.shootNumber} (${shoot.slug})`);
  console.log(`[dryrun] milestone=${milestone}`);
  console.log(`[dryrun] subject="${rendered.subject}"`);
  console.log(
    `[dryrun] would-go-to=${shoot.clientEmails.length ? shoot.clientEmails.join(",") : "(no client emails on card)"}`,
  );

  if (!process.env.EMAIL_DRYRUN_TO) {
    console.error(
      "\n[dryrun] EMAIL_DRYRUN_TO is unset - refusing to send. Set it to your inbox (e.g. tom@fame.so) and re-run.",
    );
    process.exit(1);
  }

  // The send wrapper auto-overrides recipients with EMAIL_DRYRUN_TO,
  // strips BCC, and prefixes the subject. We just call it normally.
  const res = await send({
    to: shoot.clientEmails.length ? shoot.clientEmails : ["placeholder@fame.so"],
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    tags: [
      { name: "milestone", value: milestone },
      { name: "card", value: shoot.cardId },
      { name: "mode", value: "dryrun" },
    ],
  });

  if (!res.ok) {
    console.error(`[dryrun] send failed: ${res.error}`);
    process.exit(1);
  }
  console.log(
    `[dryrun] sent to ${process.env.EMAIL_DRYRUN_TO} - messageId=${res.messageId}`,
  );
}

main().catch((err) => {
  console.error("[dryrun] failed:", err);
  process.exit(1);
});
