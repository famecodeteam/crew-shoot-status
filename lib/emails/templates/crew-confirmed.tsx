// Milestone email #2 - fires when Trello card moves into "Crew Booked".
//
// Content goal: introduce the crew member by name + bio + photo, give
// the client confidence that production is on track, drop them on the
// status page for the deeper detail. Hero mirrors the public status
// page (shoot number eyebrow + big pink client name + status pill).
// Body shows the simplified timeline (this email fires BEFORE the
// shoot) and a "questions?" block with reply + WhatsApp paths.

import { Img, Section, Text } from "@react-email/components";
import { EmailLayout, OutlineButton, PrimaryButton } from "../layout";
import { EmailTimeline } from "../timeline";
import { QuestionsCTA } from "../questions-cta";
import { fameTheme } from "../theme";
import type { Shoot } from "../../types";

const { colors } = fameTheme;

// Pre-shoot prep call. Offered on the crew-confirmed email so the
// client can book a 15-min run-through before the shoot. Single
// Calendly link for now (Zandro's); if we ever want per-CPM links
// this moves to lib/producer.ts.
const PREP_CALL_URL = "https://calendly.com/zandro-fame/15min";

export type CrewConfirmedProps = {
  shoot: Shoot;
  // Fully-qualified URL to the client's status page (env-prefixed at
  // send time, not derivable from the Shoot record alone).
  statusPageUrl: string;
  // Client contact's first name for the greeting. Best-effort -
  // falls back to a polite generic if absent.
  clientFirstName: string;
};

export function CrewConfirmedEmail({
  shoot,
  statusPageUrl,
  clientFirstName,
}: CrewConfirmedProps) {
  const crew = shoot.crew;
  const greeting = clientFirstName ? `Hi ${clientFirstName},` : "Hi there,";
  const crewFirst = crew?.name.split(/\s+/)[0];

  return (
    <EmailLayout
      preview={
        crew
          ? `Your crew for ${shoot.shootNumber} is confirmed - meet ${crewFirst}`
          : `Your crew for ${shoot.shootNumber} is confirmed`
      }
      hero={{
        shootNumber: shoot.shootNumber,
        title: shoot.clientName,
        statusLabel: crewFirst
          ? `Crew confirmed - meet ${crewFirst}`
          : "Crew confirmed",
      }}
      signOffName={shoot.producerFirstName}
    >
      <Text style={lede}>Your crew is confirmed</Text>
      <Text style={paragraph}>{greeting}</Text>
      <Text style={paragraph}>
        Quick update on {shoot.shootNumber} - we've locked in your crew
        member{crew ? `, ${crew.name}` : ""}. They'll be the one on the
        ground for the shoot.
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

      <EmailTimeline shoot={shoot} />

      <Text style={paragraph}>
        Your status page has the full picture - shoot date, location,
        and everything else lined up so far. We'll keep it updated as
        we move through the next steps.
      </Text>

      <PrimaryButton href={statusPageUrl}>View your status page</PrimaryButton>

      <Text style={prepHeading}>Want a quick pre-shoot prep call?</Text>
      <Text style={paragraph}>
        If it'd help to run through the brief, the plan, or anything
        on your mind before the day, grab a 15-minute slot that works
        for you:
      </Text>

      <OutlineButton href={PREP_CALL_URL}>Book a prep call</OutlineButton>

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

const prepHeading = {
  fontSize: "16px",
  fontWeight: 700,
  margin: "20px 0 8px",
  color: colors.dark,
};

const crewCard = {
  backgroundColor: colors.card,
  border: `1px solid ${colors.border}`,
  borderRadius: "12px",
  padding: "20px",
  margin: "18px 0 8px",
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
