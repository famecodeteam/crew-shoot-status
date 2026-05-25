// Resend wrapper used by every milestone email send. Keeps the From,
// Reply-To, and BCC config in one place so all outgoing mail looks the
// same and Tom can change the From / BCC list without touching template
// code.
//
// Dry-run mode: if EMAIL_DRYRUN_TO is set, we override the recipient
// list with that address and prefix the subject with "[DRYRUN]". The
// rendered HTML is unchanged so we can sanity-check templates with
// real card data before pointing the system at real clients.
//
// No-op mode: if RESEND_API_KEY isn't set, we log what would have been
// sent and return success. This lets the webhook + enqueue logic ship
// before Resend is wired up.

import { Resend } from "resend";

export type SendParams = {
  to: string[];
  subject: string;
  html: string;
  // Optional plain-text fallback. If absent, mail clients render the
  // HTML and most strip styling anyway.
  text?: string;
  // Tag the send so Resend's dashboard groups deliveries by milestone.
  tags?: { name: string; value: string }[];
};

export type SendResult =
  | { ok: true; messageId: string; dryRun: boolean }
  | { ok: false; error: string; retriable: boolean };

// One env-derived From line so producers can change the display name
// without a deploy.
function fromLine(): string {
  const display = process.env.EMAIL_FROM_NAME || "Fame";
  const address = process.env.EMAIL_FROM_ADDRESS || "hello@shoots.fame.so";
  return `${display} <${address}>`;
}

function replyTo(): string | undefined {
  return process.env.EMAIL_REPLY_TO || undefined;
}

function bcc(): string[] {
  const raw = process.env.EMAIL_BCC || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function dryRunRecipient(): string | undefined {
  return process.env.EMAIL_DRYRUN_TO || undefined;
}

let cached: Resend | null = null;
function client(): Resend | null {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  cached = new Resend(key);
  return cached;
}

export async function send(params: SendParams): Promise<SendResult> {
  const c = client();

  const dryTo = dryRunRecipient();
  const finalTo = dryTo ? [dryTo] : params.to;
  const finalSubject = dryTo ? `[DRYRUN] ${params.subject}` : params.subject;
  const finalBcc = dryTo ? [] : bcc(); // no BCC during dry-run

  if (!c) {
    console.log(
      `[email] RESEND_API_KEY unset - logging instead. to=${finalTo.join(",")} subject="${finalSubject}"`,
    );
    return { ok: true, messageId: "no-op", dryRun: true };
  }

  try {
    const res = await c.emails.send({
      from: fromLine(),
      to: finalTo,
      replyTo: replyTo(),
      bcc: finalBcc.length ? finalBcc : undefined,
      subject: finalSubject,
      html: params.html,
      text: params.text,
      tags: params.tags,
    });
    if (res.error) {
      // Resend returns a structured error - treat 4xx as non-retriable,
      // 5xx + network as retriable.
      const retriable = !/invalid|missing|unauthorized|forbidden/i.test(
        res.error.message || "",
      );
      return { ok: false, error: res.error.message || "send failed", retriable };
    }
    return { ok: true, messageId: res.data?.id ?? "unknown", dryRun: !!dryTo };
  } catch (err) {
    return { ok: false, error: (err as Error).message, retriable: true };
  }
}
