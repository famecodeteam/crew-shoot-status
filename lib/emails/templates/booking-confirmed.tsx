// Milestone email #1 - fires when Trello card moves into "Won".
//
// This is the LONG onboarding email per the spec. Explains the full
// 5-step journey (4 steps for crew-only), sets expectations, and
// gives the client their status-page link to bookmark. Subsequent
// milestone emails are short; this one is the upfront orientation.
//
// Per Tom: crew member is already identified at booking time (during
// sales / quote stage). So we show the crew card here too - the
// "meet your crew" reveal isn't held back to the crew-confirmed
// email. Step 1 of the journey is therefore "Locking your crew"
// (formalising availability), not "Finding your crew".

import { Img, Section, Text } from "@react-email/components";
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
  const crew = shoot.crew;

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

      <Text style={stepHeading}>1. Locking your crew</Text>
      <Text style={paragraph}>
        We've already matched you with a crew member during quoting -
        now we formally lock in their availability for the day and
        share the brief with them. You'll find your crew below.
      </Text>

      {crew ? (
        <Section style={crewCard}>
          <table
            cellPadding={0}
            cellSpacing={0}
            border={0}
            role="presentation"
            style={crewTable}
          >
            <tbody>
              <tr>
                {crew.photoUrl ? (
                  <td style={crewPhotoCell}>
                    <Img
                      src={crew.photoUrl}
                      alt={crew.name}
                      width="80"
                      height="80"
                      style={crewPhoto}
                    />
                  </td>
                ) : null}
                <td style={crewTextCell}>
                  <Text style={crewName}>{crew.name}</Text>
                  {crew.bio ? <Text style={crewBio}>{crew.bio}</Text> : null}
                </td>
              </tr>
            </tbody>
          </table>
        </Section>
      ) : null}

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

      {/* ?welcome=1 triggers the one-time "thank you" banner on the client's
          first landing. The status page strips the param client-side after
          it renders, so a later bookmark/refresh visit stays clean. */}
      <PrimaryButton href={`${statusPageUrl}?welcome=1`}>View your status page</PrimaryButton>

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

const crewCard = {
  backgroundColor: colors.card,
  border: `1px solid ${colors.border}`,
  borderRadius: "12px",
  padding: "20px",
  margin: "10px 0 18px",
};

const crewTable = {
  width: "100%",
  borderCollapse: "collapse" as const,
};

const crewPhotoCell = {
  width: "92px",
  verticalAlign: "middle" as const,
  paddingRight: "16px",
};

const crewPhoto = {
  borderRadius: "40px",
  display: "block",
  backgroundColor: colors.pinkLight,
};

const crewTextCell = {
  verticalAlign: "middle" as const,
};

const crewName = {
  margin: "0 0 6px",
  fontSize: "18px",
  fontWeight: 700,
  color: colors.dark,
};

const crewBio = {
  margin: 0,
  color: colors.textMuted,
  fontSize: "14px",
  lineHeight: 1.55,
};
