// Postmark wrapper used by every milestone email send. Keeps the From,
// Reply-To, and BCC config in one place so all outgoing mail looks the
// same and Tom can change the From / BCC list without touching template
// code.
//
// We switched from Resend to Postmark when Namecheap's "Mail Settings:
// Gmail" lock prevented us from adding an MX record on send.shoots.
// Postmark requires only DKIM (TXT) + Return-Path (CNAME) - no MX -
// which fits cleanly inside the Namecheap restriction.
//
// Dry-run mode: if EMAIL_DRYRUN_TO is set, we override the recipient
// list with that address and prefix the subject with "[DRYRUN]". BCC
// is suppressed during dry-run.
//
// No-op mode: if POSTMARK_API_TOKEN isn't set, we log what would have
// been sent and return success. Useful so the webhook + enqueue logic
// can ship before Postmark is wired up.

import { ServerClient } from "postmark";

export type SendParams = {
  to: string[];
  subject: string;
  html: string;
  // Optional plain-text fallback. If absent, mail clients render the
  // HTML and most strip styling anyway.
  text?: string;
  // Tag the send so Postmark's dashboard groups deliveries by milestone.
  // Postmark accepts a single string Tag plus an arbitrary Metadata
  // map - we use Tag for milestone (primary slice) and Metadata for
  // the rest.
  tags?: { name: string; value: string }[];
};

export type SendResult =
  | { ok: true; messageId: string; dryRun: boolean }
  | { ok: false; error: string; retriable: boolean };

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

let cached: ServerClient | null = null;
function client(): ServerClient | null {
  if (cached) return cached;
  const token = process.env.POSTMARK_API_TOKEN;
  if (!token) return null;
  cached = new ServerClient(token);
  return cached;
}

// Map our generic tags array onto Postmark's Tag + Metadata shape.
// First "milestone" tag becomes the primary Tag; the rest plus any
// extras land in Metadata.
function splitTagsForPostmark(
  tags: { name: string; value: string }[] | undefined,
): { tag?: string; metadata?: Record<string, string> } {
  if (!tags || !tags.length) return {};
  const meta: Record<string, string> = {};
  let primary: string | undefined;
  for (const t of tags) {
    if (!primary && t.name === "milestone") {
      primary = t.value;
    } else {
      meta[t.name] = t.value;
    }
  }
  return {
    tag: primary,
    metadata: Object.keys(meta).length ? meta : undefined,
  };
}

export async function send(params: SendParams): Promise<SendResult> {
  const c = client();

  const dryTo = dryRunRecipient();
  const finalTo = dryTo ? [dryTo] : params.to;
  const finalSubject = dryTo ? `[DRYRUN] ${params.subject}` : params.subject;
  const finalBcc = dryTo ? [] : bcc(); // no BCC during dry-run

  if (!c) {
    console.log(
      `[email] POSTMARK_API_TOKEN unset - logging instead. to=${finalTo.join(",")} subject="${finalSubject}"`,
    );
    return { ok: true, messageId: "no-op", dryRun: true };
  }

  const { tag, metadata } = splitTagsForPostmark(params.tags);

  try {
    const res = await c.sendEmail({
      From: fromLine(),
      To: finalTo.join(", "),
      Bcc: finalBcc.length ? finalBcc.join(", ") : undefined,
      ReplyTo: replyTo(),
      Subject: finalSubject,
      HtmlBody: params.html,
      TextBody: params.text,
      Tag: tag,
      Metadata: metadata,
      MessageStream: "outbound",
    });
    return {
      ok: true,
      messageId: res.MessageID ?? "unknown",
      dryRun: !!dryTo,
    };
  } catch (err) {
    // Postmark SDK throws on 4xx / 5xx. Mark anything containing
    // "invalid" / "unauthorized" / "inactive" / "test mode" as
    // non-retriable so we don't burn the retry budget on a permanent
    // config issue.
    const msg = (err as Error).message || "send failed";
    const retriable = !/invalid|unauthorized|inactive|test mode|not found|approved sender/i.test(
      msg,
    );
    return { ok: false, error: msg, retriable };
  }
}
