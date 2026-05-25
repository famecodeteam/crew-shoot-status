# Milestone Emails - Spec

Automated, branded transactional emails sent to clients as their shoot
moves through the pipeline. Each email drives the client back to their
status page (shoots.fame.so/<slug>) for the rich detail. The goal is to
reduce producer "where are we?" email overhead AND give the client a
steady, confident rhythm of updates without the producer having to
remember to send anything.

This spec is for review BEFORE we build. Open questions for Tom are at
the bottom - any of those can flip a design choice.

---

## 1. Milestone matrix

Each row is a candidate trigger. "Fires when" is the Trello list change
detected by the existing webhook. We're explicitly NOT emailing on every
list change - the goal is signal, not noise.

| # | Fires when card enters list   | Status (`ShootStatus`) | Subject line                                                  |
|---|-------------------------------|------------------------|---------------------------------------------------------------|
| 1 | Won                           | `booking-confirmed`    | `Your shoot is booked - here's what happens next #NNNN`       |
| 2 | Searching For Crew            | `searching-for-crew`   | (no email - silent)                                           |
| 3 | Crew Booked                   | `crew-confirmed`       | `Meet your crew - #NNNN`                                      |
| 4 | Ready For Shoot               | `ready-for-shoot`      | `Your shoot is tomorrow - #NNNN`                              |
| 5 | Shoot Complete                | `shoot-complete`       | (no email - collapsed into #6 to avoid two same-day sends)    |
| 6 | Assets Received From Crew (PP)| `in-editing`           | `Footage is in - editing has started - #NNNN`                 |
| 6 | Assets Received (crew-only)   | `in-editing`           | `Your raw footage is ready - #NNNN`                           |
| 7 | Assets Shared With Client     | `assets-ready`         | `Your videos are ready to review - #NNNN`                     |
| 8 | Awaiting Payment / Closed     | `delivered`            | `How was your Fame shoot? - #NNNN` (links to /feedback/<slug>)|
| - | On Hold                       | `on-hold`              | (silent - all future sends paused until card moves out)       |

**Email #1 is the long onboarding email.** It explains the full 5-step
journey (booked → crew → shoot → editing → assets ready → delivered),
sets expectations, and gives the client the status-page link as the
canonical "where are we right now?" reference. Subsequent emails are
short and milestone-specific.

**Crew-only vs Post-Production:** copy in email #6 branches on
`hasPostProduction`. Crew-only shoots don't fire email #7 (there's no
"Assets Shared" step in that workflow).

**Sub-shoots (#0225a/b/c):** each is its own Trello card → its own
email stream. Treated as full independent shoots. A 7-leg shoot week
sends 7 separate per-milestone emails - per Tom's decision.

---

## 2. Trigger mechanics

### Detection
The existing Trello webhook (`app/api/trello-webhook/route.ts`) already runs `transformCard` and compares against the previous Shoot record. Add one step after `upsertByCardId`:

```ts
if (prev?.status !== next.status && isMilestone(next.status)) {
  await enqueueMilestoneEmail({ cardId: card.id, milestone: next.status });
}
```

### Idempotency
Per-shoot per-milestone "sent" record in KV:

- Key: `email-sent:<cardId>:<milestone>`
- Value: `{ sentAt, messageId, status }`
- `enqueueMilestoneEmail` no-ops if the key exists with status `sent`.

This means:
- Webhook fires twice for the same transition → second is a no-op.
- Card moves Won → Crew Booked → Won → Crew Booked → only the first Crew Booked email sends.
- Card goes back to a previous status → no "unsend", no resend on next forward move.

### On Hold
When card enters "On Hold", set `email-paused:<cardId> = true`. Suppress all queued milestone emails. Clear the flag when it moves out. (Optional: send a `paused` email - probably not, since reasons-for-hold are context-dependent.)

### Backwards transitions
If `STATUS_RANK[next] < STATUS_RANK[prev]`, no email. (Card was moved back due to error / re-do.)

---

## 3. Sender / recipient

### Sender (From)
`"<Producer first name> at Fame <hello@shoots.fame.so>"` via Resend.

DNS work needed on `shoots.fame.so`: SPF, DKIM, DMARC. ~30 min via
Cloudflare. Step-by-step instructions will live in the implementation
PR description.

### Reply-To (Google Group)
Replies route to **`crew@fame.so`** - a Google Group with all the Fame
people who handle client replies. We set the `Reply-To` header on
every outgoing email to that address; any client reply lands in every
group member's inbox.

Setup on Tom's side (Google Workspace admin), only if the group isn't
already configured for external posting:
1. Go to https://groups.google.com - find or create `crew@fame.so`
2. Members: producers + Tom + whoever else should see client replies
3. Under "Permissions → Who can post" → set **"Anyone on the web"**
   (clients aren't @fame.so, so they need to email in)
4. Under "Permissions → Allow email posting" → ensure external emails
   are NOT blocked

Wired via `EMAIL_REPLY_TO=crew@fame.so` env var on Vercel.

### Recipient (To)
**Needs a new Trello custom field:** `Client Email` (text). Plumb it through `transform.ts`. Supports multiple addresses as a comma-separated list (e.g. `booker@acme.com, ops@acme.com`) - we split on commas, trim, and pass them all in the `To` array.

```ts
// lib/types.ts
type Shoot = { ...; clientEmails?: string[]; ... }

// lib/transform.ts
const raw = readCustomFieldText(card, ctx.fieldId.clientEmail);
next.clientEmails = raw ? raw.split(",").map(s => s.trim()).filter(Boolean) : [];
```

If the field is empty → log warning + post Slack ping (#shoot-emails-log) saying "add a client email on #NNNN". The shoot record still exists, status page still works, only the send is skipped.

### BCC (internal visibility)
Every milestone email is BCC'd to:
- `tom@fame.so`
- `clay@fame.so`
- `zandro@fame.so`

Set via `EMAIL_BCC` env var (comma-separated) so the list is editable
without a deploy. BCC is invisible to the client; Tom/Clay/Zandro see
every send and can step in if anything looks off. This effectively
gives the same safety net as a formal approval gate, with much less
moving machinery.

---

## 4. Email provider

**Recommended:** Resend.

Reasons:
- Native Vercel integration (env vars set up in minutes).
- React Email templates first-class.
- Cheap (3K/month free, then $20/mo).
- Webhook for delivery / bounce / complaint events → we can mark bounces and alert the producer.

Alternatives: Postmark (good for transactional, similar pricing), AWS SES (cheapest at scale, more setup).

DNS work needed: SPF, DKIM, DMARC records on the sending domain. ~30 min via Cloudflare.

---

## 5. Templates

### Architecture
Use React Email - co-located in this repo, rendered server-side at send time. Lets us pull shoot data and conditionally render (e.g. crew photo only if present, hide footage URL if not set).

```
lib/emails/
  send.ts                  # Resend wrapper + send() fn + From config
  layout.tsx               # branded shell: logo header, footer, signature block
  booking-confirmed.tsx    # template per milestone
  crew-confirmed.tsx
  ready-for-shoot.tsx
  footage-in.tsx           # in-editing - branches on hasPostProduction
  assets-ready.tsx
  delivered.tsx            # optional - phase 4
```

Each template imports `<EmailLayout>` and takes a typed `EmailProps` derived from the `Shoot` shape.

### Content rules
Every email:
- **Header:** Fame logo, shoot number ("#0214"), client name.
- **Greeting:** "Hi <client first name>" (need to split `clientName`).
- **One-line summary:** what just happened.
- **Body:** 1-3 short paragraphs - no walls of text.
- **Primary CTA:** large button → status page (with utm tag).
- **Secondary CTA (when relevant):** footage URL, crew section anchor, etc.
- **Footer:** producer name + email, Fame address, "manage notifications" link.

Voice: warm, direct, no jargon, single hyphens (per Tom's writing preference).

### Per-template content (first-pass draft - Tom should rewrite)

1. **booking-confirmed**: confirms deposit landed, explains the 5 steps, links to status page so client can bookmark.
2. **crew-confirmed**: introduces the assigned crew member by name with bio + photo. Subtle confidence-builder.
3. **ready-for-shoot**: shoot day is tomorrow. Confirms location, contact, what to expect.
4. **footage-in (PP)**: "We've got the footage, our editors are on it. Expect first cut in ~5 business days."
5. **footage-in (crew-only)**: "Your raw files are ready - link below. No edits from us on this one."
6. **assets-ready**: assets are up for review. Click to view, comment, approve.
7. **delivered (optional)**: thank-you + 1-min Typeform feedback survey.

---

## 6. Pre-send review (no formal approval gate)

Confirmed by Tom: no per-send approval flow. Send goes out as soon as
the milestone fires, and review is asynchronous via the BCC list
(tom@, clay@, zandro@). If anything looks off, a quick reply-all to
the client with a correction is cheaper than a per-send bottleneck.

For PRE-FLIGHT confidence during Phase 1, we'll do `--dry-run` sends
to an internal Fame address (e.g. tom@fame.so) on real card data -
same code path, just a different recipient. Tom reviews the rendered
output before we point the templates at real clients.

If we later need approval (e.g. a new template that includes
AI-generated copy), the pending-KV + Slack-button pattern is a
~1-day add. Not building it now is a deferral, not a one-way door.

---

## 6.5 Feedback form (`/feedback/<slug>`)

Custom-built feedback form on shoots.fame.so, persisted to the shared
Supabase project that backs `delivery.fame.so` (built in the
`Crew Member Status Page` repo - sibling product to shoots.fame.so).

### URL + integration
- **URL:** `https://shoots.fame.so/feedback/<slug>` - the shoot slug,
  so we already know which shoot the response is for.
- **Status page integration:** once `shoot.status === "delivered"`, a
  new "How did we do?" card appears on the status page with a CTA
  button linking to the feedback URL.
- **Delivered email CTA:** email #6 ("How was your Fame shoot?") links
  here too.

### Form fields (first draft - Tom can edit)
1. **Overall rating** - 1-5 stars (radio).
2. **What went well?** - free text, optional.
3. **What could we do better?** - free text, optional.
4. **Would you book us again?** - yes / maybe / no (radio).
5. **Anything else?** - free text, optional.

(Aim: under 90 seconds to complete. Keep it focused or response rates
crater.)

### Storage (cross-repo contract)
Feedback responses land in the **shared Supabase Postgres project**
that delivery.fame.so / member.fame.so already uses. We add a new
`feedback` table; shoots.fame.so writes via an authenticated API
endpoint on member.fame.so (does NOT get direct DB credentials).

**Table: `feedback`** (new - to be added to
`Crew Member Status Page/docs/supabase-schema.sql`):

```sql
create table feedback (
  id               uuid primary key default gen_random_uuid(),
  card_id          text not null,            -- Trello card id (joins to shoots/crew data)
  shoot_slug       text not null,            -- shoots.fame.so slug, for fast lookup
  shoot_number     text,                     -- "#NNNN", convenience for logs
  client_name      text,
  rating           int check (rating between 1 and 5),
  went_well        text,
  could_improve    text,
  book_again       text check (book_again in ('yes', 'maybe', 'no')),
  other            text,
  submitted_by_ip  inet,
  submitted_by_ua  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on feedback (card_id);
create unique index on feedback (shoot_slug);  -- one response per shoot; resubmit overwrites
```

**Write path** (shoots.fame.so → member.fame.so):
- New endpoint `POST /api/feedback` on member.fame.so.
- Auth: shared bearer token (`FEEDBACK_INGEST_SECRET`) - set as env var
  in both Vercel projects.
- Idempotency: `shoot_slug` unique constraint. Resubmission upserts
  (replaces previous answer; we keep an audit row in a sibling
  `feedback_history` table - or just rely on `updated_at` for v1).
- Member.fame.so writes to Supabase with its existing service-role key.

**Why this pattern, not direct DB writes:**
- Keeps Supabase service-role key in ONE repo (member.fame.so).
- Member.fame.so owns the schema and is the natural source-of-truth
  for "delivery"-related data.
- API endpoint pattern matches the existing
  `/api/delivery/lock-crew` route in member.fame.so - consistent.
- If we later add per-feedback workflow on the delivery side (e.g.
  surfacing reviews to producers in `/delivery/post`), the data is
  already in their DB.

### Notification (Slack `#crew`)
On successful submission, shoots.fame.so posts to Slack `#crew`:
- Shoot number + client name
- Overall rating (as stars)
- "Would book again" answer
- All free-text answers, quoted
- Link to view the full record (URL TBD - either an admin view on
  shoots.fame.so or a tab on the delivery.fame.so post-prod page).

Negative responses (1-2 stars OR "no" to book again) get @here or
@tom in the same Slack post.

### Privacy
- Captured: response fields + timestamp.
- IP/UA stored only for spam-abuse investigations, never surfaced
  user-side.
- Per-shoot link is unguessable (shoot slug includes 8-char hex
  suffix) - no auth required to submit, but the URL acts as the
  shared-secret entry token.

### Out of scope for v1
- Public testimonial display (add later via opt-in checkbox).
- Analytics dashboard (just Slack notifications + raw DB rows).
- Editing a submission after the fact (resubmit overwrites - good
  enough; we keep `updated_at`).

---

## 7. Failure handling

| Failure                       | Handling                                                          |
|-------------------------------|-------------------------------------------------------------------|
| Resend transient error        | 3x retry with exponential backoff (1s, 5s, 20s).                  |
| Resend permanent error        | Log + Slack alert to producer + leave KV `status: error`.         |
| Hard bounce (Resend webhook)  | Mark `email-bounced:<cardId>:<email> = true` + Slack alert.       |
| Spam complaint                | Mark `email-suppressed:<email>` + alert producer.                 |
| Missing `clientEmail`         | Log warning, post Slack ping ("add client email on #NNNN"), skip. |
| Sent successfully             | Store `messageId` for downstream attribution.                     |

Suppression list takes precedence over send attempts. If an email is suppressed for a recipient, no future milestone emails go to that address until manually cleared.

---

## 8. Compliance

These are transactional emails (customer relationship, legitimate interest), not marketing - so the strict CAN-SPAM / GDPR marketing rules don't apply. Still:

- **Sender identity:** producer name + "Fame" + physical office address in footer.
- **Unsubscribe:** not legally required for transactional, but include "Manage notifications for this shoot" link - per-shoot KV flag, defaults opt-in, lets client mute future emails for that shoot.
- **Privacy policy:** link in footer.
- **Data minimisation:** no recipient lists, no BCC, one email per client per milestone.
- **EU clients:** the legitimate-interest basis covers us; no consent banner needed for transactional. But note: if we ever add cross-sell / upsell content, that becomes marketing and the calculus changes.

---

## 9. Observability

Send activity is operational data Fame will want to look at:

- **Slack:** `#shoot-emails-log` channel with one short line per send (and one per skip/bounce/error).
- **KV:** per-send record so a card's history can be audited.
- **Resend dashboard:** delivery, open, click - but treat opens/clicks as noise, not signal (image-blocking, link prefetchers).

Optional: small "Email history" panel on the producer-only view (if/when we build one).

---

## 10. Rollout phases

### Phase 1 - plumbing + first template (1 week)
- Add `Client Email` Trello custom field; plumb through `transform.ts`.
- Tom creates the Google Group; we wire `EMAIL_REPLY_TO` env var.
- Wire Resend, set up DNS records (SPF, DKIM, DMARC), verify sending domain.
- Set `EMAIL_BCC = tom@fame.so, clay@fame.so, zandro@fame.so`.
- Build `lib/emails/{send.ts, layout.tsx, crew-confirmed.tsx}`.
- Add `enqueueMilestoneEmail` + idempotency in webhook handler.
- Dry-run sends to a Fame-internal staging recipient; Tom reviews tone.
- Flip to real client recipients on `crew-confirmed` only. Pilot on 3-5 cards.

### Phase 2 - high-value middle templates (1 week)
- Add `footage-in` (PP + crew-only branches) and `assets-ready`.
- Run on full pipeline.

### Phase 3 - bookends (1 week)
- Add the longer onboarding email (`booking-confirmed`).
- Add `ready-for-shoot` (24h before shoot).
- Bounce-suppression list live.

### Phase 4 - feedback form + delivered email (1-2 weeks)
- Build `/feedback/<slug>` form.
- Add "How did we do?" card to status page (visible when `delivered`).
- Add `delivered` email template (links to the form).
- Slack `#client-feedback` notifications.

### Phase 5 - behavioural nudges (later)
- "Client hasn't reviewed assets after 5 days" nudge.
- Per-shoot notification preferences page (mute future emails).

---

## 11. Decisions log

| #  | Question                              | Tom's call                                                                          |
|----|---------------------------------------|-------------------------------------------------------------------------------------|
| 1  | Reply-To                              | Google Group `crew@fame.so`                                                         |
| 2  | Subject lines                         | Claude drafts - see §1 matrix                                                       |
| 3  | Sub-shoots                            | Each card is a full independent shoot, full email stream per leg                    |
| 4  | Multiple recipients                   | Comma-separated list in the `Client Email` Trello field                             |
| 5  | On Hold copy                          | Silent pause, no email                                                              |
| 6  | Sending domain                        | `hello@shoots.fame.so`                                                              |
| 7  | Long onboarding email                 | Yes - merged into email #1 (Won → `booking-confirmed`)                              |
| 8  | Feedback survey                       | Yes - custom form at `/feedback/<slug>`, persisted in shared Supabase (§6.5)        |
| 9  | Approval gate                         | Skip - rely on BCC for visibility + dry-runs for pre-flight                         |
| 10 | Producer notification                 | BCC tom@, clay@, zandro@ on every send                                              |
| 11 | Feedback Slack channel                | `#crew`                                                                             |
| 12 | Feedback storage                      | New `feedback` table in the shared Supabase project (lives in delivery.fame.so/member.fame.so repo). shoots.fame.so writes via an authenticated API endpoint on member.fame.so. |

## Open follow-ups (low-stakes, asked-while-building)

These don't block design; I'll surface them when the build hits them.

- **A.** Feedback table schema: does the draft in §6.5 match what
  delivery.fame.so wants long-term, or should we coordinate with
  whoever's specifying the Supabase schema there? (I'll open a PR
  against `Crew Member Status Page/docs/supabase-schema.sql` and tag
  Tom for review.)
- **B.** "View the full record" link from the Slack #crew post -
  should it deep-link to an admin view on shoots.fame.so, or be a
  tab on delivery.fame.so?
- **C.** Phase-1 dry-run recipient: tom@fame.so or a dedicated
  staging address like `email-dryrun@fame.so`?
