// Milestone email #1 - fires when Trello card moves into "Won".
//
// This is the LONG onboarding email per the spec. Explains the full
// 5-step journey (4 steps for crew-only), sets expectations, and
// gives the client their status-page link to bookmark. Subsequent
// milestone emails are short; this one is the upfront orientation.

import { Text } from "@react-email/components";
import { EmailLayout, PrimaryButton } from "../layout";
import { EmailTimeline } from "../timeline";
import { QuestionsCTA } from "../questions-cta";
import { fameTheme } from "../theme";
import type { Shoot } from "../../types";

const { colors } = fameTheme;

export type BookingConfirmedProps = {
  shoot: Shoot;
  statusPageUrl: string;
  clientFirstName: string;
};

export function BookingConfirmedEmail({
  shoot,
  statusPageUrl,
  clientFirstName,
}: BookingConfirmedProps) {
  const greeting = clientFirstName ? `Hi ${clientFirstName},` : "Hi there,";
  const pp = shoot.hasPostProduction;

  return (
    <EmailLayout
      preview={`Your shoot ${shoot.shootNumber} is booked - here's what happens next`}
      hero={{
        shootNumber: shoot.shootNumber,
        title: shoot.clientName,
        statusLabel: "Booking confirmed",
      }}
      signOffName={shoot.producerFirstName}
    >
      <Text style={lede}>Your shoot is booked</Text>
      <Text style={paragraph}>{greeting}</Text>
      <Text style={paragraph}>
        Great to have you on board for {shoot.shootNumber}. The deposit
        landed, the shoot is officially on the calendar. Here's how the
        next few weeks will go:
      </Text>

      <Text style={stepHeading}>1. Finding your crew</Text>
      <Text style={paragraph}>
        We match you with a local crew member - you'll get an
        introduction (with photo + bio) by email once they're confirmed.
      </Text>

      <Text style={stepHeading}>2. Pre-production</Text>
      <Text style={paragraph}>
        We share the brief with the crew, lock the location and the
        shoot day plan, and answer anything that comes up before the
        day itself.
      </Text>

      <Text style={stepHeading}>3. Shoot day</Text>
      <Text style={paragraph}>
        Your crew arrives ready to roll. We capture everything in the
        brief. Same day, the footage starts uploading to us.
      </Text>

      {pp ? (
        <>
          <Text style={stepHeading}>4. Editing</Text>
          <Text style={paragraph}>
            Our editors take the raw footage and build the deliverables -
            typically 5 business days. You'll get a notification when
            the first cut is ready to review.
          </Text>
        </>
      ) : null}

      <Text style={stepHeading}>{pp ? "5" : "4"}. Delivered</Text>
      <Text style={paragraph}>
        {pp
          ? "You approve the final edits, we deliver the files. Done."
          : "Raw footage handed off to your team to edit. Done."}
      </Text>

      <EmailTimeline shoot={shoot} />

      <Text style={paragraph}>
        Your status page is the home for everything on this shoot - we
        keep it updated as we go. Bookmark it:
      </Text>

      <PrimaryButton href={statusPageUrl}>View your status page</PrimaryButton>

      <QuestionsCTA whatsappUrl={shoot.clientWhatsappUrl} />
    </EmailLayout>
  );
}

const lede = {
  fontSize: "22px",
  fontWeight: 700,
  margin: "8px 0 16px",
  color: colors.dark,
  letterSpacing: "-0.01em",
};

const paragraph = {
  margin: "0 0 14px",
  color: colors.dark,
};

const stepHeading = {
  fontSize: "15px",
  fontWeight: 700,
  margin: "20px 0 6px",
  color: colors.pink,
};
